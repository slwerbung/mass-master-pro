import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, CalendarPlus, Check, CheckCheck, FileText, FolderPlus, Settings2, Wand2, X } from "lucide-react";
import { invokeFn } from "@/lib/api";
import { Button, Input, Spinner, Textarea } from "@/components/ui";
import { cn, errorText } from "@/lib/utils";

interface CustomerOption { id: number; name: string }
type NewProject = { mode: "new"; name: string; existingCustomer: CustomerOption | null; requireExisting: boolean; customerOptions: CustomerOption[] };
type PlanProject =
  | NewProject
  | { mode: "link"; projectNr: string; projectId: number | null }
  | { mode: "keep" };
/** Thema in der Mail-App: nichts (= weiter verfolgen), abschliessen oder Wiedervorlage */
interface PlanTopic { mode: "keine" | "erledigt" | "wiedervorlage"; date: string | null; note: string | null }
interface Plan {
  project: PlanProject;
  /** fehlt bei einer aelteren email-action */
  topic?: PlanTopic;
  offer: boolean;
  appointments: Appointment[];
  /** weitere HERO-Aktionen (Ansprechpartner, Kontaktdaten, Status, Aufgabe …) */
  ops: HeroOp[];
  /** Mitarbeiter aus HERO, denen ein Termin zugewiesen werden kann */
  people?: { id: number; name: string; userId?: number | null }[];
  /** Kunde und Ansprechpartner in HERO */
  contacts?: { id: number; name: string; email: string; isCustomer: boolean }[];
  /** Schritte des Projektablaufs */
  steps?: { id: number; name: string }[];
  notDoable: string[];
  summary: string;
}
interface Step { step: string; ok: boolean; text: string }
interface HeroOp {
  op: string; fields: Record<string, string>;
  contactId: number | null; contactName: string | null; userId: number | null; personName: string | null; stepId: number | null; stepName: string | null;
}
// Gleiche Bedeutung wie OP_FIELDS / OP_TITLE / FIELD_LABEL in supabase/functions/_shared/email/heroOps.ts
const OP_FIELDS: Record<string, string[]> = {
  ansprechpartner_anlegen: ["salutation", "first_name", "last_name", "email", "phone", "mobile", "position"],
  kontakt_aendern: ["email", "phone", "mobile", "position", "street", "zip", "city"],
  adresse_anlegen: ["label", "street", "zip", "city"],
  projekt_aendern: ["project_name"], status_setzen: [], mitarbeiter_zuweisen: [],
  aufgabe_anlegen: ["title", "note", "due_date"], logbuch_notiz: ["note"],
};
const OP_TITLE: Record<string, string> = {
  ansprechpartner_anlegen: "Ansprechpartner anlegen", kontakt_aendern: "Kontaktdaten ändern", adresse_anlegen: "Adresse beim Kunden",
  projekt_aendern: "Projekt ändern", status_setzen: "Status setzen", mitarbeiter_zuweisen: "Mitarbeiter zuweisen",
  aufgabe_anlegen: "Aufgabe", logbuch_notiz: "Logbuch-Notiz",
};
const FIELD_LABEL: Record<string, string> = {
  salutation: "Anrede", first_name: "Vorname", last_name: "Nachname", email: "E-Mail", phone: "Telefon", mobile: "Mobil",
  position: "Position", street: "Straße", zip: "PLZ", city: "Ort", label: "Bezeichnung", project_name: "Projektname",
  title: "Titel", note: "Text", due_date: "Fällig am",
};
interface Appointment {
  categoryId: number; categoryLabel: string; date: string; time: string; durationMin: number; title: string;
  partnerId: number | null; partnerName: string | null;
}

/**
 * „Nein, anders …“: in eigenen Worten sagen, was passieren soll. Der Assistent macht daraus einen Plan
 * (Projekt anlegen/zuordnen, Angebotsentwurf, Termin in HERO), der hier geprüft und mit einem Klick ausgeführt wird.
 */
export function InstructBox({ messageId, onCancel, onExplain, title }: { messageId: string; onCancel: () => void; onExplain?: () => void; title?: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const refresh = () => ["suggestions", "overview", "messages", "message", "topics"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const makePlan = useMutation({
    mutationFn: () => invokeFn<Plan>("email-action", { action: "instruct_plan", messageId, text }),
    onSuccess: (p) => { setPlan(p); setSteps(null); },
    onError: (e) => toast.error(errorText(e)),
  });
  const run = useMutation({
    mutationFn: () => invokeFn<{ steps: Step[] }>("email-action", { action: "instruct_run", messageId, text, plan }),
    onSuccess: (r) => {
      setSteps(r.steps);
      const bad = r.steps.filter((s) => !s.ok).length;
      if (bad) toast.warning(`${r.steps.length - bad} von ${r.steps.length} Schritten erledigt – Details in der Karte.`);
      else toast.success("Erledigt.");
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const topicMode = plan?.topic?.mode ?? "keine";
  const nothing = plan && plan.project.mode === "keep" && !plan.offer && !plan.appointments.length && !(plan.ops ?? []).length && topicMode === "keine";
  const onlyTopic = plan && plan.project.mode === "keep" && !plan.offer && !plan.appointments.length && !(plan.ops ?? []).length && topicMode !== "keine";
  const noTopic: PlanTopic = { mode: "keine", date: null, note: null };
  // „Kontakt gibt es schon“: ohne gewaehlten Kunden wird nichts angelegt (nie ein neuer Kontakt).
  const customerMissing = plan?.project.mode === "new" && plan.project.requireExisting && !plan.project.existingCustomer;
  const p = plan;
  return (
    <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><Wand2 className="h-4 w-4" /> {title ?? "Was soll stattdessen passieren?"}</div>
      {!steps && (
        <Textarea
          rows={3} maxLength={1000} value={text} autoFocus
          onChange={(e) => { setText(e.target.value); setPlan(null); }}
          placeholder="z. B. „Neues Projekt anlegen, Angebotsentwurf vorbereiten und morgen einen Büro-Termin eintragen.“, „Gehört zu WER-1820.“ oder „Wiedervorlage in 2 Wochen, ob die Freigabe da ist.“"
        />
      )}

      {p && !steps && (
        <div className="space-y-2 rounded-md border bg-background p-3 text-sm">
          <div className="text-xs font-medium text-muted-foreground">Das würde passieren – bitte prüfen</div>
          {p.project.mode === "new" && (
            <>
              <Row icon={<FolderPlus className="h-4 w-4" />} onRemove={() => setPlan({ ...p, project: { mode: "keep" } })}>
                <span className="shrink-0">
                  Neues Projekt{p.project.existingCustomer ? ` bei ${p.project.existingCustomer.name} (bestehender Kunde)` : p.project.requireExisting ? " beim bestehenden Kunden" : " mit neuem Kontakt"}:
                </span>
                <Input className="h-8 w-auto min-w-48 flex-1" value={p.project.name} onChange={(e) => setPlan({ ...p, project: { ...(p.project as NewProject), name: e.target.value } })} />
              </Row>
              {p.project.customerOptions.length > 0 && (
                <label className="flex flex-wrap items-center gap-2 pl-6 text-sm">
                  <span className="text-muted-foreground">Kunde in HERO:</span>
                  <select
                    className="h-8 min-w-48 flex-1 rounded-md border bg-background px-2"
                    value={p.project.existingCustomer?.id ?? ""}
                    onChange={(e) => {
                      const np = p.project as NewProject;
                      setPlan({ ...p, project: { ...np, existingCustomer: np.customerOptions.find((c) => c.id === Number(e.target.value)) ?? null } });
                    }}
                  >
                    <option value="">– bitte wählen –</option>
                    {p.project.customerOptions.map((c) => <option key={c.id} value={c.id}>{c.name} (Nr. {c.id})</option>)}
                  </select>
                </label>
              )}
              {customerMissing && p.project.customerOptions.length === 0 && (
                <p className="pl-6 text-xs text-red-700">Den bestehenden Kunden hat HERO nicht gefunden. Bitte den Kundennamen in die Anweisung schreiben und den Plan neu zeigen lassen – ein neuer Kontakt wird nicht angelegt.</p>
              )}
            </>
          )}
          {p.project.mode === "link" && (
            <Row icon={<FolderPlus className="h-4 w-4" />} onRemove={() => setPlan({ ...p, project: { mode: "keep" } })}>
              <span className="shrink-0">Zuordnen zu</span>
              <Input className="h-8 w-40" value={p.project.projectNr} onChange={(e) => setPlan({ ...p, project: { mode: "link", projectNr: e.target.value, projectId: null } })} />
              <span className="text-xs text-muted-foreground">und ins Logbuch schreiben</span>
            </Row>
          )}
          {(p.ops ?? []).map((o, i) => {
            const upd = (x: Partial<HeroOp>) => setPlan({ ...p, ops: p.ops.map((y, j) => (j === i ? { ...y, ...x } : y)) });
            const select = "h-8 rounded-md border bg-background px-2 text-sm";
            return (
              <Row key={`op${i}`} icon={<Settings2 className="h-4 w-4" />} onRemove={() => setPlan({ ...p, ops: p.ops.filter((_, j) => j !== i) })}>
                <span className="shrink-0 font-medium">{OP_TITLE[o.op] ?? o.op}</span>
                {(o.op === "kontakt_aendern" || o.op === "projekt_aendern") && (
                  <select aria-label="Kontakt" className={select} value={o.contactId ?? ""} onChange={(e) => {
                    const c = (p.contacts ?? []).find((x) => x.id === Number(e.target.value));
                    upd({ contactId: c?.id ?? null, contactName: c?.name ?? null });
                  }}>
                    <option value="">{o.op === "projekt_aendern" ? "Ansprechpartner unverändert" : "– Kontakt wählen –"}</option>
                    {(p.contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.isCustomer ? " (Kunde)" : ""}</option>)}
                  </select>
                )}
                {o.op === "status_setzen" && (
                  <select aria-label="Schritt" className={select} value={o.stepId ?? ""} onChange={(e) => {
                    const st = (p.steps ?? []).find((x) => x.id === Number(e.target.value));
                    upd({ stepId: st?.id ?? null, stepName: st?.name ?? null });
                  }}>
                    {(p.steps ?? []).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                )}
                {(o.op === "mitarbeiter_zuweisen" || o.op === "aufgabe_anlegen") && (
                  <select aria-label="Mitarbeiter" className={select} value={o.userId ?? ""} onChange={(e) => {
                    const pe = (p.people ?? []).find((x) => x.userId === Number(e.target.value));
                    upd({ userId: pe?.userId ?? null, personName: pe?.name ?? null });
                  }}>
                    <option value="">{o.op === "aufgabe_anlegen" ? "ohne Mitarbeiter" : "– Mitarbeiter wählen –"}</option>
                    {(p.people ?? []).filter((x) => x.userId).map((x) => <option key={x.id} value={x.userId!}>{x.name}</option>)}
                  </select>
                )}
                {(OP_FIELDS[o.op] ?? []).map((f) => (
                  <Input
                    key={f} aria-label={FIELD_LABEL[f] ?? f} placeholder={FIELD_LABEL[f] ?? f} type={f === "due_date" ? "date" : "text"}
                    className={cn("h-8", f === "note" || f === "title" || f === "project_name" ? "min-w-48 flex-1" : "w-36")}
                    value={o.fields[f] ?? ""} onChange={(e) => upd({ fields: { ...o.fields, [f]: e.target.value } })}
                  />
                ))}
              </Row>
            );
          })}
          {p.offer && (
            <Row icon={<FileText className="h-4 w-4" />} onRemove={() => setPlan({ ...p, offer: false })}>
              Angebotsentwurf im Projekt anlegen (Positionen aus der Mail, Preise aus HERO)
            </Row>
          )}
          {p.appointments.map((a, i) => {
            const upd = (x: Partial<Appointment>) => setPlan({ ...p, appointments: p.appointments.map((y, j) => (j === i ? { ...y, ...x } : y)) });
            return (
              <Row key={i} icon={<CalendarPlus className="h-4 w-4" />} onRemove={() => setPlan({ ...p, appointments: p.appointments.filter((_, j) => j !== i) })}>
                <span className="shrink-0">Termin ({a.categoryLabel})</span>
                <Input className="h-8 w-36" type="date" value={a.date} onChange={(e) => upd({ date: e.target.value })} />
                <Input className="h-8 w-24" type="time" value={a.time} onChange={(e) => upd({ time: e.target.value })} />
                <Input className="h-8 w-20" type="number" min={5} max={600} value={a.durationMin} onChange={(e) => upd({ durationMin: Number(e.target.value) })} />
                <span className="text-xs text-muted-foreground">Min.</span>
                <select
                  aria-label="Mitarbeiter" className="h-8 rounded-md border bg-background px-2 text-sm"
                  value={a.partnerId ?? ""}
                  onChange={(e) => {
                    const person = (p.people ?? []).find((x) => x.id === Number(e.target.value));
                    upd({ partnerId: person?.id ?? null, partnerName: person?.name ?? null });
                  }}
                >
                  <option value="">ohne Mitarbeiter</option>
                  {(p.people ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <Input className="h-8 min-w-40 flex-1" value={a.title} onChange={(e) => upd({ title: e.target.value })} />
              </Row>
            );
          })}
          {p.topic?.mode === "wiedervorlage" && (
            <Row icon={<AlarmClock className="h-4 w-4" />} onRemove={() => setPlan({ ...p, topic: noTopic })}>
              <span className="shrink-0">Thema auf Wiedervorlage bis</span>
              <Input className="h-8 w-36" type="date" value={p.topic.date ?? ""} onChange={(e) => setPlan({ ...p, topic: { ...p.topic!, date: e.target.value } })} />
              <Input className="h-8 min-w-40 flex-1" placeholder="Worauf achten? (optional)" value={p.topic.note ?? ""} onChange={(e) => setPlan({ ...p, topic: { ...p.topic!, note: e.target.value } })} />
            </Row>
          )}
          {p.topic?.mode === "erledigt" && (
            <Row icon={<CheckCheck className="h-4 w-4" />} onRemove={() => setPlan({ ...p, topic: noTopic })}>
              Thema abschließen (wird nicht weiter verfolgt, bis eine neue Mail kommt)
            </Row>
          )}
          {nothing && <p className="text-muted-foreground">Daraus ergibt sich nichts, was der Assistent tun kann.</p>}
          {p.notDoable.length > 0 && (
            <p className="text-xs text-amber-800">Geht nicht automatisch (bitte selbst erledigen): {p.notDoable.join(" · ")}</p>
          )}
        </div>
      )}

      {steps && (
        <div className="space-y-1 rounded-md border bg-background p-3 text-sm">
          {steps.map((s, i) => (
            <div key={i} className={cn("flex items-start gap-2", !s.ok && "text-red-700")}>
              {s.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <X className="mt-0.5 h-4 w-4 shrink-0" />} {s.text}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!steps && !p && (
          <Button size="sm" onClick={() => makePlan.mutate()} disabled={text.trim().length < 3 || makePlan.isPending}>
            {makePlan.isPending && <Spinner />} Weiter: Plan zeigen
          </Button>
        )}
        {!steps && p && (
          <Button size="sm" onClick={() => run.mutate()} disabled={!!nothing || customerMissing || run.isPending}>
            {run.isPending && <Spinner />} {onlyTopic ? "Ausführen" : "In HERO ausführen"}
          </Button>
        )}
        {steps ? (
          <Button size="sm" variant="outline" onClick={() => { refresh(); onCancel(); }}>Schließen</Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onCancel}>Abbrechen</Button>
        )}
        {!steps && onExplain && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={onExplain}>
            Stattdessen nur erklären, was falsch ist (Mail neu verarbeiten)
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ icon, children, onRemove }: { icon: ReactNode; children: ReactNode; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      {children}
      <button type="button" aria-label="Schritt entfernen" className="ml-auto text-muted-foreground hover:text-foreground" onClick={onRemove}><X className="h-4 w-4" /></button>
    </div>
  );
}
