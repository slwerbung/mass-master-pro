// Interner Produktkatalog-Generator (Probo).
//
// Nicht in der Navigation verlinkt, nur über /probo-katalog erreichbar und
// hinter der normalen Mitarbeiter-/Admin-Anmeldung. Ablauf: Produkte aus
// der Probo-API laden -> auswählen und optional überschreiben -> Kundenname
// und Intro setzen -> PDF erzeugen und herunterladen. Kein Shop, keine
// Kundenansicht, nichts wird gespeichert – die Auswahl lebt im State.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, FileDown, Loader2, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ProboError,
  ProboProduct,
  fetchProboImage,
  fetchProboProductDetail,
  fetchProboProducts,
  pickImageUrl,
  runInBatches,
  toPdfCompatibleImage,
} from "@/lib/proboCatalog";
import type { CatalogProduct } from "@/components/probo/CatalogDocument";

interface Override {
  name: string;
  note: string;
  price: string;
}

const emptyOverride = (): Override => ({ name: "", note: "", price: "" });

const DEFAULT_PRIMARY = "#1d4ed8";
const DEFAULT_ACCENT = "#f59e0b";

/** Liest eine Datei als Data-URL – für das optionale Kundenlogo. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

const ProboCatalog = () => {
  const navigate = useNavigate();

  const [products, setProducts] = useState<ProboProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Reihenfolge der Auswahl = Reihenfolge im PDF.
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  const [customerName, setCustomerName] = useState("");
  const [customerLogo, setCustomerLogo] = useState<string | null>(null);
  const [introTitle, setIntroTitle] = useState("Produktkatalog");
  const [introText, setIntroText] = useState("");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");

  const loadProducts = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { products: list, warning } = await fetchProboProducts();
      setProducts(list);
      if (warning) toast.warning(warning);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProducts();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) =>
      [product.name, product.code, product.category, product.description]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(term)),
    );
  }, [products, search]);

  const productByCode = useMemo(
    () => new Map(products.map((product) => [product.code, product])),
    [products],
  );

  const toggle = (code: string) => {
    setSelectedCodes((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
    setOverrides((current) => (current[code] ? current : { ...current, [code]: emptyOverride() }));
  };

  const updateOverride = (code: string, field: keyof Override, value: string) => {
    setOverrides((current) => ({
      ...current,
      [code]: { ...(current[code] ?? emptyOverride()), [field]: value },
    }));
  };

  const handleLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      // react-pdf kann nur JPEG/PNG einbetten – SVG/WebP vorher umrechnen.
      setCustomerLogo(await toPdfCompatibleImage(dataUrl));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Logo konnte nicht geladen werden.");
    }
  };

  const generatePdf = async () => {
    if (!selectedCodes.length) {
      toast.error("Bitte mindestens ein Produkt auswählen.");
      return;
    }

    setGenerating(true);
    setProgress("Produktdaten werden geladen ...");

    try {
      const collected: (CatalogProduct | null)[] = new Array(selectedCodes.length).fill(null);
      const skipped: string[] = [];
      const withoutImage: string[] = [];
      let done = 0;

      await runInBatches(selectedCodes, async (code, index) => {
        const override = overrides[code] ?? emptyOverride();
        const listEntry = productByCode.get(code);

        try {
          const detail = await fetchProboProductDetail(code);

          // Die Edge Function liefert das Bild in der Regel schon mit; der
          // Proxy-Aufruf bleibt als Rückfallebene bestehen.
          let imageDataUrl: string | null = null;
          const imageUrl = pickImageUrl(detail.images, "de");
          const rawImage = detail.imageDataUrl
            ? Promise.resolve(detail.imageDataUrl)
            : imageUrl
              ? fetchProboImage(imageUrl)
              : null;

          if (rawImage) {
            try {
              imageDataUrl = await toPdfCompatibleImage(await rawImage);
            } catch {
              // Ein fehlendes Bild ist kein Grund, den ganzen Katalog zu
              // verlieren – die Seite entsteht dann ohne Bild.
              withoutImage.push(code);
            }
          } else {
            withoutImage.push(code);
          }

          collected[index] = {
            code,
            name: override.name.trim() || detail.name || listEntry?.name || code,
            description: override.note.trim() || detail.description || listEntry?.description || "",
            properties: detail.properties,
            imageDataUrl,
            price: override.price.trim() || undefined,
          };
        } catch (error) {
          if (error instanceof ProboError && error.notFound) {
            // Nicht kalkulierbare Produkte liefern 404 – überspringen statt
            // abbrechen (so steht es auch in der Probo-Doku).
            skipped.push(code);
            return;
          }
          throw error;
        } finally {
          done += 1;
          setProgress(`Produktdaten werden geladen ... (${done}/${selectedCodes.length})`);
        }
      });

      const catalogProducts = collected.filter((product): product is CatalogProduct => !!product);

      if (!catalogProducts.length) {
        toast.error("Kein einziges Produkt konnte geladen werden – PDF nicht erstellt.");
        return;
      }

      setProgress("PDF wird gebaut ...");

      // Erst hier laden: react-pdf ist groß und wird nur für den Download
      // gebraucht.
      const [{ pdf }, { default: CatalogDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/probo/CatalogDocument"),
      ]);

      const blob = await pdf(
        <CatalogDocument
          customerName={customerName.trim()}
          customerLogoDataUrl={customerLogo}
          introTitle={introTitle.trim()}
          introText={introText.trim()}
          branding={{ primary: primaryColor, accent: accentColor }}
          products={catalogProducts}
        />,
      ).toBlob();

      const safeName = (customerName.trim() || "Auswahl").replace(/[^\w\deäöüÄÖÜß -]+/g, "").trim();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Katalog-${safeName || "Auswahl"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      if (skipped.length) {
        toast.warning(`Übersprungen (bei Probo nicht gefunden): ${skipped.join(", ")}`);
      }
      if (withoutImage.length) {
        toast.warning(`Ohne Produktbild erstellt: ${withoutImage.join(", ")}`);
      }
      toast.success(`PDF mit ${catalogProducts.length} Produkten erstellt.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PDF konnte nicht erstellt werden.");
    } finally {
      setGenerating(false);
      setProgress("");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl space-y-6 p-4 pb-24 md:p-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Zurück">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Probo Produktkatalog</h1>
            <p className="text-sm text-muted-foreground">
              Interner Katalog-Generator – Produkte wählen, PDF erzeugen, selbst verschicken.
            </p>
          </div>
        </div>

        {/* Kopfdaten */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deckblatt</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="customerName">Kundenname</Label>
              <Input
                id="customerName"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Muster GmbH"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="introTitle">Intro-Titel</Label>
              <Input
                id="introTitle"
                value={introTitle}
                onChange={(event) => setIntroTitle(event.target.value)}
                placeholder="Produktkatalog"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="introText">Intro-Text</Label>
              <Textarea
                id="introText"
                value={introText}
                onChange={(event) => setIntroText(event.target.value)}
                placeholder="Kurze Einleitung für den Kunden ..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerLogo">Kundenlogo (optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="customerLogo"
                  type="file"
                  accept="image/*"
                  onChange={(event) => void handleLogo(event.target.files?.[0])}
                />
                {customerLogo ? (
                  <Button variant="ghost" size="icon" onClick={() => setCustomerLogo(null)} aria-label="Logo entfernen">
                    <X className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              {customerLogo ? (
                <img src={customerLogo} alt="Kundenlogo" className="mt-2 h-12 object-contain" />
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Branding-Farben</Label>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={primaryColor}
                    onChange={(event) => setPrimaryColor(event.target.value)}
                    className="h-10 w-14 p-1"
                    aria-label="Primärfarbe"
                  />
                  <span className="text-sm text-muted-foreground">Primär</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={accentColor}
                    onChange={(event) => setAccentColor(event.target.value)}
                    className="h-10 w-14 p-1"
                    aria-label="Akzentfarbe"
                  />
                  <span className="text-sm text-muted-foreground">Akzent</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Produktliste */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Produkte {products.length ? `(${filtered.length}/${products.length})` : ""}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => void loadProducts()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Neu laden
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Produkt suchen ..."
                className="pl-9"
              />
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Produktliste wird geladen ...
              </div>
            ) : loadError ? (
              <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
                <p className="text-sm text-destructive">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => void loadProducts()}>
                  Erneut versuchen
                </Button>
              </div>
            ) : !filtered.length ? (
              <p className="py-8 text-sm text-muted-foreground">Keine Produkte gefunden.</p>
            ) : (
              <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
                {filtered.map((product) => (
                  <label
                    key={product.code}
                    className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted"
                  >
                    <Checkbox
                      checked={selectedCodes.includes(product.code)}
                      onCheckedChange={() => toggle(product.code)}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{product.name || product.code}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {product.code}
                        {product.category ? ` · ${product.category}` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Overrides je gewähltem Produkt */}
        {selectedCodes.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auswahl ({selectedCodes.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {selectedCodes.map((code, index) => {
                const product = productByCode.get(code);
                const override = overrides[code] ?? emptyOverride();
                return (
                  <div key={code} className="space-y-3">
                    {index > 0 ? <Separator /> : null}
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{product?.name || code}</p>
                        <p className="text-xs text-muted-foreground">{code}</p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => toggle(code)} aria-label="Entfernen">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`name-${code}`} className="text-xs">
                          Anzeigename (optional)
                        </Label>
                        <Input
                          id={`name-${code}`}
                          value={override.name}
                          onChange={(event) => updateOverride(code, "name", event.target.value)}
                          placeholder={product?.name || code}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`price-${code}`} className="text-xs">
                          Richtpreis (optional)
                        </Label>
                        <Input
                          id={`price-${code}`}
                          value={override.price}
                          onChange={(event) => updateOverride(code, "price", event.target.value)}
                          placeholder="z. B. ab 39 €/m² oder auf Anfrage"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <Label htmlFor={`note-${code}`} className="text-xs">
                          Kurznotiz (ersetzt die Probo-Beschreibung)
                        </Label>
                        <Textarea
                          id={`note-${code}`}
                          value={override.note}
                          onChange={(event) => updateOverride(code, "note", event.target.value)}
                          rows={2}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        {/* Aktion */}
        <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
          {progress ? <span className="text-xs text-muted-foreground">{progress}</span> : null}
          <Button onClick={() => void generatePdf()} disabled={generating || !selectedCodes.length}>
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" />
            )}
            PDF generieren
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProboCatalog;
