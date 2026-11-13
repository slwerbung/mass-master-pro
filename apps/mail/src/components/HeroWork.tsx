import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Lock, RotateCcw } from "lucide-react";
import { invokeFn } from "@/lib/api";
import { pact, papi, type ActionResult, type HeroTaskInfo, type ProjectCard } from "@/lib/projects";
import { Button, ErrorBox, Field, Spinner, Textarea } from "@/components/ui";
import { heroProjectUrl } from "@/components/HeroLink";
import { Modal } from "@/components/ProjectActions";
import { cn, errorText } from "@/lib/utils";

/** Antwort von `hero-task-callback`. */
export interface TaskFinish { passed: boolean; closed: boolean; message: string; changes: string[]; warnings?: string[] }
interface LockInfo { taskId: string; label: string; lockedUntil: string }

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "");

/**
 * „In HERO erledigen“: sperrt die Karte 30 Minuten, merkt den Vorher-Stand und öffnet HERO in einem neuen Tab.
 * Der Tab wird SOFORT (im Klick) geöffnet, sonst blockiert der Browser ihn nach dem Warten auf den Server.
 */
export function HeroWorkStart({ card, busy, label, variant = "secondary", onStarted }: {
  card: ProjectCard; busy?: boolean; label?: string; variant?: "secondary" | "outline"; onStarted: () => void;
}) {
  const tabRef = useRef<Window | null>(null); // Ref statt State: der Klick setzt ihn und ruft sofort mutate() – ein State wäre im Callback noch veraltet
  const start = useMutation({
    mutationFn: () => pact<ActionResult & LockInfo>("lock_for_hero", { heroId: card.project.heroId }),
    onSuccess: (r) => {
      const tab = tabRef.current;
      if (tab && !tab.closed) { try { tab.location.href = heroProjectUrl(card.project.heroId); } catch { window.open(heroProjectUrl(card.project.heroId), "_blank"); } }
      else window.open(heroProjectUrl(card.project.heroId), "_blank");
      toast.info(`${r.label}: Karte bis ${hhmm(r.lockedUntil)} für dich reserviert.`);
      onStarted();
    },
    onError: (e) => { const tab = tabRef.current; if (tab && !tab.closed) tab.close(); toast.error(errorText(e)); },
  });
  const locked = card.state === "in_hero" && !card.heroTask?.mine;
  return (
    <Button variant={variant} disabled={busy || start.isPending || locked || (!!card.heroTask && card.heroTask.mine)}
      title={locked ? `Gerade von ${card.heroTask?.by || "jemand anderem"} in HERO bearbeitet` : "Karte sperren und HERO in einem neuen Tab öffnen"}
      onClick={() => { const w = window.open("about:blank", "_blank"); if (w) w.opener = null; tabRef.current = w; start.mutate(); }}>
      <ExternalLink className="h-4 w-4" /> {label ?? "In HERO erledigen"}
    </Button>
  );
}

const tickKey = (taskId: string) => `heroWork:${taskId}`;
function loadTicks(taskId: string): boolean[] {
  try { return JSON.parse(localStorage.getItem(tickKey(taskId)) || "[]"); } catch { return []; }
}

/** Projekt-Karte: Checkliste und Rückkehr-Dialog, solange die Karte in HERO bearbeitet wird; Hinweis aus der letzten Rückkehr. */
export function HeroWorkPanel({ card, onChanged, onClosed }: { card: ProjectCard; onChanged: () => void; onClosed: (r: ActionResult) => void }) {
  const t = card.heroTask;
  if (!t) return card.hint ? <Hint text={card.hint} /> : null;
  return <HeroTaskBox task={t} heroId={card.project.heroId} nr={card.project.nr} onChanged={onChanged} onClosed={onClosed} />;
}

/** Checkliste + Rückkehr-Erkennung + Dialog – gemeinsam für Projekt- und Mail-Karten. */
export function HeroTaskBox({ task: t, heroId, nr, onChanged, onClosed }: {
  task: HeroTaskInfo; heroId: number; nr: string; onChanged: () => void; onClosed: (r: ActionResult) => void;
}) {
  const [ask, setAsk] = useState(false);
  const [ticks, setTicks] = useState<boolean[]>(() => loadTicks(t.id));
  const wasHidden = useRef(false);

  // Rückkehr erkennen: Tab war im Hintergrund und kommt wieder nach vorn.
  useEffect(() => {
    if (!t.mine) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") wasHidden.current = true;
      else if (wasHidden.current) { wasHidden.current = false; setAsk(true); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [t.id, t.mine]);

  const toggle = (i: number) => {
    const n = t.checklist.map((_, j) => (j === i ? !ticks[j] : !!ticks[j]));
    setTicks(n);
    try { localStorage.setItem(tickKey(t.id), JSON.stringify(n)); } catch { /* ohne Speicher weiter */ }
  };

  return (
    <div className="space-y-3 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
      <div className="flex flex-wrap items-center gap-2">
        <Lock className="h-4 w-4" />
        <b>{t.label}</b>
        <span className="text-xs opacity-80">
          {t.mine ? `in HERO bis ${hhmm(t.lockedUntil)}` : `${t.by || "Jemand"} bearbeitet das gerade in HERO (bis ${hhmm(t.lockedUntil)})`}
        </span>
      </div>
      <ul className="space-y-1">
        {t.checklist.map((item, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={!!ticks[i]} disabled={!t.mine} onChange={() => toggle(i)} />
              <span className={cn(ticks[i] && "line-through opacity-60")}>{item}</span>
            </label>
          </li>
        ))}
      </ul>
      {t.mine && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => window.open(heroProjectUrl(heroId), "_blank")}><ExternalLink className="h-3.5 w-3.5" /> HERO erneut öffnen</Button>
          <Button size="sm" onClick={() => setAsk(true)}><RotateCcw className="h-3.5 w-3.5" /> Zurück aus HERO</Button>
        </div>
      )}
      {ask && t.mine && <ReturnDialog title={`Zurück aus HERO: ${nr} ${t.label}`} task={t} onClose={() => setAsk(false)} onChanged={() => { setAsk(false); onChanged(); }} onClosed={(r) => { setAsk(false); onClosed(r); }} />}
    </div>
  );
}

const MAIL_TASKS = [
  { kind: "create_confirmation", label: "AB erstellen", hint: "Mail mit Zusage: AB in HERO anlegen" },
  { kind: "create_offer", label: "Angebot erstellen", hint: "Anfrage: Angebot in HERO anlegen" },
  { kind: "finish_offer", label: "Angebot fertigstellen", hint: "Entwurf prüfen und versenden" },
  { kind: "generic", label: "Etwas anderes in HERO", hint: "Nur Änderungen abgleichen" },
] as const;

/**
 * Mail-Karte (Zu entscheiden): Aufgabe in HERO wählen → HERO in neuem Tab → Rückkehr → Abgleich.
 * Gelingt er, wird das Thema abgeschlossen (die Mail ist abgelegt); sonst bleibt es offen.
 */
export function TopicHeroWork({ threadId, heroId, nr, onDone }: { threadId: string; heroId: number; nr: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const tabRef = useRef<Window | null>(null);
  const q = useQuery({ queryKey: ["projects", "topic_task", threadId], queryFn: () => papi<{ task: HeroTaskInfo | null; heroId: number | null }>("topic_task", { threadId }) });
  const refresh = () => {
    ["projects", "topics", "suggestions", "overview", "message", "messages"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const start = useMutation({
    mutationFn: (kind: string) => pact<ActionResult & LockInfo>("lock_for_hero", { heroId, kind, threadId }),
    onSuccess: (r) => {
      const tab = tabRef.current;
      if (tab && !tab.closed) { try { tab.location.href = heroProjectUrl(heroId); } catch { window.open(heroProjectUrl(heroId), "_blank"); } }
      else window.open(heroProjectUrl(heroId), "_blank");
      toast.info(`${r.label}: in HERO bis ${hhmm(r.lockedUntil)}.`);
      refresh();
    },
    onError: (e) => { const tab = tabRef.current; if (tab && !tab.closed) tab.close(); toast.error(errorText(e)); },
  });
  if (q.isLoading) return <Spinner />;
  if (q.data?.task) {
    return <HeroTaskBox task={q.data.task} heroId={q.data.heroId ?? heroId} nr={nr} onChanged={refresh} onClosed={() => { refresh(); onDone?.(); }} />;
  }
  return (
    <div className="space-y-2">
      <ErrorBox error={q.error} />
      <div className="grid gap-2 sm:grid-cols-2">
        {MAIL_TASKS.map((t) => (
          <button key={t.kind} type="button" disabled={start.isPending}
            className="rounded-md border bg-background p-2 text-left text-sm hover:bg-accent disabled:opacity-50"
            onClick={() => { const w = window.open("about:blank", "_blank"); if (w) w.opener = null; tabRef.current = w; start.mutate(t.kind); }}>
            <b>{t.label}</b><span className="block text-xs text-muted-foreground">{t.hint}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Danach öffnet sich {nr} in HERO. Nach der Rückkehr wird abgeglichen – bei Erfolg ist das Thema abgeschlossen.</p>
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"><b>Hinweis:</b> {text}</div>;
}

const CHOICES = [
  { v: "done", label: "Erledigt", hint: "Ich gleiche mit HERO ab." },
  { v: "partial", label: "Teilweise", hint: "Karte bleibt offen." },
  { v: "problem", label: "Problem", hint: "Karte bleibt offen, mit Notiz." },
] as const;

/** Nach der Rückkehr: Erledigt / Teilweise / Problem. Bei „Erledigt“ liest die Function HERO neu und vergleicht. */
function ReturnDialog({ title, task, onClose, onChanged, onClosed }: {
  title: string; task: HeroTaskInfo; onClose: () => void; onChanged: () => void; onClosed: (r: ActionResult) => void;
}) {
  const [result, setResult] = useState<"done" | "partial" | "problem">("done");
  const [note, setNote] = useState("");
  const send = useMutation({
    mutationFn: () => invokeFn<TaskFinish>("hero-task-callback", { taskId: task.id, result, note }),
    onSuccess: (r) => {
      (r.warnings ?? []).forEach((w) => toast.warning(w, { duration: 8000 }));
      if (r.closed) { toast.success(`${r.message}${r.changes.length ? ` (${r.changes.join("; ")})` : ""}`); onClosed({ ok: true, shadow: false, message: r.message }); }
      else { toast.warning(r.message, { duration: 10000 }); onChanged(); }
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-2">
        {CHOICES.map((c) => (
          <label key={c.v} className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm", result === c.v && "border-primary bg-primary/5")}>
            <input type="radio" name="hero-result" className="mt-1" checked={result === c.v} onChange={() => setResult(c.v)} />
            <span><b>{c.label}</b><span className="block text-xs text-muted-foreground">{c.hint}</span></span>
          </label>
        ))}
      </div>
      <Field label={result === "done" ? "Notiz (optional)" : "Was fehlt noch?"} hint={result === "done" ? "Landet im HERO-Logbuch." : undefined}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Später</Button>
        <Button onClick={() => send.mutate()} disabled={send.isPending}>{result === "done" ? "Abgleichen und abschließen" : "Speichern"}</Button>
      </div>
    </Modal>
  );
}
