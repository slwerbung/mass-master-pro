import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, FileDown, ArrowLeft, Loader2 } from "lucide-react";
import { getSession } from "@/lib/session";
import { enqueueHeroUploadIfLinked } from "@/lib/heroSyncHelpers";
import { toast } from "sonner";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

/**
 * Lager-Etikett Druck-Werkzeug (v3 - PDF-basiert).
 *
 * Ablauf:
 *   1) Mitarbeiter sucht ein HERO-Projekt.
 *   2) Klick übernimmt Projektnummer, Name, Kunde, HERO-ID.
 *   3) Größe wählen (klein 102x59mm / groß 159x104mm, beide Querformat).
 *   4) "PDF erstellen" generiert ein PDF mit der exakten Etiketten-
 *      größe als Seitenformat. Das PDF wird heruntergeladen UND in
 *      einem neuen Tab geöffnet. Druck erfolgt dann aus dem
 *      PDF-Viewer/Browser - dort gibt's verlässlichere Druckoptionen
 *      als window.print().
 *
 * Das PDF ist später auch das Format, das in HERO als Lageretikett
 * dokumentiert wird (Schritt 2, separat).
 *
 * Layout:
 *   - Außenrand: 1.5mm (Dymo unbedruckbarer Bereich)
 *   - Innen-Rahmen: drei schwarze Blöcke übereinander mit dünnen
 *     weißen Spalten
 *   - Footer-Streifen (~10mm) mit Datum links und QR-Code rechts
 *   - Schwarze Blöcke haben Innen-Padding, sodass Text nicht
 *     bündig am Rand klebt
 */

type LabelSize = "klein" | "gross";

const LABEL_SIZES: Record<LabelSize, { wMm: number; hMm: number; label: string }> = {
  klein: { wMm: 102, hMm: 59, label: "Lager-Etikett klein (59 × 102 mm)" },
  gross: { wMm: 159, hMm: 104, label: "Lager-Etikett groß (104 × 159 mm)" },
};

// Dymo unbedruckbarer Rand
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
  const [generating, setGenerating] = useState(false);

  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // QR-Code generieren bei Auswahl. Höhere Auflösung damit's beim PDF-
  // Embed scharf bleibt - jsPDF skaliert das PNG nur auf die mm-Größe,
  // also lieber großzügig groß rendern.
  useEffect(() => {
    if (!selectedProject) {
      setQrDataUrl("");
      return;
    }
    const url = heroProjectUrl(selectedProject.id);
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 0,
      width: 600,
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

  const generatePdf = async () => {
    if (!selectedProject) {
      toast.error("Erst ein Projekt auswählen");
      return;
    }
    setGenerating(true);
    try {
      const sz = LABEL_SIZES[size];
      const pdf = await buildLabelPdf({
        widthMm: sz.wMm,
        heightMm: sz.hMm,
        projectNumber,
        projectName,
        customerName,
        dateString,
        qrDataUrl,
      });

      // Filename: Projektnummer-Lager-yymmdd.pdf, Sonderzeichen safe
      const safeNr = projectNumber.replace(/[^a-zA-Z0-9-_]/g, "_") || "etikett";
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
      const filename = `Lageretikett_${safeNr}_${datePart}.pdf`;

      // Blob holen für duale Aktion: Tab öffnen + Download
      const blob = pdf.output("blob");
      const blobUrl = URL.createObjectURL(blob);

      // 1) Neuer Tab mit Vorschau (Browser zeigt PDF inline)
      window.open(blobUrl, "_blank");

      // 2) Download anstoßen über versteckten Anchor.
      //    Beide Aktionen mit gleicher Blob-URL nutzbar.
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Blob-URL nach kurzer Zeit freigeben (geben dem Browser Zeit, den
      // Tab zu öffnen und den Download zu starten).
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

      // HERO-Upload: wenn das Projekt aus HERO-Suche kommt, gibts immer
      // eine HERO-Projekt-ID. Wir bauen einen minimalen ProjectLike-Stub
      // und delegieren an die normale Hero-Upload-Pipeline (Worker,
      // Retry, Backoff). selectedProject.id ist die HERO project_match id.
      try {
        const heroProjectMatchId = Number(selectedProject?.id);
        if (Number.isFinite(heroProjectMatchId) && heroProjectMatchId > 0) {
          const stubProject = {
            id: `hero:${heroProjectMatchId}`, // virtueller Projekt-Identifier; LabelPrint hat kein lokales Projekt
            customFields: {
              __hero_project_id: String(heroProjectMatchId),
            },
          } as any;
          await enqueueHeroUploadIfLinked({
            project: stubProject,
            uploadType: "lager_label_pdf",
            blob,
            filename,
          });
          toast.success("Lager-Etikett in HERO hochgeladen ✓");
        }
      } catch (heroErr) {
        // Best-effort - User hat das PDF schon, HERO-Upload ist Bonus.
        console.warn("HERO-Upload fehlgeschlagen:", heroErr);
        toast.warning("PDF erstellt, aber HERO-Upload fehlgeschlagen");
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "PDF-Erstellung fehlgeschlagen");
    } finally {
      setGenerating(false);
    }
  };

  const sz = LABEL_SIZES[size];

  return (
    <div className="min-h-screen bg-background">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;700;800&display=swap"
        rel="stylesheet"
      />
      <style>{`
        .label-font { font-family: 'Barlow', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
        .label-preview {
          margin: 0 auto;
          box-shadow: 0 4px 24px rgba(0,0,0,0.08);
          border: 1px solid hsl(var(--border));
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
            <CardTitle className="text-lg">3. Vorschau & PDF erstellen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Vorschau im Maßstab 1:1. Klick auf "PDF erstellen" öffnet das
              fertige Etikett in einem neuen Tab und startet gleichzeitig den
              Download. Das PDF hat genau die Etiketten-Größe als Seitenformat.
            </div>

            <LabelPreview
              widthMm={sz.wMm}
              heightMm={sz.hMm}
              projectNumber={projectNumber}
              projectName={projectName}
              customerName={customerName}
              dateString={dateString}
              qrDataUrl={qrDataUrl}
            />

            <div className="flex gap-2">
              <Button onClick={generatePdf} disabled={!selectedProject || generating} size="lg">
                {generating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Erstelle...</>
                ) : (
                  <><FileDown className="h-4 w-4 mr-2" /> PDF erstellen</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

/* ---------- HTML Preview (visual only - PDF is generated separately) ---------- */

type LabelData = {
  widthMm: number;
  heightMm: number;
  projectNumber: string;
  projectName: string;
  customerName: string;
  dateString: string;
  qrDataUrl: string;
};

const LabelPreview = ({
  widthMm,
  heightMm,
  projectNumber,
  projectName,
  customerName,
  dateString,
  qrDataUrl,
}: LabelData) => {
  // Identical layout-math to buildLabelPdf below, just rendered as HTML
  // for screen preview. Both should produce visually the same output.
  const layout = computeLayout(widthMm, heightMm);

  return (
    <div
      className="label-preview label-font"
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
          width: `${layout.innerW}mm`,
          height: `${layout.innerH}mm`,
          display: "flex",
          flexDirection: "column",
          gap: `${layout.gap}mm`,
        }}
      >
        <BlackBlock
          heightMm={layout.blockSide}
          fontMm={layout.fontSide}
          weight={700}
          paddingMm={layout.blockPadX}
        >
          {projectName || "\u00A0"}
        </BlackBlock>

        <BlackBlock
          heightMm={layout.blockNumber}
          fontMm={layout.fontNumber}
          weight={800}
          paddingMm={layout.blockPadX}
          tightLineHeight
        >
          {projectNumber || "\u00A0"}
        </BlackBlock>

        <BlackBlock
          heightMm={layout.blockSide}
          fontMm={layout.fontSide}
          weight={700}
          paddingMm={layout.blockPadX}
        >
          {customerName || "\u00A0"}
        </BlackBlock>

        <div
          style={{
            height: `${layout.footerH}mm`,
            background: "white",
            color: "black",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `0 ${layout.blockPadX}mm`,
            fontSize: `${layout.fontFooter}mm`,
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
                width: `${layout.qrSize}mm`,
                height: `${layout.qrSize}mm`,
                objectFit: "contain",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const BlackBlock = ({
  heightMm,
  fontMm,
  weight,
  paddingMm,
  tightLineHeight,
  children,
}: {
  heightMm: number;
  fontMm: number;
  weight: number;
  paddingMm: number;
  tightLineHeight?: boolean;
  children: React.ReactNode;
}) => (
  <div
    style={{
      height: `${heightMm}mm`,
      background: "black",
      color: "white",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: `${fontMm}mm`,
      fontWeight: weight,
      lineHeight: tightLineHeight ? 1 : 1.1,
      letterSpacing: tightLineHeight ? "-0.01em" : "0.01em",
      padding: `0 ${paddingMm}mm`,
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
      boxSizing: "border-box",
    }}
  >
    {children}
  </div>
);

/* ---------- Layout math (shared between preview and PDF) ---------- */

type Layout = {
  innerW: number;
  innerH: number;
  gap: number;
  footerH: number;
  blockSide: number;
  blockNumber: number;
  blockPadX: number;
  qrSize: number;
  fontNumber: number;
  fontSide: number;
  fontFooter: number;
};

function computeLayout(widthMm: number, heightMm: number): Layout {
  const isLarge = widthMm >= 150;

  // Verfügbarer Innenraum nach Dymo-Margins
  const innerW = widthMm - 2 * DYMO_MARGIN_MM;
  const innerH = heightMm - 2 * DYMO_MARGIN_MM;

  // Spalt zwischen den schwarzen Blöcken (sichtbares Weiß)
  const gap = isLarge ? 1.8 : 1.2;

  // Footer-Streifen für Datum + QR. Etwas größer als zuvor, damit der
  // QR-Code lesbar bleibt - im Footer-Innenraum sitzt der QR.
  const footerH = isLarge ? 16 : 11;

  // Drei schwarze Blöcke teilen sich den restlichen Raum, mit gap
  // zwischen ihnen UND zum Footer.
  const blocksTotal = innerH - footerH - 3 * gap;
  const blockNumber = blocksTotal * 0.55;
  const blockSide = blocksTotal * 0.225;

  // Innen-Padding der Blöcke - der Text läuft NICHT bündig an den Rand
  const blockPadX = isLarge ? 6 : 4;

  // QR-Code: nutzt die volle Footer-Höhe abzüglich kleinem Padding
  const qrSize = footerH - 1.5;

  // Schriftgrößen anteilig zur Block-Höhe. Die Projektnummer-Schrift
  // hat eine Obergrenze (sonst wird sie absurd groß bei langen
  // Etiketten), die beiden Side-Blöcke sind kleiner.
  const fontNumber = Math.min(blockNumber * 0.85, isLarge ? 32 : 20);
  const fontSide = Math.min(blockSide * 0.7, isLarge ? 7 : 5);
  const fontFooter = Math.min(footerH * 0.4, isLarge ? 4 : 3);

  return { innerW, innerH, gap, footerH, blockSide, blockNumber, blockPadX, qrSize, fontNumber, fontSide, fontFooter };
}

/* ---------- PDF generation ---------- */

// ─── Barlow font loader ──────────────────────────────────────────────
//
// jsPDF only ships with Helvetica/Times/Courier by default. To embed
// Barlow (our brand font) in the printable PDF, we fetch the TTF files
// at runtime, base64-encode them, and register them via the jsPDF
// virtual filesystem. The result is cached in module scope so
// subsequent prints in the same session skip the fetch+encode work.
//
// We fetch from gstatic (Google Fonts CDN) which the app already uses
// via the <link> tag in the on-screen label, so the asset is usually
// already in the browser cache. The TTFs are ~120 KB each, so the
// total cold-load adds ~250 KB to the first PDF generation.
//
// If the fetch fails (offline, CDN blocked) we fall back gracefully to
// Helvetica - it's not Barlow, but the print still happens.

// URLs derived from Google Fonts CSS API (fonts.googleapis.com/css2?family=Barlow:wght@400;700).
// Update by running: curl -s "https://fonts.googleapis.com/css2?family=Barlow:wght@400;700&display=swap" | grep -o 'https://fonts.gstatic.com[^)]*'
const BARLOW_URLS = {
  regular: "https://fonts.gstatic.com/s/barlow/v13/7cHpv4kjgoGqM7EPCw.ttf",
  bold:    "https://fonts.gstatic.com/s/barlow/v13/7cHqv4kjgoGqM7E3t-4c4A.ttf",
};

let barlowCache: { regular: string; bold: string } | null = null;
// Reset on each generatePdf call so transient network failures don't
// permanently disable the font for the rest of the session.
let barlowLoadFailed = false;

async function fetchFontAsBase64(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Font fetch failed: ${r.status}`);
  const buf = await r.arrayBuffer();
  // Convert ArrayBuffer to base64 in chunks to avoid huge call-stack
  // arguments on big TTFs.
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

async function ensureBarlowLoaded(): Promise<{ regular: string; bold: string } | null> {
  if (barlowCache) return barlowCache;
  if (barlowLoadFailed) return null;
  try {
    const [regular, bold] = await Promise.all([
      fetchFontAsBase64(BARLOW_URLS.regular),
      fetchFontAsBase64(BARLOW_URLS.bold),
    ]);
    barlowCache = { regular, bold };
    return barlowCache;
  } catch (e) {
    console.warn("Barlow font load failed, falling back to Helvetica", e);
    barlowLoadFailed = true;
    return null;
  }
}

function registerBarlow(pdf: jsPDF, fonts: { regular: string; bold: string }) {
  pdf.addFileToVFS("Barlow-Regular.ttf", fonts.regular);
  pdf.addFont("Barlow-Regular.ttf", "Barlow", "normal");
  pdf.addFileToVFS("Barlow-Bold.ttf", fonts.bold);
  pdf.addFont("Barlow-Bold.ttf", "Barlow", "bold");
}

async function buildLabelPdf(d: LabelData): Promise<jsPDF> {
  // PDF-Seitengröße = exakte Etikettengröße in mm. jsPDF macht
  // anschließend alles in mm-Einheiten, sodass die Layout-Mathematik
  // direkt 1:1 abgebildet werden kann.
  const pdf = new jsPDF({
    orientation: d.widthMm > d.heightMm ? "landscape" : "portrait",
    unit: "mm",
    format: [d.widthMm, d.heightMm],
    compress: true,
  });

  // Reset failure flag so every PDF generation gets a fresh attempt.
  // This prevents a transient network error from permanently disabling
  // the font for the rest of the session.
  if (barlowLoadFailed && !barlowCache) barlowLoadFailed = false;

  // Lade & registriere die Marken-Schrift Barlow. Wenn der Download
  // scheitert (z.B. offline), nutzt ensureBarlowLoaded() null zurück
  // und wir fallen auf Helvetica zurück - PDF wird trotzdem erstellt.
  const barlow = await ensureBarlowLoaded();
  const fontFamily = barlow ? "Barlow" : "helvetica";
  if (barlow) registerBarlow(pdf, barlow);

  pdf.setFont(fontFamily, "bold");

  const layout = computeLayout(d.widthMm, d.heightMm);

  // Origin der Inhaltsfläche (innerhalb Dymo-Margins)
  const ox = DYMO_MARGIN_MM;
  const oy = DYMO_MARGIN_MM;

  // Block 1: Projektname (oben)
  const block1Y = oy;
  drawBlackTextBlock(pdf, ox, block1Y, layout.innerW, layout.blockSide, d.projectName, layout.fontSide, layout.blockPadX, "bold", fontFamily);

  // Block 2: Projektnummer (mittig, groß)
  const block2Y = block1Y + layout.blockSide + layout.gap;
  drawBlackTextBlock(pdf, ox, block2Y, layout.innerW, layout.blockNumber, d.projectNumber, layout.fontNumber, layout.blockPadX, "bold", fontFamily);

  // Block 3: Kunde (unten)
  const block3Y = block2Y + layout.blockNumber + layout.gap;
  drawBlackTextBlock(pdf, ox, block3Y, layout.innerW, layout.blockSide, d.customerName, layout.fontSide, layout.blockPadX, "bold", fontFamily);

  // Footer: Datum + QR
  const footerY = block3Y + layout.blockSide + layout.gap;

  // Datum (links)
  pdf.setFont(fontFamily, "normal");
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(mmToPt(layout.fontFooter));
  // Vertikal mittig im Footer-Streifen ausrichten
  const dateBaselineY = footerY + layout.footerH / 2 + mmToPt(layout.fontFooter) * 0.35 / 2.83465;
  pdf.text(d.dateString, ox + layout.blockPadX, dateBaselineY, { baseline: "middle" });

  // QR-Code (rechts)
  if (d.qrDataUrl) {
    const qrX = ox + layout.innerW - layout.qrSize - layout.blockPadX;
    const qrY = footerY + (layout.footerH - layout.qrSize) / 2;
    try {
      pdf.addImage(d.qrDataUrl, "PNG", qrX, qrY, layout.qrSize, layout.qrSize, undefined, "FAST");
    } catch (e) {
      console.warn("QR-Embed fehlgeschlagen:", e);
    }
  }

  return pdf;
}

function drawBlackTextBlock(
  pdf: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  fontMm: number,
  padX: number,
  weight: "normal" | "bold",
  fontFamily: string = "helvetica"
) {
  // Schwarzer gefüllter Rechteck
  pdf.setFillColor(0, 0, 0);
  pdf.rect(x, y, w, h, "F");

  if (!text) return;

  // Weiße Schrift, mittig
  pdf.setTextColor(255, 255, 255);
  pdf.setFont(fontFamily, weight);
  pdf.setFontSize(mmToPt(fontMm));

  // Text horizontal zentriert in der mittleren x-Position
  const centerX = x + w / 2;
  const centerY = y + h / 2;

  // Falls der Text breiter ist als der verfügbare Platz, dynamisch
  // verkleinern statt clipping
  const availableWidth = w - 2 * padX;
  let actualFontMm = fontMm;
  let textWidthMm = pdf.getTextWidth(text);
  while (textWidthMm > availableWidth && actualFontMm > 1) {
    actualFontMm -= 0.5;
    pdf.setFontSize(mmToPt(actualFontMm));
    textWidthMm = pdf.getTextWidth(text);
  }

  pdf.text(text, centerX, centerY, { align: "center", baseline: "middle" });
}

// jsPDF wants pt for setFontSize. 1mm = 2.83465 pt
function mmToPt(mm: number): number {
  return mm * 2.83465;
}

export default LabelPrint;
