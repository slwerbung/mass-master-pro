import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input, Select, Spinner, Switch } from "@/components/ui";
import { errorText } from "@/lib/utils";

type Role = "admin" | "mitarbeiter";
interface MailUserRow { id: string; name: string; email: string | null; role: Role; active: boolean; captfix: boolean; accountIds: string[]; self: boolean }
interface AccountLite { id: string; label: string; address: string }

const PASSWORD_MIN = 10;
const empty = { name: "", email: "", password: "", role: "mitarbeiter" as Role, accountIds: [] as string[] };

/** Postfaecher als Haken (Admins sehen ohnehin alle). */
function AccountPicks({ accounts, value, onChange, disabled }: { accounts: AccountLite[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  if (!accounts.length) return <p className="text-sm text-muted-foreground">Noch keine Postfächer angelegt.</p>;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {accounts.map((a) => (
        <label key={a.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={disabled} checked={value.includes(a.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))} />
          {a.label || a.address}
        </label>
      ))}
    </div>
  );
}

export default function Users() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<MailUserRow[]>("list_users") });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<AccountLite[]>("list_accounts") });
  const [n, setN] = useState(empty);
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
  const create = useMutation({
    mutationFn: () => api("save_user", n),
    onSuccess: () => { toast.success(`${n.name} angelegt – Anmeldung mit ${n.email.trim().toLowerCase()} und dem Passwort`); setN(empty); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const accs = accounts.data ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Wer sich an der Mail-App anmelden darf. <b>Admins</b> sehen alle Postfächer und die Einstellungen. <b>Mitarbeiter</b> sehen nur die Postfächer,
        die hier angehakt sind – ohne Postfach kein Zugang. Angemeldet wird mit E-Mail-Adresse und Passwort.
        Mitarbeiter aus CaptFix stehen schon in der Liste: ihnen nur Postfächer zuordnen, Passwort und Anmeldename bleiben die aus CaptFix.
      </p>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> Neuer Benutzer</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
            <Field label="E-Mail-Adresse (Anmeldung)"><Input type="email" autoComplete="off" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></Field>
            <Field label="Passwort" hint={`mindestens ${PASSWORD_MIN} Zeichen – dem Mitarbeiter persönlich geben`}>
              <Input type="text" autoComplete="new-password" value={n.password} onChange={(e) => setN({ ...n, password: e.target.value })} />
            </Field>
            <Field label="Rolle">
              <Select value={n.role} onChange={(e) => setN({ ...n, role: e.target.value as Role })}>
                <option value="mitarbeiter">Mitarbeiter – nur zugeordnete Postfächer</option>
                <option value="admin">Admin – alles</option>
              </Select>
            </Field>
          </div>
          {n.role === "mitarbeiter" && (
            <Field label="Postfächer"><AccountPicks accounts={accs} value={n.accountIds} onChange={(v) => setN({ ...n, accountIds: v })} /></Field>
          )}
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || n.name.trim().length < 2 || !n.email.includes("@") || n.password.length < PASSWORD_MIN || (n.role === "mitarbeiter" && !n.accountIds.length)}
          >
            {create.isPending && <Spinner />} Anlegen
          </Button>
        </CardContent>
      </Card>
      <ErrorBox error={users.error || accounts.error} />
      {users.isLoading ? <Spinner /> : (
        <div className="space-y-2">
          {users.data?.map((u) => <UserRow key={u.id} user={u} accounts={accs} onSaved={refresh} />)}
        </div>
      )}
    </div>
  );
}

function UserRow({ user, accounts, onSaved }: { user: MailUserRow; accounts: AccountLite[]; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState({ name: user.name, role: user.role, active: user.active, accountIds: user.accountIds, password: "" });
  const save = useMutation({
    mutationFn: () => api("save_user", {
      id: user.id, name: d.name, role: d.role, accountIds: d.accountIds,
      ...(user.captfix ? {} : { active: d.active }), ...(d.password ? { password: d.password } : {}),
    }),
    onSuccess: () => { toast.success("Gespeichert"); setEdit(false); setD({ ...d, password: "" }); onSaved(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const names = user.accountIds.map((id) => accounts.find((a) => a.id === id)).filter(Boolean).map((a) => a!.label || a!.address);
  const access = user.role === "admin" ? "alle Postfächer" : names.length ? names.join(", ") : "kein Postfach – kein Zugang";

  return (
    <div className="rounded-lg border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{user.name}</span>
        <span className="text-muted-foreground">{user.email ?? "(ohne E-Mail)"}</span>
        <Badge variant={user.role === "admin" ? "good" : "secondary"}>{user.role === "admin" ? "Admin" : "Mitarbeiter"}</Badge>
        {user.captfix && <Badge variant="secondary">CaptFix</Badge>}
        {!user.active && <Badge variant="danger">deaktiviert</Badge>}
        {user.self && <Badge variant="secondary">du</Badge>}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEdit(!edit)}>{edit ? "Schließen" : "Bearbeiten"}</Button>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">Zugang: {access}</div>
      {edit && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            <Field label="Rolle">
              <Select value={d.role} disabled={user.self} onChange={(e) => setD({ ...d, role: e.target.value as Role })}>
                <option value="mitarbeiter">Mitarbeiter – nur zugeordnete Postfächer</option>
                <option value="admin">Admin – alles</option>
              </Select>
            </Field>
            {!user.captfix && (
              <Field label="Neues Passwort" hint={`leer lassen = unverändert, sonst mindestens ${PASSWORD_MIN} Zeichen`}>
                <Input type="text" autoComplete="new-password" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} />
              </Field>
            )}
            {!user.captfix && !user.self && (
              <div className="flex items-end"><Switch checked={d.active} onChange={(v) => setD({ ...d, active: v })} label="Aktiv (darf sich anmelden)" /></div>
            )}
          </div>
          {d.role === "mitarbeiter" && (
            <Field label="Postfächer"><AccountPicks accounts={accounts} value={d.accountIds} onChange={(v) => setD({ ...d, accountIds: v })} /></Field>
          )}
          {user.captfix && <p className="text-xs text-muted-foreground">Passwort und Aktiv/Inaktiv dieses Mitarbeiters werden in CaptFix verwaltet. Zugang zur Mail-App entziehen: alle Postfächer abwählen.</p>}
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || d.name.trim().length < 2 || (!!d.password && d.password.length < PASSWORD_MIN)}>
            {save.isPending && <Spinner />} Speichern
          </Button>
        </div>
      )}
    </div>
  );
}
