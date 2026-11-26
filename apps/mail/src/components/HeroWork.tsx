import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CircleCheck, ExternalLink, Lock } from "lucide-react";
import { invokeFn } from "@/lib/api";
import { pact, papi, type ActionResult, type HeroTaskInfo, type ProjectCard } from "@/lib/projects";
import { Button, ErrorBox, Field, Spinner, Textarea } from "@/components/ui";
import { preopenHero, showHero } from "@/components/HeroViewer";
import { Modal } from "@/components/ProjectActions";
import { cn, errorText } from "@/lib/utils";

/** Antwort von `hero-task-callback`. `stillOpen`: kein Treffer in HERO, Aufgabe und Sperre bleiben bestehen. */
export interface TaskFinish { passed: boolean; closed: boolean; stillOpen?: boolean; message: string; changes: string[]; warnings?: string[] }
interface TaskCheck { passed: boolean; message: string; changes: string[]; lockedUntil: string | null }
interface LockInfo { taskId: string; label: string; lockedUntil: string }

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "");

/**
 * „In HERO erledigen“: sperrt die Karte und merkt den Vorher-Stand. HERO öffnet im wiederverwendeten HERO-Fenster
 * (eingebettet geht nicht: HERO-Login funktioniert im Iframe nicht). Das Fenster wird SOFORT im Klick geöffnet,
 * sonst blockiert der Browser es nach dem Warten auf den Server.
 */
export function HeroWorkStart({ card, busy, label, variant = "secondary", onStarted }: {
  card: ProjectCard; busy?: boolean; label?: string; variant?: "secondary" | "outline"; onStarted: () => void;
}) {
  const win = useRef<Window | null>(null); // Ref statt State: der Klick setzt ihn und ruft sofort mutate()
  const start = useMutation({
    mutationFn: () => pact<ActionResult & LockInfo>("lock_for_hero", { heroId: card.project.heroId }),
    onSuccess: (r) => { showHero(win.current, card.project.heroId); toast.info(`${r.label}: Karte bis ${hhmm(r.lockedUntil)} für dich reserviert.`); onStarted(); },
    onError: (e) => { if (win.current && !win.current.closed) win.current.close(); toast.error(errorText(e)); },
  });
  const locked = card.state === "in_hero" && !card.heroTask?.mine;
  return (
    <Button variant={variant} disabled={busy || start.isPending || locked || !!card.heroTask}
      title={locked ? `Gerade von ${card.heroTask?.by || "jemand anderem"} in HERO bearbeitet` : "Karte reservieren und HERO öffnen"}
      onClick={() => { win.current = preopenHero(); start.mutate(); }}>
      <ExternalLink className="h-4 w-4" /> {label ?? "In HERO erledigen"}
    </Button>
  );
}

const tickKey = (taskId: string) => `heroWork:${taskId}`;
function loadTicks(taskId: string): boolean[] {
  try { return JSON.parse(localStorage.getItem(tickKey(taskId)) || "[]"); } catch { return []; }
}

/** Projekt-Karte: laufende HERO-Aufgabe bzw. Hinweis aus der letzten Rückkehr. */
export function HeroWorkPanel({ card, onChanged, onClosed }: { card: ProjectCard; onChanged: () => void; onClosed: (r: ActionResult) => void }) {
  const t = card.heroTask;
  if (!t) return card.hint ? <Hint text={card.hint} /> : null;
  return <HeroTaskBox task={t} heroId={card.project.heroId} nr={card.project.nr} onChanged={onChanged} onClosed={onClosed} />;
}

/**
 * Laufende HERO-Aufgabe (Projekt- und Mail-Karten). Während HERO offen ist, fragt die App alle 20 s (und beim Zurückkehren)
 * ab, ob die Aufgabe in HERO schon erledigt ist – dann genügt ein Klick. Das Abfragen verlängert auch die Sperre.
 */
export function HeroTaskBox({ task: t, heroId, nr, onChanged, onClosed }: {
  task: HeroTaskInfo; heroId: number; nr: string; onChanged: () => void; onClosed: (r: ActionResult) => void;
}) {
  const [ask, setAsk] = useState(false);
  const [ticks, setTicks] = useState<boolean[]>(() => loadTicks(t.id));
  const check = useQuery({
    queryKey: ["projects", "hero_task_check", t.id], enabled: t.mine, retry: false,
    refetchInterval: 20_000, refetchOnWindowFocus: true,
    queryFn: () => invokeFn<TaskCheck>("hero-task-callback", { action: "check", taskId: t.id }),
  });
  const seen = check.data; // bei Fehler (z. B. HERO kurz nicht erreichbar) bleibt es still, „Fertig“ geht trotzdem
  const detected = !!seen?.passed;

  const finish = useMutation({
    mutationFn: () => invokeFn<TaskFinish>("hero-task-callback", { taskId: t.id, result: "done" }),
    onSuccess: (r) => {
      (r.warnings ?? []).forEach((w) => toast.warning(w, { duration: 8000 }));
      if (r.closed) { toast.success(`${r.message}${r.changes.length ? ` (${r.changes.join("; ")})` : ""}`); onClosed({ ok: true, shadow: false, message: r.message }); }
      else setAsk(true); // doch nichts gefunden: Dialog mit den Auswahlmöglichkeiten
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const toggle = (i: number) => {
    const n = t.checklist.map((_, j) => (j === i ? !ticks[j] : !!ticks[j]));
    setTicks(n);
    try { localStorage.setItem(tickKey(t.id), JSON.stringify(n)); } catch { /* ohne Speicher weiter */ }
  };
  const done = t.checklist.filter((_, i) => ticks[i]).length;

  return (
    <div className={cn("space-y-3 rounded-md border p-3 text-sm text-foreground", detected ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-primary/30 bg-primary/5")}>
      <div className="flex flex-wrap items-center gap-2">
        {detected ? <CircleCheck className="h-4 w-4 text-emerald-700" /> : <Lock className="h-4 w-4 text-primary" />}
        <b>{t.label}</b>
        <span className="text-xs text-muted-foreground">
          {t.mine ? `für dich reserviert bis ${hhmm(seen?.lockedUntil ?? t.lockedUntil)}` : `${t.by || "Jemand"} bearbeitet das gerade in HERO (bis ${hhmm(t.lockedUntil)})`}
        </span>
      </div>

      {t.mine && (
        <p className={cn("text-sm", detected ? "font-medium" : "text-muted-foreground")}>
          {detected ? `In HERO erkannt: ${seen!.message}` : check.isFetching && !seen ? "Prüfe HERO …" : seen ? `${seen.message} Sobald es da ist, erkennt die Karte das selbst.` : "Erledige es in HERO, die Karte merkt es selbst."}
        </p>
      )}

      {t.checklist.length > 1 && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Merkzettel {done}/{t.checklist.length}</div>
          <ul className="space-y-1.5">
            {t.checklist.map((item, i) => (
              <li key={i}>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={!!ticks[i]} disabled={!t.mine} onChange={() => toggle(i)} />
                  <span className={cn(ticks[i] && "text-muted-foreground line-through")}>{item}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {t.mine && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="bg-background" onClick={() => showHero(null, heroId)}><ExternalLink className="h-3.5 w-3.5" /> In HERO weiterarbeiten</Button>
          <Button size="sm" disabled={finish.isPending} onClick={() => (detected ? finish.mutate() : setAsk(true))}>
            <Check className="h-3.5 w-3.5" /> {detected ? "Abschließen" : "Fertig"}
          </Button>
        </div>
      )}
      {ask && t.mine && <ReturnDialog title={`${nr}: ${t.label}`} task={t} onClose={() => setAsk(false)} onChanged={() => { setAsk(false); onChanged(); }} onClosed={(r) => { setAsk(false); onClosed(r); }} />}
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
 * Mail-Karte (Zu entscheiden): Aufgabe in HERO wählen → HERO-Fenster → die Karte erkennt das Ergebnis selbst.
 * Gelingt der Abgleich, wird das Thema abgeschlossen (die Mail ist abgelegt); sonst bleibt es offen.
 */
export function TopicHeroWork({ threadId, heroId, nr, onDone, onStarted }: { threadId: string; heroId: number; nr: string; onDone?: () => void; onStarted?: () => void }) {
  const qc = useQueryClient();
  const win = useRef<Window | null>(null);
  const q = useQuery({ queryKey: ["projects", "topic_task", threadId], queryFn: () => papi<{ task: HeroTaskInfo | null; heroId: number | null }>("topic_task", { threadId }) });
  const refresh = () => {
    ["projects", "topics", "suggestions", "overview", "message", "messages"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const start = useMutation({
    mutationFn: (kind: string) => pact<ActionResult & LockInfo>("lock_for_hero", { heroId, kind, threadId }),
    onSuccess: (r) => {
      showHero(win.current, heroId);
      toast.info(`${r.label}: in HERO bis ${hhmm(r.lockedUntil)}.`);
      refresh();
      onStarted?.();
    },
    onError: (e) => { if (win.current && !win.current.closed) win.current.close(); toast.error(errorText(e)); },
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
            onClick={() => { win.current = preopenHero(); start.mutate(t.kind); }}>
            <b>{t.label}</b><span className="block text-xs text-muted-foreground">{t.hint}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Danach öffnet sich {nr} im HERO-Fenster. Die Karte erkennt selbst, wenn es erledigt ist – dann ist das Thema abgeschlossen.</p>
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><b>Hinweis:</b> {text}</div>;
}

const CHOICES = [
  { v: "partial", label: "Noch nicht fertig", hint: "Die Karte wird freigegeben und bleibt offen. Beim nächsten Start zählt der Stand von jetzt." },
  { v: "force", label: "Ist trotzdem erledigt", hint: "Ohne Abgleich schließen (z. B. nur geprüft). Das Logbuch vermerkt „manuell bestätigt“." },
  { v: "problem", label: "Es gibt ein Problem", hint: "Die Karte wird freigegeben, deine Notiz bleibt als Hinweis." },
] as const;

/** „Fertig“, aber in HERO ist (noch) nichts Passendes zu sehen: weitermachen, später, trotzdem erledigt oder Problem. */
function ReturnDialog({ title, task, onClose, onChanged, onClosed }: {
  title: string; task: HeroTaskInfo; onClose: () => void; onChanged: () => void; onClosed: (r: ActionResult) => void;
}) {
  const [choice, setChoice] = useState<"partial" | "force" | "problem">("partial");
  const [note, setNote] = useState("");
  const send = useMutation({
    mutationFn: () => invokeFn<TaskFinish>("hero-task-callback", choice === "force"
      ? { taskId: task.id, result: "done", force: true, note }
      : { taskId: task.id, result: choice, note }),
    onSuccess: (r) => {
      (r.warnings ?? []).forEach((w) => toast.warning(w, { duration: 8000 }));
      if (r.closed) { toast.success(r.message); onClosed({ ok: true, shadow: false, message: r.message }); }
      else { toast.info(r.message, { duration: 6000 }); onChanged(); }
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-muted-foreground">In HERO ist noch nichts zu sehen, was zu „{task.label}“ passt. Was jetzt?</p>
      <div className="space-y-2">
        {CHOICES.map((c) => (
          <label key={c.v} className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm", choice === c.v && "border-primary bg-primary/5")}>
            <input type="radio" name="hero-result" className="mt-1" checked={choice === c.v} onChange={() => setChoice(c.v)} />
            <span><b>{c.label}</b><span className="block text-xs text-muted-foreground">{c.hint}</span></span>
          </label>
        ))}
      </div>
      <Field label={choice === "problem" ? "Was fehlt noch?" : "Notiz (optional)"} hint={choice === "force" ? "Landet im HERO-Logbuch." : undefined}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Zurück zu HERO</Button>
        <Button onClick={() => send.mutate()} disabled={send.isPending}>{choice === "force" ? "Als erledigt schließen" : "Speichern"}</Button>
      </div>
    </Modal>
  );
}
