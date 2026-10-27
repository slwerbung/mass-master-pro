import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, Check, FileText, FolderPlus, Wand2, X } from "lucide-react";
import { invokeFn } from "@/lib/api";
import { Button, Input, Spinner, Textarea } from "@/components/ui";
import { cn, errorText } from "@/lib/utils";

interface CustomerOption { id: number; name: string }
type NewProject = { mode: "new"; name: string; existingCustomer: CustomerOption | null; requireExisting: boolean; customerOptions: CustomerOption[] };
type PlanProject =
  | NewProject
  | { mode: "link"; projectNr: string; projectId: number | null }
  | { mode: "keep" };
interface Plan {
  project: PlanProject;
  offer: boolean;
  appointment: { categoryId: number; categoryLabel: string; date: string; time: string; durationMin: number; title: string } | null;
  notDoable: string[];
  summary: string;
}
interface Step { step: string; ok: boolean; text: string }

/**
 * „Nein, anders …“: in eigenen Worten sagen, was passieren soll. Der Assistent macht daraus einen Plan
 * (Projekt anlegen/zuordnen, Angebotsentwurf, Termin in HERO), der hier geprüft und mit einem Klick ausgeführt wird.
 */
export function InstructBox({ messageId, onCancel, onExplain }: { messageId: string; onCancel: () => void; onExplain: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const refresh = () => ["suggestions", "overview", "messages", "message"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

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

  const nothing = plan && plan.project.mode === "keep" && !plan.offer && !plan.appointment;
  // „Kontakt gibt es schon“: ohne gewaehlten Kunden wird nichts angelegt (nie ein neuer Kontakt).
  const customerMissing = plan?.project.mode === "new" && plan.project.requireExisting && !plan.project.existingCustomer;
  const p = plan;
  return (
    <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><Wand2 className="h-4 w-4" /> Was soll stattdessen passieren?</div>
      {!steps && (
        <Textarea
          rows={3} maxLength={1000} value={text} autoFocus
          onChange={(e) => { setText(e.target.value); setPlan(null); }}
          placeholder="z. B. „Neues Projekt anlegen, Angebotsentwurf vorbereiten und morgen einen Büro-Termin eintragen.“ oder „Gehört zu WER-1820.“"
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
          {p.offer && (
            <Row icon={<FileText className="h-4 w-4" />} onRemove={() => setPlan({ ...p, offer: false })}>
              Angebotsentwurf im Projekt anlegen (Positionen aus der Mail, Preise aus HERO)
            </Row>
          )}
          {p.appointment && (
            <Row icon={<CalendarPlus className="h-4 w-4" />} onRemove={() => setPlan({ ...p, appointment: null })}>
              <span className="shrink-0">Termin ({p.appointment.categoryLabel})</span>
              <Input className="h-8 w-36" type="date" value={p.appointment.date} onChange={(e) => setPlan({ ...p, appointment: { ...p.appointment!, date: e.target.value } })} />
              <Input className="h-8 w-24" type="time" value={p.appointment.time} onChange={(e) => setPlan({ ...p, appointment: { ...p.appointment!, time: e.target.value } })} />
              <Input className="h-8 w-20" type="number" min={5} max={600} value={p.appointment.durationMin} onChange={(e) => setPlan({ ...p, appointment: { ...p.appointment!, durationMin: Number(e.target.value) } })} />
              <span className="text-xs text-muted-foreground">Min.</span>
              <Input className="h-8 min-w-40 flex-1" value={p.appointment.title} onChange={(e) => setPlan({ ...p, appointment: { ...p.appointment!, title: e.target.value } })} />
            </Row>
          )}
          {nothing && <p className="text-muted-foreground">Daraus ergibt sich nichts, was der Assistent in HERO tun kann.</p>}
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
            {run.isPending && <Spinner />} In HERO ausführen
          </Button>
        )}
        {steps ? (
          <Button size="sm" variant="outline" onClick={() => { refresh(); onCancel(); }}>Schließen</Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onCancel}>Abbrechen</Button>
        )}
        {!steps && (
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
