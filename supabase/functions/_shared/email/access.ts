// Zugriff je Postfach: Ein Mitarbeiter sieht und bearbeitet nur Mails der ihm zugeordneten Postfaecher
// (email_account_users), ein Admin alles. Jede Function, die eine Mail, einen Vorschlag oder ein Thema
// anfasst, prueft hierueber, bevor sie etwas liest oder aendert.
//
// Zuordnung (email_threads.assigned_user_id, an jeder Mail kopiert): ein einem Mitarbeiter zugeordnetes Thema sehen
// andere Mitarbeiter nicht mehr – weder in Listen noch im Detail. Admins sehen es weiter.

import type { MailUser } from "./http.ts";

export class AccessError extends Error {}

const DENIED = "Kein Zugriff auf dieses Postfach.";
const HIDDEN = "Diese Kategorie ist für dich gesperrt.";
const ASSIGNED = "Diese Mail ist einem anderen Mitarbeiter zugeordnet.";

export const isMailAdmin = (u: Pick<MailUser, "accountIds">) => u.accountIds === null;

type Hidden = { hiddenCategories?: string[] | null };
type Who = Pick<MailUser, "accountIds"> & { id?: string };

/** Sieht der Benutzer eine Mail/ein Thema mit dieser Zuordnung? Admin immer, Mitarbeiter nur Unzugeordnetes und Eigenes. */
export function seesAssigned(u: Who, assignedUserId: string | null | undefined): boolean {
  return u.accountIds === null || !assignedUserId || assignedUserId === u.id;
}

/** Abfrage auf Mails einschraenken, die keinem anderen Mitarbeiter zugeordnet sind (Admin: unveraendert). */
export function scopeAssigned<Q extends { or: (f: string, o?: { referencedTable?: string }) => Q }>(q: Q, u: Who, table?: string): Q {
  if (u.accountIds === null) return q;
  const f = u.id ? `assigned_user_id.is.null,assigned_user_id.eq.${u.id}` : "assigned_user_id.is.null";
  return table ? q.or(f, { referencedTable: table }) : q.or(f);
}

/** Sieht der Benutzer Mails dieser Kategorie? Unklassifizierte (null) sieht jeder. */
export function seesCategory(u: Hidden, category: string | null | undefined): boolean {
  const h = u.hiddenCategories ?? [];
  return !category || !h.length || !h.includes(category);
}

/** Wer von den Benutzern sieht Mails dieser Kategorie (fuer „an wen gerichtet“ und Push). */
export function visibleTo<U extends Hidden>(users: U[], category: string | null | undefined): U[] {
  return users.filter((x) => seesCategory(x, category));
}

/** Nur Kategorien, die es gibt, ohne Doppel. */
export function normalizeHidden(v: unknown, known: readonly string[]): string[] {
  return [...new Set((Array.isArray(v) ? v : []).map(String).filter((c) => known.includes(c)))];
}

/**
 * Abfrage auf Mails einschraenken, deren Kategorie der Benutzer sehen darf. `table` fuer eingebettete Mails
 * (z. B. Vorschlaege mit `email_messages!inner`).
 */
export function scopeCategories<Q extends { or: (f: string, o?: { referencedTable?: string }) => Q }>(q: Q, u: Hidden, table?: string): Q {
  const h = u.hiddenCategories ?? [];
  if (!h.length) return q;
  const f = `category.is.null,category.not.in.(${h.join(",")})`;
  return table ? q.or(f, { referencedTable: table }) : q.or(f);
}

export function canAccount(u: Pick<MailUser, "accountIds">, accountId: string | null | undefined): boolean {
  return u.accountIds === null || (!!accountId && u.accountIds.includes(String(accountId)));
}

export function assertAccount(u: Pick<MailUser, "accountIds">, accountId: string | null | undefined): void {
  if (!canAccount(u, accountId)) throw new AccessError(DENIED);
}

/** Sichtbare Kategorie UND keinem anderen zugeordnet – fuer jede Mail-Abfrage zusaetzlich zu scopeAccounts. */
export function scopeVisible<Q extends { or: (f: string, o?: { referencedTable?: string }) => Q }>(q: Q, u: Who & Hidden, table?: string): Q {
  return scopeAssigned(scopeCategories(q, u, table), u, table);
}

/** Eine einzelne Mail ansehen: eigenes Postfach, sichtbare Kategorie, nicht einem anderen zugeordnet. */
export function assertVisible(
  u: Who & Hidden,
  m: { account_id: string | null; category: string | null; assigned_user_id?: string | null },
): void {
  assertAccount(u, m.account_id);
  if (u.accountIds !== null && !seesCategory(u, m.category)) throw new AccessError(HIDDEN);
  if (!seesAssigned(u, m.assigned_user_id)) throw new AccessError(ASSIGNED);
}

/** Abfrage auf die eigenen Postfaecher einschraenken (Admin: unveraendert). */
export function scopeAccounts<Q extends { in: (col: string, v: string[]) => Q }>(q: Q, u: Pick<MailUser, "accountIds">, col = "account_id"): Q {
  return u.accountIds === null ? q : q.in(col, u.accountIds);
}

/**
 * Alle Mails muessen zu eigenen Postfaechern gehoeren, in einer sichtbaren Kategorie liegen und duerfen keinem anderen
 * zugeordnet sein. Unbekannte IDs meldet der Aufrufer selbst („nicht gefunden“).
 */
export async function assertMessages(sb: any, u: Who & Hidden, ids: (string | null | undefined)[]): Promise<void> {
  if (u.accountIds === null) return;
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return;
  const { data, error } = await sb.from("email_messages").select("id, account_id, category, assigned_user_id").in("id", list);
  if (error) throw new Error(error.message);
  for (const r of data || []) assertVisible(u, r);
}

export async function assertThread(sb: any, u: Who, threadId: string | null | undefined): Promise<void> {
  if (u.accountIds === null || !threadId) return;
  const { data, error } = await sb.from("email_threads").select("account_id, assigned_user_id").eq("id", String(threadId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  assertAccount(u, data.account_id);
  if (!seesAssigned(u, data.assigned_user_id)) throw new AccessError(ASSIGNED);
}

export async function assertSuggestion(sb: any, u: Who & Hidden, suggestionId: string | null | undefined): Promise<void> {
  if (u.accountIds === null || !suggestionId) return;
  const { data, error } = await sb.from("email_suggestions").select("message_id").eq("id", String(suggestionId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) await assertMessages(sb, u, [data.message_id]);
}
