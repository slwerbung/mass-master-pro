import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CATEGORY_NAMES, papi, type FollowupTemplate, type ProjectRule, type ProjectSettings, type StepSetting } from "@/lib/projects";
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
  const saveWrite = useMutation({
    mutationFn: (enabled: boolean) => papi("save_write_enabled", { enabled }),
    onSuccess: (_r, enabled) => { toast.success(enabled ? "Schreiben nach HERO ist AN." : "Schattenmodus ist AN (nichts wird nach HERO geschrieben)."); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const s = q.data!;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Änderungen gelten ab dem nächsten Abgleich (alle 10 Minuten oder „Jetzt abgleichen“ im Bereich Projekte).</p>

      <Card>
        <CardHeader><CardTitle>Schreiben nach HERO</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Switch checked={s.writeEnabled} onChange={(v) => saveWrite.mutate(v)} disabled={saveWrite.isPending} label={s.writeEnabled ? "An – Abschließen, Status, Notizen, Termine und Archivieren schreiben direkt nach HERO" : "Aus – Schattenmodus: Aktionen werden nur protokolliert"} />
          <p className="text-xs text-muted-foreground">Aus = nichts wird nach HERO geschrieben und keine Mail versendet. Jede Aktion steht in <code>project_actions_log</code>.</p>
        </CardContent>
      </Card>

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
        <CardHeader><CardTitle>Autopilot: Versandfenster und Grenzen</CardTitle></CardHeader>
        <CardContent><AutoSettings window={s.window} limits={s.limits} onSaved={refresh} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Nachfass-Vorlagen</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Platzhalter: <code>{"{kunde}"}</code> <code>{"{projekt}"}</code> <code>{"{angebot_nr}"}</code> <code>{"{angebot_datum}"}</code>. Ton kurz und locker, Firmenname „SL WERBUNG“. Geändert wird nur der Text für <i>neue</i> Entwürfe; offene Entwürfe bleiben, wie sie sind.</p>
          {s.templates.map((t) => <TemplateRow key={`${t.rule_key}:${t.stage}`} t={t} label={s.rules.find((r) => r.key === t.rule_key)?.label ?? t.rule_key} onSaved={refresh} />)}
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

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function AutoSettings({ window: w, limits, onSaved }: { window: ProjectSettings["window"]; limits: ProjectSettings["limits"]; onSaved: () => void }) {
  const [days, setDays] = useState<number[]>(w.days.map((d) => (d === 0 ? 7 : d)));
  const [from, setFrom] = useState(String(w.from));
  const [to, setTo] = useState(String(w.to));
  const [perRun, setPerRun] = useState(String(limits.perRun));
  const [perDay, setPerDay] = useState(String(limits.perDay));
  const save = useMutation({
    mutationFn: async () => {
      await papi("save_window", { days, from: Number(from), to: Number(to) });
      await papi("save_limits", { perRun: Number(perRun), perDay: Number(perDay) });
    },
    onSuccess: () => { toast.success("Gespeichert."); onSaved(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const toggle = (d: number) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort()));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {DAY_NAMES.map((n, i) => (
          <label key={n} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={days.includes(i + 1)} onChange={() => toggle(i + 1)} /> {n}</label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="von (Uhr)"><Input type="number" className="h-8 w-20" min={0} max={23} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="bis (Uhr)"><Input type="number" className="h-8 w-20" min={1} max={24} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="höchstens je Lauf"><Input type="number" className="h-8 w-24" value={perRun} onChange={(e) => setPerRun(e.target.value)} /></Field>
        <Field label="höchstens je Tag"><Input type="number" className="h-8 w-24" value={perDay} onChange={(e) => setPerDay(e.target.value)} /></Field>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Speichern</Button>
      </div>
      <p className="text-xs text-muted-foreground">Berliner Ortszeit. Automatisch gesendet wird nur im Fenster, nie mehr als die Grenzen erlauben und nie, solange der Schattenmodus an ist.</p>
    </div>
  );
}

function TemplateRow({ t, label, onSaved }: { t: FollowupTemplate; label: string; onSaved: () => void }) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const dirty = subject !== t.subject || body !== t.body;
  const save = useMutation({
    mutationFn: () => papi("save_template", { ruleKey: t.rule_key, stage: t.stage, subject, body }),
    onSuccess: () => { toast.success("Vorlage gespeichert."); onSaved(); },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="font-medium">{label} <span className="text-xs text-muted-foreground">· Stufe {t.stage}</span></div>
      <Field label="Betreff"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Text"><textarea className="min-h-32 w-full rounded-md border bg-background p-2 text-sm" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Speichern</Button>
    </div>
  );
}
