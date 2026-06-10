import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Zap, ArrowRight, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import {
  TRIGGERS, ACTIONS, ConfigField, triggerLabel, actionLabel, getAction,
} from "@/lib/automationRegistry";

interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger_type: string;
  trigger_config: Record<string, any>;
  action_type: string;
  action_config: Record<string, any>;
  sort_order: number;
}

interface AutomationRun {
  id: string;
  automation_name: string;
  trigger_type: string;
  action_type: string;
  status: "success" | "error" | "skipped";
  message: string;
  created_at: string;
}

type InvokeFn = (action: string, params?: Record<string, any>) => Promise<any>;

const emptyDraft = () => ({
  name: "",
  enabled: true,
  trigger_type: TRIGGERS[0]?.type ?? "",
  action_type: ACTIONS[0]?.type ?? "",
  action_config: {} as Record<string, any>,
});

function defaultsFor(fields: ConfigField[] = []): Record<string, any> {
  const cfg: Record<string, any> = {};
  for (const f of fields) if (f.default !== undefined) cfg[f.key] = f.default;
  return cfg;
}

const AutomationsTab = ({ invoke }: { invoke: InvokeFn }) => {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>(emptyDraft());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        invoke("list_automations"),
        invoke("list_automation_runs", { limit: 30 }),
      ]);
      setAutomations((a?.automations || []) as Automation[]);
      setRuns((r?.runs || []) as AutomationRun[]);
    } catch (e: any) {
      toast.error("Laden fehlgeschlagen: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    const d = emptyDraft();
    d.action_config = defaultsFor(getAction(d.action_type)?.configFields);
    setDraft(d);
    setEditId(null);
    setDialogOpen(true);
  };

  const openEdit = (a: Automation) => {
    setDraft({
      name: a.name,
      enabled: a.enabled,
      trigger_type: a.trigger_type,
      action_type: a.action_type,
      action_config: { ...defaultsFor(getAction(a.action_type)?.configFields), ...(a.action_config || {}) },
    });
    setEditId(a.id);
    setDialogOpen(true);
  };

  const onActionTypeChange = (type: string) => {
    setDraft((d: any) => ({
      ...d,
      action_type: type,
      action_config: defaultsFor(getAction(type)?.configFields),
    }));
  };

  const setCfg = (key: string, value: any) =>
    setDraft((d: any) => ({ ...d, action_config: { ...d.action_config, [key]: value } }));

  const save = async () => {
    if (!draft.name.trim()) { toast.error("Name fehlt"); return; }
    try {
      if (editId) {
        await invoke("update_automation", { id: editId, ...draft });
        toast.success("Automation aktualisiert");
      } else {
        await invoke("create_automation", draft);
        toast.success("Automation erstellt");
      }
      setDialogOpen(false);
      load();
    } catch (e: any) {
      toast.error("Speichern fehlgeschlagen: " + e.message);
    }
  };

  const toggle = async (a: Automation) => {
    try {
      await invoke("update_automation", { id: a.id, enabled: !a.enabled });
      setAutomations((prev) => prev.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x)));
    } catch (e: any) {
      toast.error("Fehler: " + e.message);
    }
  };

  const remove = async (id: string) => {
    try {
      await invoke("delete_automation", { id });
      toast.success("Automation gelöscht");
      load();
    } catch (e: any) {
      toast.error("Löschen fehlgeschlagen: " + e.message);
    }
  };

  const activeAction = getAction(draft.action_type);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Automationen</h3>
          <p className="text-sm text-muted-foreground">Wenn etwas passiert (Trigger), führe eine Aktion aus.</p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Neue Automation</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Lädt…</p>
      ) : automations.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Noch keine Automationen. Lege die erste an.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {automations.map((a) => (
            <Card key={a.id}>
              <CardContent className="py-3 flex items-center gap-3">
                <Zap className={`h-4 w-4 shrink-0 ${a.enabled ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{a.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                    {triggerLabel(a.trigger_type)} <ArrowRight className="h-3 w-3" /> {actionLabel(a.action_type)}
                  </p>
                </div>
                <Switch checked={a.enabled} onCheckedChange={() => toggle(a)} />
                <Button size="icon" variant="ghost" onClick={() => openEdit(a)}><Pencil className="h-4 w-4" /></Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Automation löschen?</AlertDialogTitle>
                      <AlertDialogDescription>„{a.name}" wird dauerhaft entfernt.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(a.id)} className="bg-destructive">Löschen</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Verlauf */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Letzte Ausführungen</h4>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Ausführungen.</p>
        ) : (
          <div className="space-y-1">
            {runs.map((r) => (
              <div key={r.id} className="flex items-start gap-2 text-xs border rounded p-2">
                {r.status === "success" ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                  : r.status === "error" ? <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  : <MinusCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{r.automation_name || actionLabel(r.action_type)}</span>
                  <span className="text-muted-foreground"> · {r.message}</span>
                </div>
                <span className="text-muted-foreground shrink-0">{new Date(r.created_at).toLocaleString("de-DE")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Automation bearbeiten" : "Neue Automation"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft((d: any) => ({ ...d, name: e.target.value }))} placeholder="z.B. Aufmaß-Termin bei Fahrzeuganfrage" />
            </div>

            <div className="space-y-1">
              <Label>Wenn… (Trigger)</Label>
              <Select value={draft.trigger_type} onValueChange={(v) => setDraft((d: any) => ({ ...d, trigger_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{TRIGGERS.find((t) => t.type === draft.trigger_type)?.description}</p>
            </div>

            <div className="space-y-1">
              <Label>… dann (Aktion)</Label>
              <Select value={draft.action_type} onValueChange={onActionTypeChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => <SelectItem key={a.type} value={a.type}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{activeAction?.description}</p>
            </div>

            {/* Dynamische Config-Felder der Aktion */}
            {activeAction?.configFields.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label>{f.label}{f.optional ? " (optional)" : ""}</Label>
                {f.type === "select" ? (
                  <Select value={String(draft.action_config[f.key] ?? f.default ?? "")} onValueChange={(v) => setCfg(f.key, v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {f.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : f.type === "checkbox" ? (
                  <Switch checked={!!draft.action_config[f.key]} onCheckedChange={(c) => setCfg(f.key, c)} />
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : f.type === "time" ? "time" : "text"}
                    value={draft.action_config[f.key] ?? ""}
                    onChange={(e) => setCfg(f.key, f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
                  />
                )}
                {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
              </div>
            ))}

            <div className="flex items-center gap-2">
              <Switch checked={draft.enabled} onCheckedChange={(c) => setDraft((d: any) => ({ ...d, enabled: c }))} />
              <Label>Aktiv</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
            <Button onClick={save}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AutomationsTab;
