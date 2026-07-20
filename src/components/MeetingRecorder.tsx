import { createContext, useContext, useRef, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";
import { toast } from "sonner";
import { Mic, Square, Loader2, CheckCircle2, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ─── Kontext ──────────────────────────────────────────────────────────────────
type Phase = "idle" | "recording" | "processing";
export interface MeetingResult { id?: string; summary: string; actionPlan: string; heroLogged: boolean; heroError?: string; projectNumber?: string }

interface RecorderCtx {
  phase: Phase;
  elapsedSec: number;
  activeProjectId: string | null;
  start: (projectId: string, projectNumber: string) => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

const Ctx = createContext<RecorderCtx | null>(null);
export const useMeetingRecorder = (): RecorderCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useMeetingRecorder must be used within MeetingRecorderProvider");
  return c;
};

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

export function MeetingRecorderProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSec, setElapsed] = useState(0);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectNumber, setActiveProjectNumber] = useState<string | null>(null);
  const [result, setResult] = useState<MeetingResult | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const projectIdRef = useRef<string | null>(null);
  const mimeRef = useRef<string>("");
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  const cleanupStream = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };

  const handleStopped = async () => {
    stopTimer();
    cleanupStream();
    const projectId = projectIdRef.current;
    if (cancelledRef.current || !projectId) {
      setPhase("idle"); setActiveProjectId(null); setActiveProjectNumber(null);
      return;
    }
    const mime = mimeRef.current || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];
    if (blob.size < 2000) {
      toast.error("Aufnahme war zu kurz.");
      setPhase("idle"); setActiveProjectId(null); setActiveProjectNumber(null);
      return;
    }
    setPhase("processing");
    try {
      const session = getSession();
      const path = `meeting-audio/${projectId}/${crypto.randomUUID()}.${extFor(mime)}`;
      const { error: upErr } = await supabase.storage.from("project-files").upload(path, blob, { contentType: mime });
      if (upErr) throw new Error("Upload fehlgeschlagen: " + upErr.message);
      const { data, error } = await supabase.functions.invoke("meeting-notes", {
        body: { action: "process", token: session?.authToken, projectId, audioPath: path },
      });
      if (error) {
        // supabase-js wraps a non-2xx response in FunctionsHttpError; the real
        // message from the function is in error.context (a Response). Surface it.
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
      window.dispatchEvent(new CustomEvent("meeting-note-created", { detail: { projectId } }));
    } catch (e: any) {
      toast.error("Verarbeitung fehlgeschlagen: " + (e?.message || "Unbekannter Fehler"));
    } finally {
      setPhase("idle"); setActiveProjectId(null); setActiveProjectNumber(null);
    }
  };

  const start = useCallback(async (projectId: string, projectNumber: string) => {
    if (phase !== "idle") { toast.error("Es läuft bereits eine Aufnahme."); return; }
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
      projectIdRef.current = projectId;
      cancelledRef.current = false;
      rec.start(1000); // 1s-Chunks – läuft auch im Hintergrund weiter
      setActiveProjectId(projectId);
      setActiveProjectNumber(projectNumber);
      setElapsed(0);
      setPhase("recording");
      timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
      toast.success("Aufnahme gestartet");
    } catch (e: any) {
      cleanupStream();
      toast.error("Mikrofon-Zugriff fehlgeschlagen: " + (e?.message || ""));
    }
  }, [phase]);

  const stop = useCallback(() => {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recRef.current && recRef.current.state !== "inactive") {
      recRef.current.stop();
    } else {
      stopTimer(); cleanupStream();
      setPhase("idle"); setActiveProjectId(null); setActiveProjectNumber(null);
    }
  }, []);

  return (
    <Ctx.Provider value={{ phase, elapsedSec, activeProjectId, start, stop, cancel }}>
      {children}
      {phase !== "idle" && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,420px)]">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/95 backdrop-blur shadow-lg px-4 py-2.5">
            {phase === "recording" ? (
              <>
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">Aufnahme läuft · {fmt(elapsedSec)}</p>
                  {activeProjectNumber && <p className="text-xs text-muted-foreground truncate">Projekt {activeProjectNumber}</p>}
                </div>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground" onClick={cancel} title="Verwerfen">
                  <X className="h-4 w-4" />
                </Button>
                <Button size="sm" className="h-8 gap-1.5" onClick={stop}>
                  <Square className="h-3.5 w-3.5" /> Stopp & Notiz
                </Button>
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">Gesprächsnotiz wird erstellt…</p>
                  <p className="text-xs text-muted-foreground truncate">Transkribieren & zusammenfassen</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </Ctx.Provider>
  );
}

// ─── Markdown-light Renderer (Stichpunkte) ────────────────────────────────────
// Ergebnisprotokoll and Maßnahmenplan both render as bullet lists. Legacy notes
// (and the occasional model slip) may contain checkbox syntax ("- [ ] …") or
// several items packed into one line with inline "[ ]" markers; normalizeLines
// flattens all of that into plain bullets so everything reads consistently.
function normalizeLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of (text || "").split("\n")) {
    const line = raw.trim();
    if (!line) { out.push(""); continue; }
    if (line.startsWith("## ")) { out.push(line); continue; }
    const isList = /^[-*•]\s+/.test(line) || /\[[ xX]?\]/.test(line);
    if (!isList) { out.push(line); continue; }
    const body = line.replace(/^[-*•]\s*/, "");
    const parts = body.split(/\s*\[[ xX]?\]\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) out.push(`- ${body}`);
    else for (const part of parts) out.push(`- ${part}`);
  }
  return out;
}

export function MeetingMarkdown({ text }: { text: string }) {
  const lines = normalizeLines(text);
  return (
    <div className="space-y-1 text-sm">
      {lines.map((raw, i) => {
        const line = raw;
        if (!line) return <div key={i} className="h-1.5" />;
        if (line.startsWith("## ")) return <p key={i} className="font-semibold mt-2">{line.slice(3)}</p>;
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>{line.slice(2)}</span>
            </div>
          );
        }
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

function ResultDialog({ result, onClose }: { result: MeetingResult | null; onClose: () => void }) {
  return (
    <Dialog open={!!result} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Gesprächsnotiz</DialogTitle>
        </DialogHeader>
        {result && (
          <div className="space-y-4">
            {result.heroLogged ? (
              <div className="flex items-center gap-2 text-sm rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 text-green-700 dark:text-green-400 px-3 py-2">
                <CheckCircle2 className="h-4 w-4" /> Im HERO-Logbuch gespeichert{result.projectNumber ? ` · Projekt ${result.projectNumber}` : ""}
              </div>
            ) : (
              <div className="text-sm rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 px-3 py-2">
                Notiz gespeichert, aber kein HERO-Logbuch-Eintrag.
                {result.heroError ? <span className="block mt-1 text-xs opacity-80 break-words">{result.heroError}</span> : null}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Ergebnisprotokoll</p>
              <MeetingMarkdown text={result.summary} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Maßnahmenplan</p>
              <MeetingMarkdown text={result.actionPlan} />
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>Schließen</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
