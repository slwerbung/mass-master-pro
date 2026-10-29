// Zugriff je Postfach: Ein Mitarbeiter sieht und bearbeitet nur Mails der ihm zugeordneten Postfaecher
// (email_account_users), ein Admin alles. Jede Function, die eine Mail, einen Vorschlag oder ein Thema
// anfasst, prueft hierueber, bevor sie etwas liest oder aendert.

import type { MailUser } from "./http.ts";

export class AccessError extends Error {}

const DENIED = "Kein Zugriff auf dieses Postfach.";

export const isMailAdmin = (u: Pick<MailUser, "accountIds">) => u.accountIds === null;

export function canAccount(u: Pick<MailUser, "accountIds">, accountId: string | null | undefined): boolean {
  return u.accountIds === null || (!!accountId && u.accountIds.includes(String(accountId)));
}

export function assertAccount(u: Pick<MailUser, "accountIds">, accountId: string | null | undefined): void {
  if (!canAccount(u, accountId)) throw new AccessError(DENIED);
}

/** Abfrage auf die eigenen Postfaecher einschraenken (Admin: unveraendert). */
export function scopeAccounts<Q extends { in: (col: string, v: string[]) => Q }>(q: Q, u: Pick<MailUser, "accountIds">, col = "account_id"): Q {
  return u.accountIds === null ? q : q.in(col, u.accountIds);
}

/** Alle Mails muessen zu eigenen Postfaechern gehoeren. Unbekannte IDs meldet der Aufrufer selbst („nicht gefunden“). */
export async function assertMessages(sb: any, u: Pick<MailUser, "accountIds">, ids: (string | null | undefined)[]): Promise<void> {
  if (u.accountIds === null) return;
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return;
  const { data, error } = await sb.from("email_messages").select("id, account_id").in("id", list);
  if (error) throw new Error(error.message);
  for (const r of data || []) assertAccount(u, r.account_id);
}

export async function assertThread(sb: any, u: Pick<MailUser, "accountIds">, threadId: string | null | undefined): Promise<void> {
  if (u.accountIds === null || !threadId) return;
  const { data, error } = await sb.from("email_threads").select("account_id").eq("id", String(threadId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) assertAccount(u, data.account_id);
}

export async function assertSuggestion(sb: any, u: Pick<MailUser, "accountIds">, suggestionId: string | null | undefined): Promise<void> {
  if (u.accountIds === null || !suggestionId) return;
  const { data, error } = await sb.from("email_suggestions").select("message_id").eq("id", String(suggestionId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) await assertMessages(sb, u, [data.message_id]);
}
