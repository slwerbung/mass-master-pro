// Zugriff je Postfach: Ein Mitarbeiter sieht und bearbeitet nur Mails der ihm zugeordneten Postfaecher
// (email_account_users), ein Admin alles. Jede Function, die eine Mail, einen Vorschlag oder ein Thema
// anfasst, prueft hierueber, bevor sie etwas liest oder aendert.

import type { MailUser } from "./http.ts";

export class AccessError extends Error {}

const DENIED = "Kein Zugriff auf dieses Postfach.";
const HIDDEN = "Diese Kategorie ist für dich gesperrt.";

export const isMailAdmin = (u: Pick<MailUser, "accountIds">) => u.accountIds === null;

type Hidden = { hiddenCategories?: string[] | null };

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

/** Eine einzelne Mail ansehen: eigenes Postfach und sichtbare Kategorie. */
export function assertVisible(u: Pick<MailUser, "accountIds"> & Hidden, m: { account_id: string | null; category: string | null }): void {
  assertAccount(u, m.account_id);
  if (u.accountIds !== null && !seesCategory(u, m.category)) throw new AccessError(HIDDEN);
}

/** Abfrage auf die eigenen Postfaecher einschraenken (Admin: unveraendert). */
export function scopeAccounts<Q extends { in: (col: string, v: string[]) => Q }>(q: Q, u: Pick<MailUser, "accountIds">, col = "account_id"): Q {
  return u.accountIds === null ? q : q.in(col, u.accountIds);
}

/** Alle Mails muessen zu eigenen Postfaechern gehoeren und in einer sichtbaren Kategorie liegen. Unbekannte IDs meldet der Aufrufer selbst („nicht gefunden“). */
export async function assertMessages(sb: any, u: Pick<MailUser, "accountIds"> & Hidden, ids: (string | null | undefined)[]): Promise<void> {
  if (u.accountIds === null) return;
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return;
  const { data, error } = await sb.from("email_messages").select("id, account_id, category").in("id", list);
  if (error) throw new Error(error.message);
  for (const r of data || []) {
    assertAccount(u, r.account_id);
    if (!seesCategory(u, r.category)) throw new AccessError(HIDDEN);
  }
}

export async function assertThread(sb: any, u: Pick<MailUser, "accountIds">, threadId: string | null | undefined): Promise<void> {
  if (u.accountIds === null || !threadId) return;
  const { data, error } = await sb.from("email_threads").select("account_id").eq("id", String(threadId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) assertAccount(u, data.account_id);
}

export async function assertSuggestion(sb: any, u: Pick<MailUser, "accountIds"> & Hidden, suggestionId: string | null | undefined): Promise<void> {
  if (u.accountIds === null || !suggestionId) return;
  const { data, error } = await sb.from("email_suggestions").select("message_id").eq("id", String(suggestionId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) await assertMessages(sb, u, [data.message_id]);
}
