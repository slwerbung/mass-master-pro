import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Mic, Square, Loader2, FileText, ChevronRight, X, RotateCcw } from "lucide-react";
import { formatDateTimeSafe } from "@/lib/dateUtils";
import { MeetingMarkdown, type MeetingResult } from "@/components/MeetingRecorder";

// ─── Recording helpers (self-contained, foreground) ──────────────────────────
function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}
function extFor(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}
function fmt(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Briefing presets so the AI immediately knows the kind of meeting + how to
// structure the protocol. Selecting one prefills the instruction field.
const PRESETS: { key: string; label: string; context: string; instructions: string }[] = [
  {
    key: "gremium",
    label: "Gremiensitzung",
    context: "Gremien-/Vorstandssitzung. Teilnehmer und Tagesordnungspunkte (TOPs) werden im Gespräch genannt.",
    instructions:
      "Formelles Ergebnisprotokoll. Gliedere nach Tagesordnungspunkten (## je TOP). Halte Beschlüsse, Abstimmungsergebnisse und Verantwortlichkeiten fest. Maßnahmen mit Verantwortlichen und Fristen.",
  },
  {
    key: "kunde",
    label: "Kundengespräch",
    context: "Gespräch mit einem Kunden über ein Werbetechnik-/Beschilderungsprojekt.",
    instructions:
      "Kurzes Ergebnisprotokoll mit den wichtigsten Wünschen, Entscheidungen und Absprachen. Maßnahmenplan mit nächsten Schritten.",
  },
  {
    key: "baustelle",
    label: "Baustellenbesprechung",
    context: "Besprechung auf/zur Baustelle mit Gewerken bzw. Montageteam.",
    instructions:
      "Ergebnisprotokoll nach Themen. Halte Termine, Zuständigkeiten und offene Punkte fest. Maßnahmen mit Verantwortlichen und Fristen.",
  },
  {
    key: "intern",
    label: "Internes Meeting",
    context: "Internes Team-Meeting.",
    instructions:
      "Kompaktes Ergebnisprotokoll mit Entscheidungen. Maßnahmenplan mit Verantwortlichen.",
  },
];

interface StandaloneNote {
  id: string;
  title: string | null;
  summary: string;
  action_plan: string;
  context: string | null;
  created_by: string | null;
  created_at: string;
}

type Phase = "briefing" | "recording" | "processing";

const Protokoll = () => {
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [instructions, setInstructions] = useState(PRESETS[0].instructions);
  const [activePreset, setActivePreset] = useState<string>("gremium");

  const [phase, setPhase] = useState<Phase>("briefing");
  const [elapsedSec, setElapsed] = useState(0);
  const [result, setResult] = useState<MeetingResult | null>(null);

  const [notes, setNotes] = useState<StandaloneNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [openNote, setOpenNote] = useState<StandaloneNote | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>("");
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  // Keep the briefing that was active when recording started, so edits during
  // processing don't change what gets sent.
  const briefingRef = useRef<{ title: string; context: string; instructions: string }>({ title: "", context: "", instructions: "" });

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  const cleanupStream = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };

  const loadNotes = useCallback(async () => {
    try {
      const session = getSession();
      const { data } = await supabase.functions.invoke("meeting-notes", {
        body: { action: "list", standalone: true, token: session?.authToken },
      });
      setNotes(((data as any)?.notes || []) as StandaloneNote[]);
    } catch { /* ignore */ } finally { setLoadingNotes(false); }
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const applyPreset = (key: string) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    setActivePreset(key);
    setInstructions(p.instructions);
    // Only prefill the context hint when the field is still empty, so we don't
    // overwrite something the user already typed.
    setContext((cur) => (cur.trim() ? cur : p.context));
  };

  const handleStopped = async () => {
    stopTimer();
    cleanupStream();
    if (cancelledRef.current) { setPhase("briefing"); return; }
    const mime = mimeRef.current || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];
    if (blob.size < 2000) {
      toast.error("Aufnahme war zu kurz.");
      setPhase("briefing");
      return;
    }
    setPhase("processing");
    try {
      const session = getSession();
      const path = `meeting-audio/standalone/${crypto.randomUUID()}.${extFor(mime)}`;
      const { error: upErr } = await supabase.storage.from("project-files").upload(path, blob, { contentType: mime });
      if (upErr) throw new Error("Upload fehlgeschlagen: " + upErr.message);
      const b = briefingRef.current;
      const { data, error } = await supabase.functions.invoke("meeting-notes", {
        body: {
          action: "process",
          token: session?.authToken,
          audioPath: path,
          title: b.title,
          context: b.context,
          instructions: b.instructions,
        },
      });
      if (error) {
        let msg = error.message;
        try {
          const ctx = (error as any).context;
          const body = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
          if (body?.error) msg = body.error;
        } catch { /* keep generic message */ }
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult(data as MeetingResult);
      setPhase("briefing");
      loadNotes();
    } catch (e: any) {
      toast.error("Verarbeitung fehlgeschlagen: " + (e?.message || "Unbekannter Fehler"));
      setPhase("briefing");
    }
  };

  const start = async () => {
    if (phase !== "briefing") return;
    if (!navigator.mediaDevices?.getUserMedia) { toast.error("Audioaufnahme wird hier nicht unterstützt."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => { void handleStopped(); };
      streamRef.current = stream;
      recRef.current = rec;
      mimeRef.current = rec.mimeType || mime || "audio/webm";
      cancelledRef.current = false;
      briefingRef.current = { title: title.trim(), context: context.trim(), instructions: instructions.trim() };
      rec.start(1000);
      setElapsed(0);
      setPhase("recording");
      timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
      toast.success("Aufnahme gestartet");
    } catch (e: any) {
      cleanupStream();
      toast.error("Mikrofon-Zugriff fehlgeschlagen: " + (e?.message || ""));
    }
  };

  const stop = () => {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  };
  const cancel = () => {
    cancelledRef.current = true;
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    else { stopTimer(); cleanupStream(); setPhase("briefing"); }
  };

  useEffect(() => () => { stopTimer(); cleanupStream(); }, []);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-2.5">
        <div className="container max-w-2xl mx-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" className="-ml-2 shrink-0" onClick={() => navigate("/projects")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold leading-tight flex items-center gap-1.5"><Mic className="h-4 w-4 text-primary" /> Protokoll</p>
            <p className="text-xs text-muted-foreground truncate">Sprich ein Gespräch ein – die KI erstellt Protokoll &amp; Maßnahmen</p>
          </div>
        </div>
      </div>

      <div className="container max-w-2xl mx-auto p-4 md:p-6 space-y-4 pb-28">
        {/* Briefing */}
        <Card className="shadow-sm">
          <CardContent className="p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Art des Termins</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    disabled={phase !== "briefing"}
                    onClick={() => applyPreset(p.key)}
                    className={`text-sm px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
                      activePreset === p.key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted border-border"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="p-title">Titel (optional)</Label>
              <Input
                id="p-title"
                placeholder="z.B. Gremiensitzung Bauausschuss 09.07."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={phase !== "briefing"}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="p-context">Kontext des Gesprächs</Label>
              <Textarea
                id="p-context"
                placeholder="Worum geht es? Wer nimmt teil? z.B. „Monatliche Vorstandssitzung des Vereins, Teilnehmer: …“"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={3}
                disabled={phase !== "briefing"}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="p-instructions">So soll das Protokoll gemacht werden</Label>
              <Textarea
                id="p-instructions"
                placeholder="Wie soll das Protokoll aufgebaut sein? Welche Punkte sind wichtig?"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                disabled={phase !== "briefing"}
              />
              <p className="text-xs text-muted-foreground">Dieses Briefing bekommt die KI vor dem Protokoll – so weiß sie, was zu tun ist.</p>
            </div>

            {/* Recording controls */}
            {phase === "briefing" ? (
              <Button className="w-full h-12" onClick={start}>
                <Mic className="h-4 w-4 mr-2" /> Aufnahme starten
              </Button>
            ) : phase === "recording" ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">Aufnahme läuft · {fmt(elapsedSec)}</p>
                  <p className="text-xs text-muted-foreground truncate">Bildschirm kann gesperrt werden – läuft weiter</p>
                </div>
                <Button size="sm" variant="ghost" className="h-9 px-2 text-muted-foreground" onClick={cancel} title="Verwerfen">
                  <X className="h-4 w-4" />
                </Button>
                <Button size="sm" className="h-9 gap-1.5" onClick={stop}>
                  <Square className="h-3.5 w-3.5" /> Stopp &amp; Protokoll
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">Protokoll wird erstellt…</p>
                  <p className="text-xs text-muted-foreground truncate">Transkribieren &amp; zusammenfassen</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Previous standalone protocols */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-0.5 mb-2">Frühere Protokolle</p>
          {loadingNotes ? (
            <p className="text-sm text-muted-foreground px-0.5">Lädt…</p>
          ) : notes.length === 0 ? (
            <p className="text-sm text-muted-foreground px-0.5">Noch keine Protokolle.</p>
          ) : (
            <div className="space-y-2">
              {notes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setOpenNote(n)}
                  className="w-full text-left flex items-start gap-2 rounded-lg border bg-background p-3 hover:bg-muted/50 transition-colors"
                >
                  <FileText className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{n.title?.trim() || firstLine(n.summary)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTimeSafe(n.created_at)}{n.created_by ? ` · ${n.created_by}` : ""}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Result dialog (fresh protocol) */}
      <Dialog open={!!result} onOpenChange={(o) => { if (!o) setResult(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Protokoll</DialogTitle>
          </DialogHeader>
          {result && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Ergebnisprotokoll</p>
                <MeetingMarkdown text={result.summary} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Maßnahmenplan</p>
                <MeetingMarkdown text={result.actionPlan} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setResult(null); setTitle(""); setContext(""); }}>
                  <RotateCcw className="h-4 w-4 mr-1.5" /> Neues Protokoll
                </Button>
                <Button onClick={() => setResult(null)}>Schließen</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View a previous protocol */}
      <Dialog open={!!openNote} onOpenChange={(o) => { if (!o) setOpenNote(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> {openNote?.title?.trim() || "Protokoll"}</DialogTitle>
          </DialogHeader>
          {openNote && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                {formatDateTimeSafe(openNote.created_at)}{openNote.created_by ? ` · ${openNote.created_by}` : ""}
              </p>
              {openNote.context && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Briefing</p>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{openNote.context}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Ergebnisprotokoll</p>
                <MeetingMarkdown text={openNote.summary} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Maßnahmenplan</p>
                <MeetingMarkdown text={openNote.action_plan} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function firstLine(s: string): string {
  const line = (s || "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) || "Protokoll";
  return line.replace(/^[-•]\s*/, "").replace(/^#+\s*/, "");
}

export default Protokoll;
