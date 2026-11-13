import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Phone, Send } from "lucide-react";
import { pact, papi, type ActionResult, type AutopilotMode, type AutopilotOverview, type ProjectCard } from "@/lib/projects";
import { Badge, Button, ErrorBox, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { ConfirmDialog, Modal, reportResult } from "@/components/ProjectActions";
import { errorText } from "@/lib/utils";

const MODE_LABEL: Record<AutopilotMode, string> = { off: "Aus", suggest: "Vorschlagen", auto: "Automatisch" };
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Entwurf direkt in der Karte: bearbeiten, mit einem Klick senden, für dieses Projekt automatisch nachfassen. */
export function DraftPanel({ card, busy, onSent, onChanged }: { card: ProjectCard; busy: boolean; onSent: (r: ActionResult) => void; onChanged: () => void }) {
  const d = card.draft;
  const [to, setTo] = useState(d?.to ?? "");
  const [subject, setSubject] = useState(d?.subject ?? "");
  const [body, setBody] = useState(d?.body ?? "");
  const dirty = !!d && (to !== d.to || subject !== d.subject || body !== d.body);

  const save = useMutation({
    mutationFn: () => pact("save_draft", { draftId: d!.id, to, subject, body }),
    onSuccess: () => { toast.success("Entwurf gespeichert."); onChanged(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const send = useMutation({
    mutationFn: async () => {
      if (dirty) await pact("save_draft", { draftId: d!.id, to, subject, body }); // erst speichern, dann genau das senden
      return pact("send_followup", { draftId: d!.id });
    },
    onSuccess: (r) => { reportResult(r); onSent(r); },
    onError: (e) => { toast.error(errorText(e)); onChanged(); },
  });
  const auto = useMutation({
    mutationFn: (mode: AutopilotMode | null) => pact("set_autopilot", { heroId: card.project.heroId, ruleKey: card.ruleKey, mode }),
    onSuccess: (r) => { toast.success(r.message); onChanged(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const working = busy || save.isPending || send.isPending || auto.isPending;

  if (!d) {
    return (
      <div className="space-y-2 rounded-md border border-dashed p-3 text-sm">
        <div className="font-medium">Kein Entwurf</div>
        <p className="text-muted-foreground">
          {card.autopilot === "off"
            ? "Der Mailvorschlag ist für diese Regel bzw. dieses Projekt ausgeschaltet."
            : card.project.kundeEmail ? "Der Entwurf wird mit dem nächsten Abgleich (alle 10 Minuten) angelegt." : "Es gibt keine E-Mail-Adresse zu diesem Projekt – im Entwurf fehlt der Empfänger."}
        </p>
        {card.autopilot === "off" && (
          <Button size="sm" variant="outline" disabled={working} onClick={() => auto.mutate("suggest")}>Entwurf für dieses Projekt einschalten</Button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entwurf (Stufe {d.stage})</span>
        {card.autopilot === "auto" && <Badge variant="warn" title="Wird im Versandfenster ohne Klick gesendet">Automatisch</Badge>}
        {dirty && <Badge variant="secondary">ungespeichert</Badge>}
      </div>
      {d.error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900">Letzter Versuch: {d.error}</div>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="An"><Input value={to} onChange={(e) => setTo(e.target.value)} type="email" /></Field>
        <Field label="Betreff"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      </div>
      <Field label="Text" hint="Die Signatur des Postfachs wird beim Senden angehängt."><Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={working || !to.trim() || !subject.trim() || !body.trim()} onClick={() => send.mutate()}><Send className="h-4 w-4" /> Senden</Button>
        <Button variant="outline" disabled={working || !dirty} onClick={() => save.mutate()}>Speichern</Button>
        {card.autopilotOverride === "auto"
          ? <Button variant="ghost" size="sm" disabled={working} onClick={() => auto.mutate(null)}><Bot className="h-3.5 w-3.5" /> Automatisch nachfassen beenden</Button>
          : card.autopilot !== "auto" && <Button variant="ghost" size="sm" disabled={working} onClick={() => auto.mutate("auto")} title="Künftige Nachfass-Mails zu diesem Projekt gehen im Versandfenster ohne Klick raus"><Bot className="h-3.5 w-3.5" /> Für dieses Projekt automatisch nachfassen</Button>}
      </div>
    </div>
  );
}

/** Stufe 2 der Kette: Anruf-Karte mit Telefonnummer. */
export function CallPanel({ card, busy, onDone }: { card: ProjectCard; busy: boolean; onDone: (r: ActionResult) => void }) {
  const p = card.project;
  const done = useMutation({
    mutationFn: () => pact("call_done", { heroId: p.heroId }),
    onSuccess: (r) => { reportResult(r); onDone(r); },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anruf</div>
      {p.kundeTelefon
        ? <a href={`tel:${p.kundeTelefon.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-2 text-base font-medium underline"><Phone className="h-4 w-4" /> {p.kundeTelefon}</a>
        : <p className="text-muted-foreground">Zu diesem Projekt ist keine Telefonnummer in HERO hinterlegt.</p>}
      {p.kundeEmail && <div className="text-xs text-muted-foreground">{p.kunde} · {p.kundeEmail}</div>}
      <Button disabled={busy || done.isPending} onClick={() => done.mutate()}>Anruf erledigt</Button>
    </div>
  );
}

/** Sammelkarte „N Nachfass-Mails bereit“: Liste mit Haken, „N senden“, „Künftig automatisch“ (Admin). */
export function BulkFollowupDialog({ cards, admin, onClose, onDone }: { cards: ProjectCard[]; admin: boolean; onClose: () => void; onDone: () => void }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [confirmAuto, setConfirmAuto] = useState(false);
  const chosen = cards.filter((c) => !off.has(c.id));
  const toggle = (id: string) => setOff((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rules = [...new Map(chosen.map((c) => [c.ruleKey, c.ruleLabel])).entries()];

  const send = useMutation({
    mutationFn: () => pact("bulk_followup", { draftIds: chosen.map((c) => c.draft!.id) }),
    onSuccess: (r) => {
      reportResult(r);
      if (r.failed?.length) toast.error(`${r.failed.length} fehlgeschlagen: ${r.failed[0].error}`, { duration: 10000 });
      onDone();
    },
    onError: (e) => { toast.error(errorText(e)); onDone(); },
  });
  const makeAuto = useMutation({
    mutationFn: async () => { for (const [key] of rules) await papi("save_rule", { key, autopilot: "auto" }); },
    onSuccess: () => { toast.success("Künftig wird automatisch nachgefasst (im Versandfenster, mit Tageslimit)."); setConfirmAuto(false); onDone(); },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Modal title={`${cards.length} Nachfass-Mails bereit`} onClose={onClose} wide>
      <p className="text-sm text-muted-foreground">Abwählen, was nicht raus soll. Jede Mail geht mit der Signatur des Postfachs im Thread der letzten Kundenmail raus und steht danach im HERO-Logbuch; die Wiedervorlage wird nach der Regel gesetzt.</p>
      <ul className="divide-y rounded-md border text-sm">
        {cards.map((c) => (
          <li key={c.id} className="flex items-start gap-2 p-2">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={!off.has(c.id)} onChange={() => toggle(c.id)} aria-label={`${c.project.nr} auswählen`} />
            <div className="min-w-0 flex-1">
              <div className="truncate"><b>{c.project.nr}</b> {c.project.name}<span className="text-muted-foreground"> · {c.project.kunde}</span></div>
              <div className="truncate text-xs text-muted-foreground">{c.draft!.to} · {c.draft!.subject}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {admin
          ? <Button variant="outline" size="sm" disabled={!chosen.length || makeAuto.isPending} onClick={() => setConfirmAuto(true)}><Bot className="h-3.5 w-3.5" /> Künftig automatisch</Button>
          : <span className="text-xs text-muted-foreground">„Künftig automatisch“ stellen nur Admins ein.</span>}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button disabled={!chosen.length || send.isPending} onClick={() => send.mutate()}><Send className="h-4 w-4" /> {chosen.length} senden</Button>
        </div>
      </div>
      {confirmAuto && (
        <ConfirmDialog title="Künftig automatisch nachfassen?" confirm="Automatisch einschalten" busy={makeAuto.isPending} onCancel={() => setConfirmAuto(false)} onConfirm={() => makeAuto.mutate()}
          text={<>Für <b>{rules.map(([, l]) => l).join(", ")}</b> werden Nachfass-Mails künftig ohne Klick gesendet – nur im Versandfenster, mit Tageslimit und nie bei Projekten, auf die der Kunde schon geantwortet hat. Das lässt sich im Autopilot-Dialog jederzeit wieder auf „Vorschlagen“ oder „Aus“ stellen.</>} />
      )}
    </Modal>
  );
}

/** Autopilot je Regel (Aus / Vorschlagen / Automatisch), Versandfenster und Zähler. */
export function AutopilotDialog({ admin, onClose, onChanged }: { admin: boolean; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["projects", "autopilot"], queryFn: () => papi<AutopilotOverview>("autopilot_overview") });
  const save = useMutation({
    mutationFn: (v: { key: string; mode: AutopilotMode }) => papi("save_rule", { key: v.key, autopilot: v.mode }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); onChanged(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const o = q.data;
  return (
    <Modal title="Autopilot" onClose={onClose} wide>
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} />
      {o && (
        <>
          <p className="text-sm text-muted-foreground">
            <b>Aus</b> = keine Karte mit Entwurf · <b>Vorschlagen</b> = Entwurf in der Karte, du sendest · <b>Automatisch</b> = Versand ohne Klick im Versandfenster.
            Einstellungen am einzelnen Projekt („Für dieses Projekt automatisch nachfassen“) gehen vor.
          </p>
          {o.shadow && <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">Schattenmodus: Es wird nichts gesendet, auch nicht automatisch.</div>}
          <div className="space-y-2">
            {o.rules.map((r) => (
              <div key={r.key} className="flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm">
                <span className="min-w-40 flex-1 font-medium">{r.label}{!r.active && <span className="ml-2 text-xs text-muted-foreground">(Regel inaktiv)</span>}</span>
                <Select className="h-8 w-44" value={r.autopilot} disabled={!admin || save.isPending} onChange={(e) => save.mutate({ key: r.key, mode: e.target.value as AutopilotMode })}>
                  {(["off", "suggest", "auto"] as AutopilotMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </Select>
              </div>
            ))}
          </div>
          <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <div>Versandfenster: {o.window.days.map((d) => WEEKDAYS[d]).join(", ")} · {o.window.from}–{o.window.to} Uhr</div>
            <div>Grenzen: höchstens {o.maxPerRun} je Lauf, {o.maxPerDay} pro Tag</div>
            <div>Heute automatisch gesendet: <b>{o.autoSentToday}</b></div>
            <div>Insgesamt automatisch gesendet: <b>{o.autoSentTotal}</b></div>
          </div>
          {!admin && <p className="text-xs text-muted-foreground">Die Einstellung ändern nur Admins.</p>}
        </>
      )}
      <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Schließen</Button></div>
    </Modal>
  );
}
