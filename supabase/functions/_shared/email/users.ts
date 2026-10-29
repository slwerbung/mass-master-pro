// Benutzer der Mail-App (Einstellungen → Benutzer, nur Admin): anlegen, Rolle, Passwort, Postfaecher zuordnen.
//
// Ein Benutzer ist ein Supabase-Auth-Konto mit Profil (profiles.role admin | mitarbeiter). Admins sehen alle
// Postfaecher, Mitarbeiter nur die zugeordneten (email_account_users). Mitarbeiter aus CaptFix (profiles.employee_id)
// erscheinen hier ebenfalls: ihr Passwort und „aktiv“ gehoeren CaptFix und werden hier nicht geaendert –
// den Zugang zur Mail-App regelt bei ihnen allein die Postfach-Zuordnung. Geloescht wird nie ein Konto.

import type { MailUser } from "./http.ts";
import type { AddresseeUser } from "./addressee.ts";

export type MailRole = "admin" | "mitarbeiter";

export interface MailUserRow {
  id: string;
  name: string;
  email: string | null;
  role: MailRole;
  active: boolean;
  /** Konto gehoert zu einem CaptFix-Mitarbeiter (Passwort/aktiv dort verwalten) */
  captfix: boolean;
  accountIds: string[];
  self: boolean;
}

export interface UserInput {
  id: string | null;
  name: string | null;
  email: string | null;
  password: string | null;
  role: MailRole | null;
  active: boolean | null;
  accountIds: string[] | null;
}

export const PASSWORD_MIN = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Eingaben pruefen und vereinheitlichen. Felder, die fehlen, bleiben null (= unveraendert). */
export function parseUserInput(body: Record<string, any>): UserInput {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined && body[k] !== null;
  const id = has("id") && String(body.id).trim() ? String(body.id).trim() : null;
  const name = has("name") ? String(body.name).trim().slice(0, 80) : null;
  if (name !== null && name.length < 2) throw new Error("Bitte einen Namen eintragen.");
  const email = has("email") ? String(body.email).trim().toLowerCase() : null;
  if (email !== null && !EMAIL_RE.test(email)) throw new Error("Die E-Mail-Adresse ist ungültig.");
  const password = has("password") && String(body.password) ? String(body.password) : null;
  if (password !== null && password.length < PASSWORD_MIN) throw new Error(`Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`);
  const role = has("role") ? String(body.role) : null;
  if (role !== null && role !== "admin" && role !== "mitarbeiter") throw new Error("Rolle: admin oder mitarbeiter.");
  const active = has("active") ? body.active === true : null;
  const accountIds = has("accountIds")
    ? [...new Set((Array.isArray(body.accountIds) ? body.accountIds : []).map(String).filter(Boolean))]
    : null;
  if (!id) {
    if (!name) throw new Error("Bitte einen Namen eintragen.");
    if (!email) throw new Error("Bitte die E-Mail-Adresse für die Anmeldung eintragen.");
    if (!password) throw new Error(`Bitte ein Passwort mit mindestens ${PASSWORD_MIN} Zeichen vergeben.`);
  }
  return { id, name, email: id ? null : email, password, role: role as MailRole | null, active, accountIds };
}

/** Was ein Admin an einem bestehenden Konto aendern darf (sich selbst nicht aussperren, CaptFix-Konten nicht umbauen). */
export function checkUpdate(
  input: UserInput,
  target: { id: string; role: string; is_active: boolean; employee_id: string | null },
  self: Pick<MailUser, "id">,
  activeAdmins: number,
): void {
  if (target.role !== "admin" && target.role !== "mitarbeiter") throw new Error("Dieses Konto ist kein Mitarbeiter-Konto.");
  const isSelf = target.id === self.id;
  if (isSelf && input.role && input.role !== target.role) throw new Error("Die eigene Rolle lässt sich nicht ändern.");
  if (isSelf && input.active === false) throw new Error("Das eigene Konto lässt sich nicht deaktivieren.");
  if (target.employee_id && input.password) throw new Error("Das Passwort dieses Mitarbeiters wird in CaptFix verwaltet.");
  if (target.employee_id && input.active !== null && input.active !== target.is_active) {
    throw new Error("Dieser Mitarbeiter wird in CaptFix aktiviert/deaktiviert. Für die Mail-App reicht es, die Postfächer abzuwählen.");
  }
  const losesAdmin = target.role === "admin" && target.is_active && ((input.role && input.role !== "admin") || input.active === false);
  if (losesAdmin && activeAdmins <= 1) throw new Error("Es muss mindestens ein aktiver Admin bleiben.");
}

function must<T>(r: { data: T; error: any }): T {
  if (r.error) throw new Error(r.error.message || String(r.error));
  return r.data;
}

async function authEmails(sb: any): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data?.users || [];
    for (const u of users) out.set(u.id, u.email ?? null);
    if (users.length < 200) break;
  }
  return out;
}

export async function listMailUsers(sb: any, self: Pick<MailUser, "id">): Promise<MailUserRow[]> {
  const [profiles, links, emails] = await Promise.all([
    sb.from("profiles").select("id, display_name, role, is_active, employee_id").in("role", ["admin", "mitarbeiter"]).order("display_name"),
    sb.from("email_account_users").select("account_id, user_id"),
    authEmails(sb),
  ]);
  const byUser = new Map<string, string[]>();
  for (const l of must(links) as any[]) (byUser.get(l.user_id) ?? byUser.set(l.user_id, []).get(l.user_id)!).push(String(l.account_id));
  return (must(profiles) as any[]).map((p) => ({
    id: p.id, name: p.display_name, email: emails.get(p.id) ?? null, role: p.role, active: p.is_active !== false,
    captfix: !!p.employee_id, accountIds: byUser.get(p.id) ?? [], self: p.id === self.id,
  }));
}

async function setAccounts(sb: any, userId: string, accountIds: string[]): Promise<void> {
  if (accountIds.length) {
    const known = (must(await sb.from("email_accounts").select("id").in("id", accountIds)) as any[]).map((r) => String(r.id));
    if (known.length !== accountIds.length) throw new Error("Unbekanntes Postfach.");
  }
  const current = (must(await sb.from("email_account_users").select("account_id").eq("user_id", userId)) as any[]).map((r) => String(r.account_id));
  const drop = current.filter((a) => !accountIds.includes(a));
  const add = accountIds.filter((a) => !current.includes(a));
  if (drop.length) must(await sb.from("email_account_users").delete().eq("user_id", userId).in("account_id", drop));
  if (add.length) must(await sb.from("email_account_users").insert(add.map((account_id) => ({ account_id, user_id: userId }))));
}

/** Anlegen (ohne id) oder aendern. Gibt die id zurueck. */
export async function saveMailUser(sb: any, self: Pick<MailUser, "id">, body: Record<string, any>): Promise<{ id: string; created: boolean }> {
  const input = parseUserInput(body);
  if (!input.id) {
    const { data, error } = await sb.auth.admin.createUser({
      email: input.email, password: input.password, email_confirm: true, user_metadata: { display_name: input.name },
    });
    if (error || !data?.user) {
      const msg = String(error?.message || "");
      throw new Error(/already|registered|exists/i.test(msg) ? "Für diese E-Mail-Adresse gibt es schon ein Konto." : `Konto anlegen: ${msg || "unbekannter Fehler"}`);
    }
    const id = data.user.id as string;
    must(await sb.from("profiles").upsert({ id, display_name: input.name, role: input.role ?? "mitarbeiter", is_active: true }, { onConflict: "id" }));
    if (input.accountIds) await setAccounts(sb, id, input.accountIds);
    return { id, created: true };
  }

  const target = must(await sb.from("profiles").select("id, role, is_active, employee_id").eq("id", input.id).maybeSingle()) as any;
  if (!target) throw new Error("Benutzer nicht gefunden.");
  const { count } = await sb.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("is_active", true);
  checkUpdate(input, target, self, count ?? 0);

  const patch: Record<string, unknown> = {};
  if (input.name) patch.display_name = input.name;
  if (input.role) patch.role = input.role;
  if (input.active !== null && !target.employee_id) patch.is_active = input.active;
  if (Object.keys(patch).length) must(await sb.from("profiles").update(patch).eq("id", input.id));
  if (input.password) {
    const { error } = await sb.auth.admin.updateUserById(input.id, { password: input.password });
    if (error) throw new Error(`Passwort: ${error.message}`);
  }
  if (input.accountIds) await setAccounts(sb, input.id, input.accountIds);
  return { id: input.id, created: false };
}

// ---------------------------------------------------------------- Wer sieht welches Postfach (fuer „an wen gerichtet“)

let audienceCache: { at: number; value: Map<string, AddresseeUser[]> } | null = null;

/** Sammeladressen sind nie persoenlich („info@“ gehoert allen). */
const GENERIC_LOCAL = /^(info|kontakt|contact|office|post|mail|service|team|hallo|hello|buero|buchhaltung|rechnung|rechnungen|einkauf|verkauf|anfrage|anfragen|auftrag|bestellung|support|noreply|no-reply)$/;

/**
 * Persoenliche Adressen eines Mitarbeiters fuer „an wen gerichtet“: Anmelde- und CaptFix-Adresse – aber eine
 * Postfach-Adresse nur, wenn er der einzige ist, dem dieses Postfach zugeordnet ist (jl@ gehoert Jonas; info@ gehoert
 * allen, auch wenn sich ein Admin mit info@ anmeldet – sonst bekaeme nur er jede Mail an info@).
 */
export function personalEmails(userId: string, emails: string[], mailboxes: { address: string; assignees: string[] }[]): string[] {
  const out = new Set<string>();
  for (const raw of emails) {
    const e = String(raw || "").trim().toLowerCase();
    if (!e.includes("@") || GENERIC_LOCAL.test(e.split("@")[0])) continue;
    const box = mailboxes.find((b) => b.address.toLowerCase() === e);
    if (box && !(box.assignees.length === 1 && box.assignees[0] === userId)) continue;
    out.add(e);
  }
  return [...out];
}

/**
 * Postfach -> Mitarbeiter mit Zugriff (aktive Admins sehen alle Postfaecher, Mitarbeiter die zugeordneten), je mit Namen
 * und persoenlichen Adressen (Anmelde-Adresse, Mitarbeiter-Adresse aus CaptFix). 5 Minuten zwischengespeichert.
 */
export async function mailAudience(sb: any): Promise<Map<string, AddresseeUser[]>> {
  if (audienceCache && Date.now() - audienceCache.at < 300_000) return audienceCache.value;
  const [profiles, links, accounts, emails] = await Promise.all([
    sb.from("profiles").select("id, display_name, role, is_active, employees(email)").in("role", ["admin", "mitarbeiter"]).eq("is_active", true),
    sb.from("email_account_users").select("account_id, user_id"),
    sb.from("email_accounts").select("id, address, username"),
    authEmails(sb).catch(() => new Map<string, string | null>()),
  ]);
  const linkRows = must(links) as any[];
  const mailboxes = (must(accounts) as any[]).flatMap((a) => {
    const assignees = linkRows.filter((l) => l.account_id === a.id).map((l) => String(l.user_id));
    return [a.address, a.username].filter((x) => x && String(x).includes("@")).map((address: string) => ({ address, assignees }));
  });
  const people = new Map<string, { user: AddresseeUser; admin: boolean }>();
  for (const p of must(profiles) as any[]) {
    const mails = personalEmails(p.id, [emails.get(p.id), p.employees?.email].filter(Boolean) as string[], mailboxes);
    people.set(p.id, { user: { id: p.id, name: String(p.display_name || ""), emails: mails }, admin: p.role === "admin" });
  }
  const out = new Map<string, AddresseeUser[]>();
  for (const a of must(accounts) as any[]) out.set(a.id, [...people.values()].filter((x) => x.admin).map((x) => x.user));
  for (const l of linkRows) {
    const p = people.get(l.user_id);
    const list = out.get(l.account_id);
    if (p && list && !list.some((u) => u.id === p.user.id)) list.push(p.user);
  }
  audienceCache = { at: Date.now(), value: out };
  return out;
}
