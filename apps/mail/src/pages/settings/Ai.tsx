import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AiSetting, Provider } from "@/lib/types";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Select, Spinner, Switch } from "@/components/ui";
import { errorText } from "@/lib/utils";

const TASK_LABELS: Record<string, string> = {
  understand: "Verstehen (Kategorie, Extraktion)", pick_project: "Projektwahl", summarize_out: "Ausgehende Mail zusammenfassen",
  draft: "Antwortentwurf", prepare_offer: "Angebot vorbereiten",
};
const TYPE_LABELS = { cloudflare: "Cloudflare Workers AI", anthropic: "Anthropic", openai: "OpenAI-kompatibel" };

function ProviderCard({ p }: { p: Provider }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ ...p });
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: () => api("save_provider", { id: p.id, name: v.name, base_url: v.base_url ?? "", account_id: v.account_id ?? "", enabled: v.enabled, ...(key ? { api_key: key } : {}) }),
    onSuccess: () => { toast.success("Gespeichert"); setKey(""); qc.invalidateQueries({ queryKey: ["ai"] }); },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <b>{p.name}</b><Badge variant="secondary">{TYPE_LABELS[p.type]}</Badge>
        {p.has_key ? <Badge variant="good">Schlüssel hinterlegt</Badge> : <Badge variant="danger">Schlüssel fehlt</Badge>}
        <div className="ml-auto"><Switch checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e })} label="aktiv" /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="API-Schlüssel" hint="Wird verschlüsselt gespeichert und nie wieder angezeigt."><Input type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} /></Field>
        {p.type === "cloudflare" && <Field label="Cloudflare Account-ID"><Input value={v.account_id ?? ""} onChange={(e) => setV({ ...v, account_id: e.target.value })} /></Field>}
        {p.type === "openai" && <Field label="Basis-URL" hint="z. B. https://api.groq.com/openai/v1"><Input value={v.base_url ?? ""} onChange={(e) => setV({ ...v, base_url: e.target.value })} /></Field>}
      </div>
      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Speichern</Button>
    </div>
  );
}

function TaskRow({ s, providers }: { s: AiSetting; providers: Provider[] }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ ...s });
  const save = useMutation({
    mutationFn: () => api("save_ai_setting", { ...v }),
    onSuccess: () => { toast.success("Gespeichert"); qc.invalidateQueries({ queryKey: ["ai"] }); },
    onError: (e) => toast.error(errorText(e)),
  });
  const provSelect = (value: string | null, onChange: (id: string | null) => void) => (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">–</option>
      {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </Select>
  );
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="font-medium">{TASK_LABELS[s.task] ?? s.task}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Anbieter">{provSelect(v.provider_id, (id) => setV({ ...v, provider_id: id }))}</Field>
        <Field label="Modell"><Input value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} /></Field>
        <div />
        <Field label="Ausweichen auf">{provSelect(v.fallback_provider_id, (id) => setV({ ...v, fallback_provider_id: id }))}</Field>
        <Field label="Ausweich-Modell"><Input value={v.fallback_model ?? ""} onChange={(e) => setV({ ...v, fallback_model: e.target.value })} /></Field>
        <div />
        <Field label="Vergleichs-Anbieter (Schattenmodus)">{provSelect(v.shadow_provider_id, (id) => setV({ ...v, shadow_provider_id: id }))}</Field>
        <Field label="Vergleichs-Modell"><Input value={v.shadow_model ?? ""} onChange={(e) => setV({ ...v, shadow_model: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tageskontingent erschöpft">
          <Select value={v.on_limit} onChange={(e) => setV({ ...v, on_limit: e.target.value as AiSetting["on_limit"] })}>
            <option value="ausweichen">Auf Ausweich-Anbieter ausweichen</option>
            <option value="warten">Bis Mitternacht (UTC) warten</option>
          </Select>
        </Field>
        <Field label="Cloudflare-Tageslimit (Neurons)"><Input type="number" value={v.daily_neuron_limit} onChange={(e) => setV({ ...v, daily_neuron_limit: Number(e.target.value) })} /></Field>
      </div>
      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Speichern</Button>
    </div>
  );
}

export default function Ai() {
  const q = useQuery({ queryKey: ["ai"], queryFn: () => api<{ providers: Provider[]; settings: AiSetting[] }>("list_ai") });
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <ErrorBox error={q.error} />
      <Card>
        <CardHeader><CardTitle>Anbieter</CardTitle></CardHeader>
        <CardContent className="space-y-3">{d?.providers.map((p) => <ProviderCard key={p.id + p.has_key} p={p} />)}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Aufgaben</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Mit einem Vergleichs-Anbieter läuft jede Mail im Schattenmodus parallel durch zwei Modelle; Abweichungen stehen in der Mail-Detailansicht.</p>
          {d?.settings.map((s) => <TaskRow key={s.task + JSON.stringify(s)} s={s} providers={d.providers} />)}
        </CardContent>
      </Card>
    </div>
  );
}
