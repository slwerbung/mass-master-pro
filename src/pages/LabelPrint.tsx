import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Printer, ArrowLeft, Loader2 } from "lucide-react";
import { getSession } from "@/lib/session";
import { toast } from "sonner";
import QRCode from "qrcode";

/**
 * Lager-Etikett Druck-Werkzeug.
 *
 * Ablauf:
 *   1) Mitarbeiter sucht ein HERO-Projekt.
 *   2) Klick auf ein Suchergebnis übernimmt Projektnummer, Name, Kunde
 *      und HERO-ID.
 *   3) Größe wählen (klein 102x59mm / groß 159x104mm, beide Querformat).
 *   4) Drucken-Button öffnet Browser-Druckdialog. Beim ersten Mal Dymo
 *      auswählen + Skalierung "Tatsächliche Größe", danach merkt Chrome
 *      sich die Auswahl - jeder weitere Druck ist nur 1x Enter.
 *
 * QR-Code unten rechts verlinkt auf das HERO-Projekt
 * (login.hero-software.de/partner/Projects/view/<id>). Mobiles Scannen
 * öffnet entweder die Browser-Seite oder die HERO-App (je nach Setup
 * des scannenden Geräts).
 *
 * Layout-Anpassungen ggü. erster Iteration:
 *   - Dymo-typischer 1.5 mm Druckrand wird respektiert (Inhalt bleibt
 *     innerhalb)
 *   - Schwarzer Bereich in 3 separate Blöcke geteilt (Name, Nummer,
 *     Kunde), durch dünne weiße Spalten getrennt
 *   - Datum-Footer kompakt (4mm)
 *   - QR-Code im rechten Bereich des Datumstreifens
 *   - Schrift: Barlow (DIN-nah, Google Font)
 */

type LabelSize = "klein" | "gross";

const LABEL_SIZES: Record<LabelSize, { wMm: number; hMm: number; label: string }> = {
  // Querformat: Breite > Höhe
  klein: { wMm: 102, hMm: 59, label: "Lager-Etikett klein (59 × 102 mm)" },
  gross: { wMm: 159, hMm: 104, label: "Lager-Etikett groß (104 × 159 mm)" },
};

// Unbedruckbarer Rand auf Dymo LabelWriter. ~1.5 mm an allen Seiten ist
// ein sicherer Wert für die meisten Modelle (4XL, 450, 550, 5XL).
const DYMO_MARGIN_MM = 1.5;

type HeroProject = {
  id: number | string;
  project_nr?: string | null;
  name?: string | null;
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
    company_name?: string | null;
  } | null;
};

const heroProjectUrl = (heroId: number | string) =>
  `https://login.hero-software.de/partner/Projects/view/${heroId}`;

const LabelPrint = () => {
  const navigate = useNavigate();

  const [size, setSize] = useState<LabelSize>("klein");
  const [heroSearch, setHeroSearch] = useState("");
  const [heroResults, setHeroResults] = useState<HeroProject[]>([]);
  const [heroSearching, setHeroSearching] = useState(false);
  const [selectedProject, setSelectedProject] = useState<HeroProject | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  // Datum + Uhrzeit aktualisieren wir minutenweise damit der Aufdruck
  // bei längerem Stehen aktuell bleibt.
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // QR-Code generieren, sobald ein Projekt ausgewählt ist. Erzeugt eine
  // PNG Data-URL mit hoher Auflösung (für scharfen Druck). Ecke L
  // (Error correction Low) reicht hier - keine wahrscheinliche
  // Verschmutzung in der Innenlagerung.
  useEffect(() => {
    if (!selectedProject) {
      setQrDataUrl("");
      return;
    }
    const url = heroProjectUrl(selectedProject.id);
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "L",
      margin: 0,
      width: 320,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [selectedProject]);

  const customerName = useMemo(() => {
    const c = selectedProject?.customer;
    if (!c) return "";
    if (c.company_name) return c.company_name;
    return [c.first_name, c.last_name].filter(Boolean).join(" ") || "";
  }, [selectedProject]);

  const projectNumber = selectedProject?.project_nr || "";
  const projectName = selectedProject?.name || "";

  const dateString = useMemo(() => {
    const d = now;
    const date = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    return `${date} · ${time}`;
  }, [now]);

  const searchHeroProjects = async (term: string) => {
    if (!term.trim()) { setHeroResults([]); return; }
    const session = getSession();
    if (!session?.authToken) {
      toast.error("Bitte erneut anmelden");
      return;
    }
    setHeroSearching(true);
    try {
      const tokenField = session.role === "admin" ? "adminToken" : "employeeToken";
      const { data, error } = await supabase.functions.invoke("hero-integration", {
        body: { action: "search_projects", search: term, [tokenField]: session.authToken },
      });
      if (error) {
        toast.error("HERO-Suche fehlgeschlagen");
        return;
      }
      setHeroResults(data?.projects || []);
    } catch {
      toast.error("HERO-Suche fehlgeschlagen");
    } finally {
      setHeroSearching(false);
    }
  };

  useEffect(() => {
    if (!heroSearch.trim()) { setHeroResults([]); return; }
    const t = setTimeout(() => searchHeroProjects(heroSearch), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroSearch]);

  const selectProject = (p: HeroProject) => {
    setSelectedProject(p);
    setHeroResults([]);
    setHeroSearch("");
  };

  const clearSelection = () => {
    setSelectedProject(null);
  };

  const handlePrint = () => {
    if (!selectedProject) {
      toast.error("Erst ein Projekt auswählen");
      return;
    }
    // Auto-Print: Kurz timeout damit der Browser den Render-Pass abschließt
    // (besonders die QR-Image-Ladung), dann window.print(). Chrome merkt
    // sich Drucker + Format zwischen Aufrufen, sodass nach dem ersten
    // Setup ein einziges Enter reicht.
    setTimeout(() => window.print(), 50);
  };

  const sz = LABEL_SIZES[size];

  return (
    <div className="min-h-screen bg-background">
      {/* Barlow font from Google Fonts. Loaded inline so we don't need
          a project-wide tailwind/CSS edit just for this page. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;700;800&display=swap"
        rel="stylesheet"
      />

      <style>{`
        .label-font { font-family: 'Barlow', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
        @media screen {
          .print-only-label { display: none; }
          .label-print-area {
            margin: 0 auto;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            border: 1px solid hsl(var(--border));
          }
        }
        @media print {
          @page {
            size: ${sz.wMm}mm ${sz.hMm}mm;
            margin: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }
          body * { visibility: hidden !important; }
          .print-only-label, .print-only-label * { visibility: visible !important; }
          .print-only-label {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: ${sz.wMm}mm !important;
            height: ${sz.hMm}mm !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print-only-label .label-print-area {
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
          }
        }
      `}</style>

      <div className="container max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/projects")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Zurück
          </Button>
          <h1 className="text-2xl font-bold">Lager-Etiketten drucken</h1>
          <div className="w-[88px]" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">1. Etiketten-Größe</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.keys(LABEL_SIZES) as LabelSize[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  className={`border rounded-lg p-4 text-left transition-colors ${
                    size === s
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="font-medium">{LABEL_SIZES[s].label}</div>
                  <div className="text-xs text-muted-foreground mt-1">Querformat</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2. Projekt aus HERO suchen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="hero-search">Suche</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="hero-search"
                  className="pl-9"
                  placeholder="Projektnummer, Name, Kunde..."
                  value={heroSearch}
                  onChange={(e) => setHeroSearch(e.target.value)}
                  autoFocus
                />
                {heroSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>

            {heroResults.length > 0 && (
              <div className="border rounded-lg divide-y max-h-72 overflow-auto">
                {heroResults.map((p) => {
                  const cName = p.customer?.company_name
                    || [p.customer?.first_name, p.customer?.last_name].filter(Boolean).join(" ")
                    || "";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProject(p)}
                      className="w-full text-left p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="font-medium">{p.project_nr} — {p.name || "(ohne Name)"}</div>
                      {cName && <div className="text-xs text-muted-foreground mt-0.5">{cName}</div>}
                    </button>
                  );
                })}
              </div>
            )}

            {selectedProject && (
              <div className="border rounded-lg p-3 bg-muted/30 flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Ausgewählt</div>
                  <div className="font-medium">{projectNumber} — {projectName}</div>
                  {customerName && <div className="text-sm text-muted-foreground">{customerName}</div>}
                </div>
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  Ändern
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">3. Vorschau & Drucken</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Vorschau im Maßstab 1:1. Beim ersten Druck im Dialog Dymo auswählen
              und Skalierung "Tatsächliche Größe" / 100% setzen. Chrome merkt
              sich die Auswahl - danach genügt 1× Enter.
            </div>

            <LabelArea
              widthMm={sz.wMm}
              heightMm={sz.hMm}
              projectNumber={projectNumber}
              projectName={projectName}
              customerName={customerName}
              dateString={dateString}
              qrDataUrl={qrDataUrl}
            />

            <div className="flex gap-2">
              <Button onClick={handlePrint} disabled={!selectedProject} size="lg">
                <Printer className="h-4 w-4 mr-2" /> Drucken
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Druck-Element: bleibt im Layout, ist aber per CSS auf dem
          Bildschirm versteckt. Im Print-Mode wird nur dieses sichtbar. */}
      {selectedProject && (
        <div className="print-only-label" aria-hidden>
          <LabelArea
            widthMm={sz.wMm}
            heightMm={sz.hMm}
            projectNumber={projectNumber}
            projectName={projectName}
            customerName={customerName}
            dateString={dateString}
            qrDataUrl={qrDataUrl}
          />
        </div>
      )}
    </div>
  );
};

/* ---------- Label rendering ---------- */

type LabelData = {
  widthMm: number;
  heightMm: number;
  projectNumber: string;
  projectName: string;
  customerName: string;
  dateString: string;
  qrDataUrl: string;
};

const LabelArea = ({
  widthMm,
  heightMm,
  projectNumber,
  projectName,
  customerName,
  dateString,
  qrDataUrl,
}: LabelData) => {
  // Layout (Querformat, Werte in mm):
  //
  //   +---------------------------------------------+   <- Außenrahmen = Etikett
  //   |                                             |
  //   |  +---------------------------------------+  |   <- Innenrahmen
  //   |  | [schwarzer Block: Projektname]        |  |     respektiert Dymo-Rand
  //   |  +---------------------------------------+  |     (1.5mm) und Spalt
  //   |  | [schwarzer Block: PROJEKTNUMMER GROß] |  |
  //   |  +---------------------------------------+  |
  //   |  | [schwarzer Block: Kundenname]         |  |
  //   |  +---------------------------------------+  |
  //   |  | Datum/Uhrzeit              [QR-Code]  |  |
  //   |  +---------------------------------------+  |
  //   |                                             |
  //   +---------------------------------------------+
  //
  // Größen sind anteilig zur Höhe. Das skaliert klein/groß automatisch.
  //
  // Wichtig: alle Maße in mm, damit Bildschirmvorschau und Druck identisch
  // aussehen.

  const isLarge = widthMm >= 150;

  // Spalte zwischen den schwarzen Blöcken (sichtbares Weiß).
  const gap = isLarge ? 1.5 : 1.0;

  // Footer-Zeile mit Datum + QR
  const footerH = isLarge ? 12 : 8;

  // Verfügbarer Innenraum nach Dymo-Margins
  const innerW = widthMm - 2 * DYMO_MARGIN_MM;
  const innerH = heightMm - 2 * DYMO_MARGIN_MM;

  // Höhen der drei schwarzen Blöcke. Mittlerer (Projektnummer) bekommt
  // den Großteil, oben und unten je ein schmalerer Block.
  // Verbleibende Höhe für Blocks = innerH - footerH - 2*gap (zwischen 3 Blöcken)
  const blocksTotal = innerH - footerH - 3 * gap;
  const blockNumber = blocksTotal * 0.55;
  const blockSide = blocksTotal * 0.225; // jeweils Name + Kunde

  // Schriftgrößen: skaliert mit Block-Höhe für saubere Optik
  const fontProjectNr = `${Math.min(blockNumber * 0.85, isLarge ? 36 : 22)}mm`;
  const fontSide = `${Math.min(blockSide * 0.7, isLarge ? 7 : 5)}mm`;
  const fontFooter = `${Math.min(footerH * 0.45, isLarge ? 4 : 3)}mm`;

  // QR-Code passt in den Footer (etwas größer als Schrift)
  const qrSize = footerH - 1; // 1mm Padding oben/unten

  return (
    <div
      className="label-print-area label-font"
      style={{
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        background: "white",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: `${DYMO_MARGIN_MM}mm`,
          left: `${DYMO_MARGIN_MM}mm`,
          width: `${innerW}mm`,
          height: `${innerH}mm`,
          display: "flex",
          flexDirection: "column",
          gap: `${gap}mm`,
        }}
      >
        {/* Block 1: Projektname */}
        <div
          style={{
            height: `${blockSide}mm`,
            background: "black",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSide,
            fontWeight: 700,
            letterSpacing: "0.01em",
            padding: "0 2mm",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            boxSizing: "border-box",
          }}
        >
          {projectName || "\u00A0"}
        </div>

        {/* Block 2: Projektnummer (zentral & groß) */}
        <div
          style={{
            height: `${blockNumber}mm`,
            background: "black",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontProjectNr,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: "-0.01em",
          }}
        >
          {projectNumber || "\u00A0"}
        </div>

        {/* Block 3: Kunde */}
        <div
          style={{
            height: `${blockSide}mm`,
            background: "black",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: fontSide,
            fontWeight: 700,
            letterSpacing: "0.01em",
            padding: "0 2mm",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            boxSizing: "border-box",
          }}
        >
          {customerName || "\u00A0"}
        </div>

        {/* Footer: Datum links, QR rechts */}
        <div
          style={{
            height: `${footerH}mm`,
            background: "white",
            color: "black",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 1mm",
            fontSize: fontFooter,
            fontWeight: 500,
            boxSizing: "border-box",
          }}
        >
          <span>{dateString}</span>
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="QR"
              style={{
                width: `${qrSize}mm`,
                height: `${qrSize}mm`,
                objectFit: "contain",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default LabelPrint;
