import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CATEGORY_NAMES, papi, type ProjectRule, type ProjectSettings, type StepSetting } from "@/lib/projects";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Select, Spinner, Switch } from "@/components/ui";
import { errorText } from "@/lib/utils";

const KEY = ["projects", "settings"];

export default function ProjectSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => papi<ProjectSettings>("settings") });
  const refresh = () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["projects"] }); };
  const [days, setDays] = useState<string | null>(null);
  const saveDays = useMutation({
    mutationFn: () => papi("save_bundle_days", { days: Number(days) }),
    onSuccess: () => { toast.success("Gespeichert. Gilt ab dem nächsten Abgleich."); setDays(null); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const s = q.data!;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Änderungen gelten ab dem nächsten Abgleich (alle 10 Minuten oder „Jetzt abgleichen“ im Bereich Projekte).
        Schalter „Schreiben nach HERO“: <Badge variant={s.writeEnabled ? "good" : "warn"}>{s.writeEnabled ? "an" : "aus – Schattenmodus"}</Badge> (wird mit den scharfen Aktionen bedienbar).
      </p>

      <Card>
        <CardHeader><CardTitle>Aufräum-Karte</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <Field label="Ab wie vielen Tagen ohne Bewegung (7–730)">
            <Input type="number" className="w-32" value={days ?? s.bundleAfterDays} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <Button onClick={() => saveDays.mutate()} disabled={days === null || saveDays.isPending}>Speichern</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Status: Sollzeit und Ausschluss</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <p className="pb-2 text-xs text-muted-foreground">„Ausgeschlossen“ = keine Karten. Buchhaltung (Warten auf Bezahlung, Fertig zur Abrechnung) ist standardmäßig ausgeschlossen. „Nähe zum Abschluss“ bestimmt die Reihenfolge im Stapel (höher = zuerst).</p>
          {s.steps.map((st) => <StepRow key={st.step_id} step={st} onSaved={refresh} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Regeln</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {s.rules.map((r) => <RuleRow key={r.key} rule={r} onSaved={refresh} />)}
        </CardContent>
      </Card>
    </div>
  );
}

function StepRow({ step, onSaved }: { step: StepSetting; onSaved: () => void }) {
  const [t, setT] = useState(String(step.target_days));
  const [c, setC] = useState(String(step.closeness));
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => papi("save_step", { stepId: step.step_id, ...patch }),
    onSuccess: onSaved, onError: (e) => toast.error(errorText(e)),
  });
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-2 text-sm">
      <span className="min-w-40 flex-1 font-medium">{step.name}</span>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">Sollzeit
        <Input type="number" className="h-8 w-20" value={t} onChange={(e) => setT(e.target.value)} onBlur={() => t !== String(step.target_days) && save.mutate({ targetDays: Number(t) })} /> Tage
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">Nähe
        <Input type="number" className="h-8 w-20" value={c} onChange={(e) => setC(e.target.value)} onBlur={() => c !== String(step.closeness) && save.mutate({ closeness: Number(c) })} />
      </label>
      <Switch checked={step.excluded} onChange={(v) => save.mutate({ excluded: v })} label="Ausgeschlossen" />
    </div>
  );
}

function RuleRow({ rule, onSaved }: { rule: ProjectRule; onSaved: () => void }) {
  const [thr, setThr] = useState(rule.threshold_days == null ? "" : String(rule.threshold_days));
  const [fu, setFu] = useState(rule.followup_days == null ? "" : String(rule.followup_days));
  const [reason, setReason] = useState(rule.followup_reason);
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => papi("save_rule", { key: rule.key, ...patch }),
    onSuccess: onSaved, onError: (e) => toast.error(errorText(e)),
  });
  const hasThreshold = !["reklamation", "anfrage_ohne_angebot", "anfrage_status_alt", "angebot_entwurf", "haengt", "waise"].includes(rule.key);
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{rule.label}</span>
        <Badge variant="secondary">{CATEGORY_NAMES[rule.category]}</Badge>
        <span className="text-xs text-muted-foreground">{rule.suggestion}</span>
        <span className="ml-auto"><Switch checked={rule.active} onChange={(v) => save.mutate({ active: v })} label="Aktiv" /></span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {hasThreshold && (
          <Field label="Schwelle (Tage)"><Input type="number" className="h-8 w-24" value={thr} onChange={(e) => setThr(e.target.value)} onBlur={() => thr !== String(rule.threshold_days ?? "") && save.mutate({ thresholdDays: thr === "" ? null : Number(thr) })} /></Field>
        )}
        <Field label="Wiedervorlage (Tage)"><Input type="number" className="h-8 w-24" value={fu} onChange={(e) => setFu(e.target.value)} onBlur={() => fu !== String(rule.followup_days ?? "") && save.mutate({ followupDays: fu === "" ? null : Number(fu) })} /></Field>
        <Field label="Grund der Wiedervorlage"><Input className="h-8 w-64" value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => reason !== rule.followup_reason && save.mutate({ followupReason: reason })} /></Field>
        <Field label="Autopilot">
          <Select className="h-8 w-40" value={rule.autopilot} onChange={(e) => save.mutate({ autopilot: e.target.value })} disabled={rule.channel !== "mail"} title={rule.channel !== "mail" ? "Nur für Regeln mit Mailweg" : "Wirkt ab dem Nachfassen-Schritt"}>
            <option value="off">Aus</option><option value="suggest">Vorschlagen</option><option value="auto">Automatisch</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}
