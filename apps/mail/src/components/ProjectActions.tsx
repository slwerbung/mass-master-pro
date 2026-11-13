import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { pact, papi, type ActionResult, type EventRow, type EventSetup, type ProjectView, type StepsInfo } from "@/lib/projects";
import { Button, ErrorBox, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { errorText } from "@/lib/utils";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-lg border bg-background p-5 shadow-xl ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <h2 className="font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Ergebnis einer Aktion melden: Schattenmodus deutlich, Warnungen sichtbar. */
export function reportResult(r: ActionResult) {
  if (r.shadow) toast.info(r.message, { duration: 6000 });
  else toast.success(r.message);
  (r.warnings ?? []).forEach((w) => toast.warning(w, { duration: 8000 }));
}

const clean = (n: string) => n.replace(/^[^\p{L}\p{N}]+/u, "");

export function StatusDialog({ project, onClose, onDone }: { project: ProjectView; onClose: () => void; onDone: (r: ActionResult) => void }) {
  const steps = useQuery({ queryKey: ["projects", "steps", project.heroId], queryFn: () => pact<StepsInfo>("steps", { heroId: project.heroId }) });
  const set = useMutation({
    mutationFn: (stepId: number) => pact("set_step", { heroId: project.heroId, stepId }),
    onSuccess: (r) => { reportResult(r); onDone(r); },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Modal title={`Status ändern: ${project.nr} ${project.name}`} onClose={onClose}>
      {steps.isLoading && <Spinner />}
      <ErrorBox error={steps.error} />
      <div className="grid gap-1">
        {steps.data?.steps.map((s) => {
          const current = s.id === steps.data!.current;
          const done = s.key === "abgeschlossen";
          return (
            <button key={s.id} type="button" disabled={current || set.isPending} onClick={() => set.mutate(s.id)}
              className={`rounded-md border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60 ${current ? "border-primary bg-accent font-medium" : ""} ${done ? "border-emerald-400 font-medium" : ""}`}>
              {clean(s.name)}{current && <span className="ml-2 text-xs text-muted-foreground">aktuell</span>}{done && <span className="ml-2 text-xs text-emerald-700">Projekt beenden</span>}
            </button>
          );
        })}
      </div>
      <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Abbrechen</Button></div>
    </Modal>
  );
}

export function NoteDialog({ project, onClose, onDone }: { project: ProjectView; onClose: () => void; onDone: (r: ActionResult) => void }) {
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: () => pact("logbook_note", { heroId: project.heroId, text }),
    onSuccess: (r) => { reportResult(r); onDone(r); },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Modal title={`Logbuch-Notiz: ${project.nr} ${project.name}`} onClose={onClose}>
      <Field label="Notiz" hint="Landet im HERO-Logbuch des Projekts."><Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !text.trim()}>Eintragen</Button>
      </div>
    </Modal>
  );
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Naechster Werktag ab `from` (+ `plus` Tage), Wochenende wird uebersprungen. */
function workday(from: Date, plus: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + plus);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

export function EventsDialog({ project, onClose, onDone }: { project: ProjectView; onClose: () => void; onDone: (r: ActionResult) => void }) {
  const setup = useQuery({ queryKey: ["projects", "event_setup"], queryFn: () => papi<EventSetup>("event_setup"), staleTime: 300_000 });
  const initial = useMemo<EventRow[]>(() => {
    let prev = workday(new Date(), 1);
    return (setup.data?.types ?? []).map((t, i) => {
      const d = i === 0 ? prev : workday(prev, t.gapDays);
      prev = d;
      return { title: t.name, date: isoDay(d), time: "08:00", durationMinutes: t.durationMinutes, employeeId: t.defaultEmployeeId ?? "" };
    });
  }, [setup.data]);
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const list = rows ?? initial;
  const patch = (i: number, p: Partial<EventRow>) => setRows(list.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = useMutation({
    mutationFn: () => pact("create_events", { heroId: project.heroId, events: list.map((r) => ({ ...r, employeeId: r.employeeId || null })) }),
    onSuccess: (r) => { reportResult(r); onDone(r); },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Modal title={`Termine anlegen: ${project.nr} ${project.name}`} onClose={onClose} wide>
      {setup.isLoading && <Spinner />}
      <ErrorBox error={setup.error} />
      <div className="space-y-2">
        {list.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[7rem_9rem_6rem_6rem_1fr]">
            <Input value={r.title} onChange={(e) => patch(i, { title: e.target.value })} aria-label="Titel" />
            <Input type="date" value={r.date} onChange={(e) => patch(i, { date: e.target.value })} aria-label="Datum" />
            <Input type="time" value={r.time} onChange={(e) => patch(i, { time: e.target.value })} aria-label="Uhrzeit" />
            <Input type="number" min={15} step={15} value={r.durationMinutes} onChange={(e) => patch(i, { durationMinutes: Number(e.target.value) })} aria-label="Dauer in Minuten" title="Dauer in Minuten" />
            <Select value={r.employeeId} onChange={(e) => patch(i, { employeeId: e.target.value })} aria-label="Mitarbeiter">
              <option value="">ohne Mitarbeiter</option>
              {setup.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </div>
        ))}
        {setup.data && !list.length && <p className="text-sm text-muted-foreground">Keine Terminarten angelegt (Admin → Projekte).</p>}
      </div>
      <p className="text-xs text-muted-foreground">Uhrzeit ist Berliner Ortszeit, Dauer in Minuten. Ein Klick legt alle Termine in HERO an.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !list.length}>{list.length} Termine anlegen</Button>
      </div>
    </Modal>
  );
}

export function ConfirmDialog({ title, text, confirm, danger, busy, onCancel, onConfirm }: {
  title: string; text: ReactNode; confirm: string; danger?: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="text-sm">{text}</div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Abbrechen</Button>
        <Button variant={danger ? "destructive" : "default"} onClick={onConfirm} disabled={busy}>{confirm}</Button>
      </div>
    </Modal>
  );
}
