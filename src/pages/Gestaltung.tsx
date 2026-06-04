import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Sparkles, Eye, Megaphone, Check, ArrowLeft, ArrowRight, Upload, X,
  FileText, Loader2, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

// ── Vehicle Branding Design Finder ────────────────────────────────────
// A guided, visual configurator that turns a customer's gut feeling into
// a usable designer briefing. Reached from the vehicle-inquiry success
// screen via /gestaltung?project=<id>&hero=<heroId>.
//
// 4 steps: style direction → content priorities → design favorites
// (A/B + no-gos + inspiration upload) → generated summary.
//
// On finish the briefing is written to HERO partner_notes AND stored in
// Supabase (vehicle_design_briefings) via the submit-design-briefing
// edge function. Built in the app's existing stack (Vite + React +
// Tailwind + shadcn) - no Next/Framer; transitions are CSS.

type Variant = "premium" | "balanced" | "attention";
type ABChoice = "A" | "B";

interface BriefingState {
  variant: Variant | null;
  priorities: string[];        // max 3
  additionalContent: string[];
  comparison: ABChoice | null;
  noGos: string[];
  inspiration: { dataUrl: string; name: string }[];
}

const STYLE_OPTIONS: {
  id: Variant; title: string; description: string; icon: any;
  characteristics: string[]; recommendedFor: string; badge?: string; image: string;
}[] = [
  {
    id: "premium",
    title: "Minimal & Hochwertig",
    description: "Elegant, klar und reduziert mit Premium-Anmutung.",
    icon: Sparkles,
    characteristics: ["wenig Text", "klares Layout", "Premium-Look"],
    recommendedFor: "Architekten, Premium-Dienstleister, High-End-Marken",
    // PLATZHALTER – später durch echtes Beispielfoto ersetzen, z.B.
    // ein Bild in public/gestaltung/ ablegen und hier "/gestaltung/premium.jpg" setzen.
    image: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800&q=80",
  },
  {
    id: "balanced",
    title: "Ausgewogen & Professionell",
    description: "Beste Balance aus Sichtbarkeit und professionellem Auftritt.",
    icon: Eye,
    characteristics: ["modern", "sichtbar aber sauber", "universell"],
    recommendedFor: "die meisten Betriebe, Handwerk, Dienstleister",
    badge: "AM HÄUFIGSTEN GEWÄHLT",
    image: "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=800&q=80",
  },
  {
    id: "attention",
    title: "Auffällig & Werbewirksam",
    description: "Maximale Sichtbarkeit und starke Werbewirkung.",
    icon: Megaphone,
    characteristics: ["hohe Sichtbarkeit", "starke Werbewirkung", "große Flächen"],
    recommendedFor: "lokale Dienste, Straßensichtbarkeit, werbestarke Betriebe",
    image: "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=800&q=80",
  },
];

// A/B-Vergleichsbilder (Schritt 3). Ebenfalls Platzhalter – später durch
// echte Beispiel-Fahrzeugbeschriftungen ersetzen.
const COMPARISON_IMAGES = {
  A: "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800&q=80",
  B: "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=800&q=80",
};

const PRIORITY_OPTIONS = [
  "Firmenname", "Telefonnummer", "Leistungen", "Logo", "Website",
  "Vertrauen", "Premium-Auftritt", "Regionale Identität",
];
const ADDITIONAL_OPTIONS = [
  "Logo", "Telefonnummer", "Website", "E-Mail", "QR-Code", "Leistungen",
  "Social Media", "Slogan", "Standort", "Bewertungen",
];
const NOGO_OPTIONS = [
  "Zu bunt", "Zu verspielt", "Zu aggressiv", "Zu überladen",
  "Zu technisch", "Zu viele Bilder", "Zu viel Text", "Zu billig wirkend",
];

const STEPS = ["Stil", "Inhalte", "Design", "Zusammenfassung"];

export default function Gestaltung() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get("project") || "";
  const heroId = params.get("hero") || "";

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<BriefingState>({
    variant: null,
    priorities: [],
    additionalContent: [],
    comparison: null,
    noGos: [],
    inspiration: [],
  });

  const set = (patch: Partial<BriefingState>) => setState(s => ({ ...s, ...patch }));

  const toggleInArray = (key: "priorities" | "additionalContent" | "noGos", value: string, max?: number) => {
    setState(s => {
      const cur = s[key];
      if (cur.includes(value)) return { ...s, [key]: cur.filter(v => v !== value) };
      if (max && cur.length >= max) return s; // respect cap
      return { ...s, [key]: [...cur, value] };
    });
  };

  const canAdvance = useMemo(() => {
    if (step === 0) return state.variant !== null;
    if (step === 1) return state.priorities.length > 0;
    if (step === 2) return state.comparison !== null;
    return true;
  }, [step, state]);

  const onPickInspiration = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (state.inspiration.length >= 5) break;
      if (!/^image\/(jpe?g|png)$|^application\/pdf$/.test(f.type)) {
        toast.error("Nur JPG, PNG oder PDF");
        continue;
      }
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error("Lesefehler"));
        r.readAsDataURL(f);
      });
      setState(s => ({ ...s, inspiration: [...s.inspiration, { dataUrl, name: f.name }] }));
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  // Derives a short style profile from the selections, mirroring the
  // generatedAnalysisLogic in the spec.
  const analysis = useMemo(() => {
    const v = state.variant;
    const styleProfile =
      v === "premium" ? "modern-premium"
      : v === "attention" ? "werbestark"
      : "ausgewogen-modern";
    const visibility =
      v === "attention" || state.priorities.length >= 3 ? "hoch"
      : v === "premium" ? "dezent" : "mittel";
    const contentDensity =
      state.additionalContent.length >= 6 ? "hoch"
      : state.additionalContent.length >= 3 ? "mittel" : "gering";
    const risk = state.noGos.length === 0 ? "offen" : "klar abgegrenzt";
    return { styleProfile, visibility, contentDensity, risk };
  }, [state]);

  const buildBriefingText = (): string => {
    const variantLabel = STYLE_OPTIONS.find(o => o.id === state.variant)?.title || "—";
    const lines: string[] = [];
    lines.push("=== GESTALTUNGS-BRIEFING (Fahrzeugbeschriftung) ===");
    lines.push("");
    lines.push(`Stil-Richtung: ${variantLabel}`);
    lines.push("");
    lines.push("Wichtigste Botschaften (Priorität):");
    state.priorities.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
    if (state.additionalContent.length) {
      lines.push("");
      lines.push("Zusätzliche Inhalte: " + state.additionalContent.join(", "));
    }
    lines.push("");
    lines.push(`Design-Tendenz: ${state.comparison === "A" ? "Minimalistisch" : state.comparison === "B" ? "Werbewirksam" : "—"}`);
    if (state.noGos.length) {
      lines.push("");
      lines.push("No-Gos: " + state.noGos.join(", "));
    }
    lines.push("");
    lines.push("Automatische Stil-Analyse:");
    lines.push(`  Stil-Profil: ${analysis.styleProfile}`);
    lines.push(`  Sichtbarkeit: ${analysis.visibility}`);
    lines.push(`  Inhaltsdichte: ${analysis.contentDensity}`);
    lines.push(`  Risiko-Abgrenzung: ${analysis.risk}`);
    if (state.inspiration.length) {
      lines.push("");
      lines.push(`Inspirations-Uploads: ${state.inspiration.length} Datei(en) beigefügt`);
    }
    return lines.join("\n");
  };

  const finish = async () => {
    if (!projectId) { toast.error("Kein Projekt angegeben"); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-design-briefing", {
        body: {
          projectId,
          heroProjectId: heroId || null,
          briefingText: buildBriefingText(),
          briefing: {
            variant: state.variant,
            priorities: state.priorities,
            additionalContent: state.additionalContent,
            comparison: state.comparison,
            noGos: state.noGos,
            analysis,
          },
          inspiration: state.inspiration,
        },
      });
      if (error) { toast.error("Senden fehlgeschlagen: " + error.message); return; }
      if (!data?.ok) { toast.error(data?.error || "Senden fehlgeschlagen"); return; }
      if (data.hero && data.hero.ok === false) {
        toast.warning("Briefing gespeichert, HERO-Sync teilweise fehlgeschlagen");
      }
      setDone(true);
    } catch (e: any) {
      toast.error("Fehler: " + (e.message || String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  if (!projectId) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <h2 className="text-xl font-bold">Kein Projekt angegeben</h2>
          <p className="text-muted-foreground">Dieser Link ist ungültig oder unvollständig.</p>
          <Button onClick={() => navigate("/")}>Zur Startseite</Button>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full p-8 text-center space-y-4">
          <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto" />
          <h2 className="text-2xl font-bold">Briefing erstellt</h2>
          <p className="text-muted-foreground">
            Vielen Dank! Ihre Gestaltungswünsche wurden erfasst und an unser
            Designteam übermittelt. Wir entwickeln daraus erste Entwürfe.
          </p>
          <Button className="w-full" onClick={() => navigate("/")}>Zur Startseite</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold transition-colors ${
                    i < step ? "bg-primary text-primary-foreground"
                    : i === step ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                    : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i < step ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className={`text-sm hidden sm:inline ${i === step ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
              </div>
            ))}
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" />
        </div>

        {/* ─── Step 0: Style direction ─────────────────────────── */}
        {step === 0 && (
          <div className="space-y-5 animate-in fade-in duration-300">
            <div>
              <h1 className="text-2xl font-bold">Welche Art der Fahrzeugbeschriftung passt zu Ihrem Betrieb?</h1>
              <p className="text-muted-foreground mt-1">Wählen Sie die grundlegende Design-Richtung.</p>
            </div>
            <div className="grid gap-3">
              {STYLE_OPTIONS.map(opt => {
                const Icon = opt.icon;
                const active = state.variant === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => set({ variant: opt.id })}
                    className={`text-left rounded-xl border-2 overflow-hidden transition-all hover:scale-[1.01] ${
                      active ? "border-primary bg-primary/5 shadow-md" : "border-border hover:border-primary/40"
                    }`}
                  >
                    {/* Visual preview strip */}
                    <div className="relative h-32 bg-muted overflow-hidden">
                      <img
                        src={opt.image}
                        alt={opt.title}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                      <div className={`absolute top-2 left-2 rounded-lg p-2 backdrop-blur-sm ${active ? "bg-primary text-primary-foreground" : "bg-background/80 text-foreground"}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      {opt.badge && (
                        <span className="absolute top-2 right-2 text-[10px] font-bold uppercase tracking-wide bg-accent text-accent-foreground rounded-full px-2 py-0.5">{opt.badge}</span>
                      )}
                      {active && (
                        <div className="absolute bottom-2 right-2 rounded-full bg-primary text-primary-foreground p-1">
                          <Check className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="p-5">
                      <h3 className="font-semibold text-lg">{opt.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{opt.description}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {opt.characteristics.map(c => (
                          <span key={c} className="text-xs bg-muted rounded-full px-2 py-0.5">{c}</span>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">Ideal für: {opt.recommendedFor}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="rounded-lg bg-accent/10 border border-accent/20 p-4 text-sm">
              <span className="font-semibold">Empfehlung: </span>
              Betriebe mit vielen spontanen Kundenkontakten profitieren oft von sichtbarerer Beschriftung. Premium-Dienstleister meist von reduzierten, eleganten Designs.
            </div>
          </div>
        )}

        {/* ─── Step 1: Content priorities ──────────────────────── */}
        {step === 1 && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div>
              <h1 className="text-2xl font-bold">Welche Informationen sind am wichtigsten?</h1>
              <p className="text-muted-foreground mt-1">Was soll man sofort erkennen? (max. 3)</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRIORITY_OPTIONS.map(p => {
                const active = state.priorities.includes(p);
                const disabled = !active && state.priorities.length >= 3;
                return (
                  <button
                    key={p}
                    onClick={() => toggleInArray("priorities", p, 3)}
                    disabled={disabled}
                    className={`rounded-full border-2 px-4 py-2 text-sm font-medium transition-all ${
                      active ? "border-primary bg-primary text-primary-foreground"
                      : disabled ? "border-border text-muted-foreground/40 cursor-not-allowed"
                      : "border-border hover:border-primary/40"
                    }`}
                  >
                    {active && <Check className="h-3.5 w-3.5 inline mr-1" />}{p}
                  </button>
                );
              })}
            </div>
            <div className="rounded-lg bg-accent/10 border border-accent/20 p-4 text-sm">
              <span className="font-semibold">Wichtig: </span>
              Aus der Entfernung erkennt man meist nur 2–3 Kernbotschaften. Weniger wirkt oft professioneller und einprägsamer.
            </div>
            <div>
              <h2 className="font-semibold mb-2">Zusätzlich sichtbare Inhalte</h2>
              <div className="flex flex-wrap gap-2">
                {ADDITIONAL_OPTIONS.map(a => {
                  const active = state.additionalContent.includes(a);
                  return (
                    <button
                      key={a}
                      onClick={() => toggleInArray("additionalContent", a)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-all ${
                        active ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:border-primary/40"
                      }`}
                    >
                      {active && <Check className="h-3 w-3 inline mr-1" />}{a}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ─── Step 2: Design favorites ────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div>
              <h1 className="text-2xl font-bold">Welche Design-Richtung spricht Sie mehr an?</h1>
              <p className="text-muted-foreground mt-1">Hilft uns, bessere erste Entwürfe zu erstellen.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: "A" as ABChoice, title: "Minimalistisch", desc: "Klar, elegant, ruhig.", image: COMPARISON_IMAGES.A },
                { id: "B" as ABChoice, title: "Werbewirksam", desc: "Auffällig, sichtbar, prägnant.", image: COMPARISON_IMAGES.B },
              ]).map(c => {
                const active = state.comparison === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => set({ comparison: c.id })}
                    className={`rounded-xl border-2 overflow-hidden transition-all hover:scale-[1.01] ${active ? "border-primary shadow-md" : "border-border hover:border-primary/40"}`}
                  >
                    <div className="relative h-28 bg-muted overflow-hidden">
                      <img
                        src={c.image}
                        alt={c.title}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                      {active && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <div className="rounded-full bg-background/90 p-1.5"><Check className="h-6 w-6 text-primary" /></div>
                        </div>
                      )}
                    </div>
                    <div className="p-3 text-left">
                      <h3 className="font-semibold">{c.title}</h3>
                      <p className="text-xs text-muted-foreground">{c.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div>
              <h2 className="font-semibold mb-2">Was soll auf jeden Fall vermieden werden?</h2>
              <div className="flex flex-wrap gap-2">
                {NOGO_OPTIONS.map(n => {
                  const active = state.noGos.includes(n);
                  return (
                    <button
                      key={n}
                      onClick={() => toggleInArray("noGos", n)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-all ${
                        active ? "border-destructive bg-destructive/10 text-destructive font-medium" : "border-border hover:border-destructive/40"
                      }`}
                    >
                      {active && <X className="h-3 w-3 inline mr-1" />}{n}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h2 className="font-semibold mb-2">Inspiration oder Beispiele hochladen</h2>
              <div className="flex flex-wrap gap-2">
                {state.inspiration.map((f, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border bg-muted flex items-center justify-center">
                    {f.dataUrl.startsWith("data:image") ? (
                      <img src={f.dataUrl} alt={f.name} className="w-full h-full object-cover" />
                    ) : (
                      <FileText className="h-8 w-8 text-muted-foreground" />
                    )}
                    <button
                      onClick={() => setState(s => ({ ...s, inspiration: s.inspiration.filter((_, j) => j !== i) }))}
                      className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 hover:bg-background"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {state.inspiration.length < 5 && (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="w-20 h-20 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Upload className="h-5 w-5 mb-1" />
                    <span className="text-[10px]">Hinzufügen</span>
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" multiple className="hidden" onChange={onPickInspiration} />
            </div>
          </div>
        )}

        {/* ─── Step 3: Summary ─────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-5 animate-in fade-in duration-300">
            <div>
              <h1 className="text-2xl font-bold">Zusammenfassung</h1>
              <p className="text-muted-foreground mt-1">Ihr persönliches Gestaltungs-Briefing.</p>
            </div>

            <Card className="p-5 space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Gewünschte Wirkung</h3>
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-sm bg-primary/10 text-primary rounded-full px-3 py-1">{STYLE_OPTIONS.find(o => o.id === state.variant)?.title}</span>
                  <span className="text-sm bg-muted rounded-full px-3 py-1">{state.comparison === "A" ? "Minimalistisch" : "Werbewirksam"}</span>
                </div>
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Wichtigste Inhalte</h3>
                <ol className="text-sm list-decimal list-inside">
                  {state.priorities.map(p => <li key={p}>{p}</li>)}
                </ol>
                {state.additionalContent.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">Zusätzlich: {state.additionalContent.join(", ")}</p>
                )}
              </div>
              {state.noGos.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Zu vermeiden</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {state.noGos.map(n => <span key={n} className="text-sm bg-destructive/10 text-destructive rounded-full px-3 py-1">{n}</span>)}
                  </div>
                </div>
              )}
              <div className="border-t pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Automatische Stil-Analyse</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Profil:</span> {analysis.styleProfile}</div>
                  <div><span className="text-muted-foreground">Sichtbarkeit:</span> {analysis.visibility}</div>
                  <div><span className="text-muted-foreground">Inhaltsdichte:</span> {analysis.contentDensity}</div>
                  <div><span className="text-muted-foreground">Abgrenzung:</span> {analysis.risk}</div>
                </div>
              </div>
              {state.inspiration.length > 0 && (
                <p className="text-xs text-muted-foreground">{state.inspiration.length} Inspirations-Datei(en) beigefügt</p>
              )}
            </Card>
          </div>
        )}

        {/* ─── Navigation ──────────────────────────────────────── */}
        <div className="flex items-center justify-between mt-8 sticky bottom-4">
          <Button
            variant="ghost"
            onClick={() => step === 0 ? navigate("/") : setStep(s => s - 1)}
            disabled={submitting}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> {step === 0 ? "Abbrechen" : "Zurück"}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(s => s + 1)} disabled={!canAdvance}>
              Weiter <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={finish} disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Wird gesendet...</> : "Briefing abschließen"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
