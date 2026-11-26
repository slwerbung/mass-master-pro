import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, ListChecks, Lock, X } from "lucide-react";
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
 * „In HERO erledigen“: sperrt die Karte 30 Minuten und merkt den Vorher-Stand.
 * Danach öffnet sich HERO als Arbeitsfenster INNERHALB der App (siehe `HeroTaskBox`/`HeroFrame`).
 */
export function HeroWorkStart({ card, busy, label, variant = "secondary", onStarted }: {
  card: ProjectCard; busy?: boolean; label?: string; variant?: "secondary" | "outline"; onStarted: () => void;
}) {
  const start = useMutation({
    mutationFn: () => pact<ActionResult & LockInfo>("lock_for_hero", { heroId: card.project.heroId }),
    onSuccess: (r) => { toast.info(`${r.label}: Karte bis ${hhmm(r.lockedUntil)} für dich reserviert.`); onStarted(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const locked = card.state === "in_hero" && !card.heroTask?.mine;
  return (
    <Button variant={variant} disabled={busy || start.isPending || locked || !!card.heroTask}
      title={locked ? `Gerade von ${card.heroTask?.by || "jemand anderem"} in HERO bearbeitet` : "Karte sperren und HERO hier in der App öffnen"}
      onClick={() => start.mutate()}>
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

const frameKey = (taskId: string) => `heroFrame:${taskId}`;

/**
 * Arbeitsfenster: HERO eingebettet in der App, oben Leiste mit „Fertig“, daneben die Checkliste.
 * Zeigt HERO eine leere Fläche oder Fehlermeldung (HERO kann Einbettung verbieten), geht es per Knopf in einen neuen Tab.
 */
function HeroFrame({ task: t, heroId, nr, ticks, onToggle, onFinish, onClose, onExternal }: {
  task: HeroTaskInfo; heroId: number; nr: string; ticks: boolean[]; onToggle: (i: number) => void;
  onFinish: () => void; onClose: () => void; onExternal: () => void;
}) {
  const [list, setList] = useState(false);
  const done = t.checklist.filter((_, i) => ticks[i]).length;
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground" role="dialog" aria-label={`HERO ${nr}`}>
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Lock className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{nr} · {t.label}</div>
          <div className="text-xs text-muted-foreground">in HERO bis {hhmm(t.lockedUntil)}</div>
        </div>
        {t.checklist.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setList((v) => !v)} aria-pressed={list}>
            <ListChecks className="h-4 w-4" /> Checkliste {done}/{t.checklist.length}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onExternal} title="HERO in einem eigenen Tab öffnen, falls es hier leer bleibt"><ExternalLink className="h-4 w-4" /> Neuer Tab</Button>
        <Button size="sm" onClick={onFinish}><Check className="h-4 w-4" /> Fertig</Button>
        <Button size="sm" variant="ghost" onClick={onClose} title="Fenster schließen, die Karte bleibt reserviert" aria-label="Fenster schließen"><X className="h-4 w-4" /></Button>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <iframe title={`HERO ${nr}`} src={heroProjectUrl(heroId)} className="h-full w-full flex-1 border-0 bg-white" allow="clipboard-read; clipboard-write; fullscreen" />
        {list && (
          <aside className="absolute right-0 top-0 max-h-full w-72 max-w-full overflow-y-auto border-l bg-card p-3 text-sm shadow-lg">
            <Checklist items={t.checklist} ticks={ticks} onToggle={onToggle} disabled={false} />
          </aside>
        )}
      </div>
      <p className="border-t bg-muted px-3 py-1 text-xs text-muted-foreground">
        Bleibt HERO leer oder zeigt eine Fehlermeldung? Dann „Neuer Tab“ nutzen. Wenn du fertig bist, hier auf „Fertig“ klicken.
      </p>
    </div>
  );
}

function Checklist({ items, ticks, onToggle, disabled }: { items: string[]; ticks: boolean[]; onToggle: (i: number) => void; disabled: boolean }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i}>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={!!ticks[i]} disabled={disabled} onChange={() => onToggle(i)} />
            <span className={cn(ticks[i] && "text-muted-foreground line-through")}>{item}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * Laufende HERO-Aufgabe: Statuskasten, HERO-Arbeitsfenster in der App, Checkliste, Rückkehr-Dialog.
 * Gemeinsam für Projekt- und Mail-Karten. Das Fenster öffnet sich einmal von selbst, wenn die Aufgabe startet.
 */
export function HeroTaskBox({ task: t, heroId, nr, onChanged, onClosed }: {
  task: HeroTaskInfo; heroId: number; nr: string; onChanged: () => void; onClosed: (r: ActionResult) => void;
}) {
  const [ask, setAsk] = useState(false);
  const [ticks, setTicks] = useState<boolean[]>(() => loadTicks(t.id));
  const [frame, setFrame] = useState(() => {
    if (!t.mine) return false;
    try { return !sessionStorage.getItem(frameKey(t.id)); } catch { return true; } // öffnet sich, bis es einmal geschlossen wurde (auch nach Neuaufbau der Karte)
  });
  const closeFrame = () => { setFrame(false); try { sessionStorage.setItem(frameKey(t.id), "1"); } catch { /* egal */ } };
  const external = useRef(false); // HERO wurde in einem eigenen Tab geöffnet: nur dann gibt es eine „Rückkehr“
  const wasHidden = useRef(false);

  useEffect(() => {
    if (!t.mine) return;
    const onVis = () => {
      if (!external.current) return;
      if (document.visibilityState === "hidden") wasHidden.current = true;
      else if (wasHidden.current) { wasHidden.current = false; external.current = false; setAsk(true); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [t.id, t.mine]);

  const toggle = (i: number) => {
    const n = t.checklist.map((_, j) => (j === i ? !ticks[j] : !!ticks[j]));
    setTicks(n);
    try { localStorage.setItem(tickKey(t.id), JSON.stringify(n)); } catch { /* ohne Speicher weiter */ }
  };
  const openExternal = () => { external.current = true; wasHidden.current = false; closeFrame(); window.open(heroProjectUrl(heroId), "_blank", "noopener"); };
  const done = t.checklist.filter((_, i) => ticks[i]).length;

  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <Lock className="h-4 w-4 text-primary" />
        <b>{t.label}</b>
        <span className="text-xs text-muted-foreground">
          {t.mine ? `für dich reserviert bis ${hhmm(t.lockedUntil)}` : `${t.by || "Jemand"} bearbeitet das gerade in HERO (bis ${hhmm(t.lockedUntil)})`}
        </span>
      </div>
      {t.checklist.length > 1 && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Checkliste {done}/{t.checklist.length}</div>
          <Checklist items={t.checklist} ticks={ticks} onToggle={toggle} disabled={!t.mine} />
        </div>
      )}
      {t.mine && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="bg-background" onClick={() => setFrame(true)}><ExternalLink className="h-3.5 w-3.5" /> HERO-Fenster öffnen</Button>
          <Button size="sm" onClick={() => setAsk(true)}><Check className="h-3.5 w-3.5" /> Fertig</Button>
        </div>
      )}
      {frame && t.mine && (
        <HeroFrame task={t} heroId={heroId} nr={nr} ticks={ticks} onToggle={toggle} onFinish={() => setAsk(true)} onClose={closeFrame} onExternal={openExternal} />
      )}
      {ask && t.mine && <ReturnDialog title={`${nr}: ${t.label}`} task={t} onClose={() => setAsk(false)} onChanged={() => { setAsk(false); setFrame(false); onChanged(); }} onClosed={(r) => { setAsk(false); setFrame(false); onClosed(r); }} />}
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
export function TopicHeroWork({ threadId, heroId, nr, onDone, onStarted }: { threadId: string; heroId: number; nr: string; onDone?: () => void; onStarted?: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["projects", "topic_task", threadId], queryFn: () => papi<{ task: HeroTaskInfo | null; heroId: number | null }>("topic_task", { threadId }) });
  const refresh = () => {
    ["projects", "topics", "suggestions", "overview", "message", "messages"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const start = useMutation({
    mutationFn: (kind: string) => pact<ActionResult & LockInfo>("lock_for_hero", { heroId, kind, threadId }),
    onSuccess: (r) => {
      toast.info(`${r.label}: in HERO bis ${hhmm(r.lockedUntil)}.`);
      refresh();
      onStarted?.();
    },
    onError: (e) => toast.error(errorText(e)),
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
            onClick={() => start.mutate(t.kind)}>
            <b>{t.label}</b><span className="block text-xs text-muted-foreground">{t.hint}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Danach öffnet sich {nr} als HERO-Fenster hier in der App. Nach der Rückkehr wird abgeglichen – bei Erfolg ist das Thema abgeschlossen.</p>
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><b>Hinweis:</b> {text}</div>;
}

const CHOICES = [
  { v: "done", label: "Erledigt", hint: "Ich gleiche mit HERO ab." },
  { v: "partial", label: "Noch nicht fertig", hint: "Karte wird freigegeben und bleibt offen." },
  { v: "problem", label: "Problem", hint: "Karte wird freigegeben, deine Notiz bleibt als Hinweis." },
] as const;

/** Ergebnis melden: Erledigt / Noch nicht fertig / Problem. Bei „Erledigt“ liest die Function HERO neu und vergleicht. */
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
        <Button variant="ghost" onClick={onClose}>Zurück zu HERO</Button>
        <Button onClick={() => send.mutate()} disabled={send.isPending}>{result === "done" ? "Abgleichen und abschließen" : "Speichern"}</Button>
      </div>
    </Modal>
  );
}
