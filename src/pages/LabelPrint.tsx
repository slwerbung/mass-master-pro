import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Printer, ArrowLeft, Loader2 } from "lucide-react";
import { getSession } from "@/lib/session";
import { toast } from "sonner";

/**
 * Lager-Etikett Druck-Werkzeug.
 *
 * Workflow:
 *   1) Mitarbeiter sucht ein HERO-Projekt (gleiche Suche wie beim Anlegen
 *      eines Projekts, basiert auf hero-integration `search_projects`).
 *   2) Klick auf ein Suchergebnis übernimmt Projektnummer, Projektname und
 *      Kundenname automatisch ins Etikett.
 *   3) Größe wählen (zwei vordefinierte Maße, beide Querformat).
 *   4) Drucken-Button öffnet den Browser-Druckdialog. Per @media print
 *      und @page wird nur das Etikett mit der gewählten Papiergröße
 *      gedruckt - alles andere ist ausgeblendet.
 *
 * HERO-Upload des PDFs in die Kategorie "Lageretiketten" folgt in einer
 * zweiten Iteration, sobald wir die HERO-CustomerDocumentInput-Felder
 * geklärt haben.
 */

type LabelSize = "klein" | "gross";

const LABEL_SIZES: Record<LabelSize, { wMm: number; hMm: number; label: string }> = {
  // Querformat: längere Seite ist die Breite. Die Werte hier folgen
  // direkt der Etiketten-Spec (59x102 / 104x159 sind Hochformat-Maße,
  // also drehen wir auf 102x59 / 159x104 fürs Querformat-Layout).
  klein: { wMm: 102, hMm: 59, label: "Lager-Etikett klein (59 × 102 mm)" },
  gross: { wMm: 159, hMm: 104, label: "Lager-Etikett groß (104 × 159 mm)" },
};

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

const LabelPrint = () => {
  const navigate = useNavigate();

  const [size, setSize] = useState<LabelSize>("klein");
  const [heroSearch, setHeroSearch] = useState("");
  const [heroResults, setHeroResults] = useState<HeroProject[]>([]);
  const [heroSearching, setHeroSearching] = useState(false);
  const [selectedProject, setSelectedProject] = useState<HeroProject | null>(null);

  // Tick the displayed time every minute so the printed timestamp is
  // accurate even if the page sat open for a while. We don't need
  // second-precision; minute-precision is fine for a storage label.
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Customer name preferred order: company > "Firstname Lastname"
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

  // Debounced auto-search while typing.
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
    // Browser-Druckdialog. Das @page CSS unten setzt das richtige
    // Papierformat. Beim Drucken werden alle .no-print-Elemente
    // ausgeblendet, sodass nur das Etikett auf das Papier kommt.
    window.print();
  };

  const sz = LABEL_SIZES[size];

  return (
    <div className="min-h-screen bg-background">
      {/*
        Print-CSS: setzt @page-Größe und blendet alles außer dem Etikett aus.
        Das @page wird auf die gewählte Größe (klein/groß) gesetzt - durch
        einen dynamischen <style>-Block, weil @page selbst keine CSS-
        Variablen unterstützt.
      */}
      <style>{`
        /* Bildschirm: Druck-Etikett ausblenden, normale Vorschau zeigen */
        @media screen {
          .print-only-label {
            display: none;
          }
          .label-print-area {
            margin: 0 auto;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            border: 1px solid hsl(var(--border));
          }
        }
        /* Druck: Alles ausblenden außer dem Print-Label */
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

      <div className="container max-w-4xl mx-auto px-4 py-6 space-y-6 no-print">
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
              Vorschau wird im Maßstab 1:1 angezeigt. Beim Drucken bitte im
              Druckdialog "Tatsächliche Größe" / "Skalierung 100 %" wählen
              und kein Hinzufügen von Rändern.
            </div>

            <LabelPreview
              widthMm={sz.wMm}
              heightMm={sz.hMm}
              projectNumber={projectNumber}
              projectName={projectName}
              customerName={customerName}
              dateString={dateString}
            />

            <div className="flex gap-2">
              <Button onClick={handlePrint} disabled={!selectedProject} size="lg">
                <Printer className="h-4 w-4 mr-2" /> Drucken
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/*
        Print-Etikett: bleibt im Layout, ist aber im Bildschirm versteckt.
        Im Print-Mode wird nur dieser Block sichtbar (Position fixed, Größe
        wie Papier). So vermeiden wir doppelte Darstellung.
      */}
      {selectedProject && (
        <div className="print-only-label" aria-hidden>
          <LabelArea
            widthMm={sz.wMm}
            heightMm={sz.hMm}
            projectNumber={projectNumber}
            projectName={projectName}
            customerName={customerName}
            dateString={dateString}
            isPrintTarget
          />
        </div>
      )}
    </div>
  );
};

/* ---------- Subcomponents ---------- */

type LabelData = {
  widthMm: number;
  heightMm: number;
  projectNumber: string;
  projectName: string;
  customerName: string;
  dateString: string;
};

const LabelPreview = (data: LabelData) => {
  // On screen we render the label at its real mm-size. We don't downscale -
  // mm units render natively on most modern browsers and represent the
  // physical printout correctly.
  return <LabelArea {...data} />;
};

const LabelArea = ({ widthMm, heightMm, projectNumber, projectName, customerName, dateString, isPrintTarget }: LabelData & { isPrintTarget?: boolean }) => {
  // Layout:
  //   - Black banner taking the upper ~70% of the label.
  //     Inside: project name (top), project number (huge, center),
  //     customer name (bottom). All white text.
  //   - White footer band with date+time in small black text.
  //
  // Font sizes are tuned for the small label and scale up on the big one.
  // We use mm units throughout so screen and print look the same.

  const isLarge = widthMm >= 150;
  const fontProjectNr = isLarge ? "32mm" : "20mm";
  const fontProjectName = isLarge ? "8mm" : "5mm";
  const fontCustomer = isLarge ? "8mm" : "5mm";
  const fontDate = isLarge ? "5mm" : "3.5mm";
  const padding = isLarge ? "5mm" : "3mm";
  const blackHeight = "75%";

  return (
    <div
      className={isPrintTarget ? "label-print-area" : "label-print-area"}
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
          width: "100%",
          height: blackHeight,
          background: "black",
          color: "white",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          alignItems: "center",
          padding,
          boxSizing: "border-box",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: fontProjectName, fontWeight: 500, lineHeight: 1.1, width: "100%", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {projectName || "\u00A0"}
        </div>
        <div style={{ fontSize: fontProjectNr, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em" }}>
          {projectNumber || "\u00A0"}
        </div>
        <div style={{ fontSize: fontCustomer, fontWeight: 500, lineHeight: 1.1, width: "100%", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {customerName || "\u00A0"}
        </div>
      </div>
      <div
        style={{
          width: "100%",
          height: `calc(100% - ${blackHeight})`,
          background: "white",
          color: "black",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: fontDate,
          fontWeight: 400,
        }}
      >
        {dateString}
      </div>
    </div>
  );
};

export default LabelPrint;
