import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, invokeFn } from "@/lib/api";
import type { Account } from "@/lib/types";
import { AUTOPILOT_ACTIONS, AUTOPILOT_LABELS, type AutopilotLevel } from "@/lib/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Select, Spinner, Switch, Textarea } from "@/components/ui";
import { errorText, formatDateTime } from "@/lib/utils";

const LEVELS: { v: AutopilotLevel; l: string }[] = [{ v: "off", l: "Aus" }, { v: "suggest", l: "Vorschlag" }, { v: "auto", l: "Automatisch" }];

interface TestResult {
  runtime: string; connectMs: number; totalMs: number; created?: string[];
  folders: { path: string; specialUse: string | null }[];
  plan: { warnings: string[]; toCreate: string[]; map: Account["folder_map"] };
  inbox: { exists: number; fetched: number; parsed: number; parseFailed: number; withAttachments: number; ms: number };
}

function AccountCard({ account }: { account: Account }) {
  const qc = useQueryClient();
  const [a, setA] = useState<Account>(account);
  const [password, setPassword] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const set = <K extends keyof Account>(k: K, v: Account[K]) => setA({ ...a, [k]: v });

  const save = useMutation({
    mutationFn: () => api("save_account", {
      id: a.id, label: a.label, address: a.address, imap_host: a.imap_host, imap_port: a.imap_port, username: a.username,
      signature: a.signature, backfill: a.backfill, shadow_mode: a.shadow_mode, enabled: a.enabled, autopilot: a.autopilot,
      ...(password ? { password } : {}),
    }),
    onSuccess: () => { toast.success("Gespeichert"); setPassword(""); qc.invalidateQueries({ queryKey: ["accounts"] }); },
    onError: (e) => toast.error(errorText(e)),
  });
  const run = useMutation({
    mutationFn: (setup: boolean) => invokeFn<TestResult>("email-account-test", { accountId: a.id, ...(password ? { password } : {}), setup }),
    onSuccess: (r, setup) => { setTest(r); toast.success(setup ? "Ordner angelegt und gespeichert" : "Verbindung ok"); qc.invalidateQueries({ queryKey: ["accounts"] }); },
    onError: (e) => { setTest(null); toast.error(errorText(e)); },
  });
  const sync = useMutation({
    mutationFn: () => invokeFn<{ fetched?: number; stored?: number; error?: string; skipped?: string }[]>("email-sync", { accountId: a.id }),
    onSuccess: (r) => {
      const x = r[0];
      if (x?.error) toast.error(x.error);
      else toast.success(x?.skipped ? `Übersprungen: ${x.skipped}` : `${x?.stored ?? 0} neue Mails`);
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{a.label || a.address}</CardTitle>
          <Badge variant={a.enabled ? "good" : "secondary"}>{a.enabled ? "aktiv" : "aus"}</Badge>
          {a.shadow_mode && <Badge variant="warn">Schattenmodus</Badge>}
          {!a.has_password && <Badge variant="danger">Passwort fehlt</Badge>}
          <span className="ml-auto text-xs text-muted-foreground">Letzter Abruf: {formatDateTime(a.last_sync_at)}</span>
        </div>
        {a.last_error && <ErrorBox error={a.last_error} />}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Bezeichnung"><Input value={a.label} onChange={(e) => set("label", e.target.value)} /></Field>
          <Field label="Adresse"><Input value={a.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Benutzername"><Input value={a.username} onChange={(e) => set("username", e.target.value)} /></Field>
          <Field label="IMAP-Server"><Input value={a.imap_host} onChange={(e) => set("imap_host", e.target.value)} /></Field>
          <Field label="Port"><Input type="number" value={a.imap_port} onChange={(e) => set("imap_port", Number(e.target.value))} /></Field>
          <Field label="Passwort" hint={a.has_password ? "Leer lassen, um das gespeicherte zu behalten." : "Wird verschlüsselt gespeichert."}>
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Beim ersten Abruf nur die letzten … Mails" hint="0 = nur künftige Mails"><Input type="number" min={0} max={500} value={a.backfill} onChange={(e) => set("backfill", Number(e.target.value))} /></Field>
        </div>
        <Field label="Signatur (für Antwortentwürfe)"><Textarea value={a.signature} onChange={(e) => set("signature", e.target.value)} /></Field>

        <div className="flex flex-wrap gap-6">
          <Switch checked={a.enabled} onChange={(v) => set("enabled", v)} label="Postfach aktiv (Abruf alle 5 Minuten)" />
          <Switch checked={a.shadow_mode} onChange={(v) => set("shadow_mode", v)} label="Schattenmodus (nichts im Postfach oder in HERO verändern)" />
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium">Autopilot-Stufen</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {AUTOPILOT_ACTIONS.map((k) => (
              <div key={k} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <span>{AUTOPILOT_LABELS[k]}</span>
                <Select className="w-36" value={a.autopilot[k]} onChange={(e) => set("autopilot", { ...a.autopilot, [k]: e.target.value as AutopilotLevel })}>
                  {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
                </Select>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">„Automatisch“ greift nur bei Konfidenz ab 70 % oder sicherer Zuordnung (Thread, Projektnummer); darunter wird es zum Vorschlag.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Speichern</Button>
          <Button variant="outline" onClick={() => run.mutate(false)} disabled={run.isPending}>{run.isPending ? <Spinner /> : null} Verbindung testen</Button>
          <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending}>Ordner anlegen &amp; speichern</Button>
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>Jetzt abrufen</Button>
        </div>

        {test && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <div>Verbindung ok · {test.runtime} · Login nach {test.connectMs} ms, gesamt {test.totalMs} ms</div>
            <div>Posteingang: {test.inbox.exists} Mails, Probeabruf {test.inbox.fetched} geholt / {test.inbox.parsed} gelesen{test.inbox.parseFailed ? ` / ${test.inbox.parseFailed} nicht lesbar` : ""} in {test.inbox.ms} ms</div>
            <div className="text-xs">Gesendet: {test.plan.map.sent ?? "–"} · Entwürfe: {test.plan.map.drafts ?? "–"} · Papierkorb: {test.plan.map.trash ?? "–"}</div>
            {test.plan.toCreate.length > 0 && !test.created && <div className="text-xs">Fehlende Zielordner: {test.plan.toCreate.join(", ")}</div>}
            {test.created && <div className="text-xs">Angelegt: {test.created.length ? test.created.join(", ") : "nichts (alles war da)"}</div>}
            {test.plan.warnings.map((w) => <div key={w} className="text-xs text-amber-800">⚠ {w}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Accounts() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("list_accounts") });
  const [n, setN] = useState({ address: "", imap_host: "imap.ionos.de", username: "", password: "" });
  const create = useMutation({
    mutationFn: () => api("save_account", { ...n, label: n.address, username: n.username || n.address }),
    onSuccess: () => { toast.success("Postfach angelegt (noch aus)"); setN({ ...n, address: "", username: "", password: "" }); qc.invalidateQueries({ queryKey: ["accounts"] }); },
    onError: (e) => toast.error(errorText(e)),
  });
  if (q.isLoading) return <Spinner />;
  return (
    <div className="space-y-4">
      <ErrorBox error={q.error} />
      {q.data?.map((a) => <AccountCard key={a.id + a.has_password} account={a} />)}
      <Card>
        <CardHeader><CardTitle>Postfach hinzufügen</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Adresse"><Input value={n.address} onChange={(e) => setN({ ...n, address: e.target.value })} /></Field>
            <Field label="IMAP-Server"><Input value={n.imap_host} onChange={(e) => setN({ ...n, imap_host: e.target.value })} /></Field>
            <Field label="Benutzername" hint="Leer = Adresse"><Input value={n.username} onChange={(e) => setN({ ...n, username: e.target.value })} /></Field>
            <Field label="Passwort"><Input type="password" autoComplete="new-password" value={n.password} onChange={(e) => setN({ ...n, password: e.target.value })} /></Field>
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !n.address}>Anlegen</Button>
          <p className="text-xs text-muted-foreground">Neue Postfächer starten im Schattenmodus und ausgeschaltet. Erst „Verbindung testen“ und „Ordner anlegen“, dann aktivieren.</p>
        </CardContent>
      </Card>
    </div>
  );
}
