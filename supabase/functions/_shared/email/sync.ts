// „Abholen": neue Mails aus Posteingang und Gesendet holen, parsen, speichern.
//
// Der Kern kennt weder IMAP noch Supabase direkt, sondern nur die beiden
// Schnittstellen unten. So laesst er sich mit Attrappen testen; `store.ts` und
// `imap.ts` sind die echten Gegenstuecke.
//
// Jede Mail wird einzeln gespeichert und die UID erst danach weitergeschoben:
// bricht ein Lauf ab, macht der naechste an derselben Stelle weiter. Doppelte
// (gleiche Message-ID) fangen die Datenbank-Eindeutigkeit und `insertMessage` ab.

import { isIgnorableAttachment, normalizeSubject, safeFilename } from "./mail.ts";
import type { ParsedMail } from "./parse.ts";
import type { Direction, FolderMap } from "./types.ts";

export const SYNC_LIMIT = 15;
/** Nach dieser Zeit hoert ein Lauf auf; der Rest folgt im naechsten (Edge-Limit: 150 s). */
export const SYNC_BUDGET_MS = 100_000;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface AccountRow {
  id: string;
  label: string;
  address: string;
  folder_map: FolderMap;
  inbox_uidvalidity: string | null;
  inbox_last_uid: number | null;
  sent_uidvalidity: string | null;
  sent_last_uid: number | null;
  backfill: number;
}

export interface RawFetched { uid: number; flags: string[]; source: Uint8Array }
export interface FetchedFolder {
  state: { uidValidity: string; uidNext: number; exists: number };
  baseline: number;
  messages: RawFetched[];
  more: boolean;
}

export interface SyncImap {
  fetchNew(folder: string, o: { lastUid: number | null; uidValidity: string | null; limit: number; backfill: number }): Promise<FetchedFolder>;
}

export interface MessageInsert {
  account_id: string;
  thread_id: string | null;
  folder: string;
  uid: number;
  message_id: string;
  in_reply_to: string | null;
  refs: string[];
  direction: Direction;
  from_addr: string;
  from_name: string;
  to_addrs: string[];
  cc_addrs: string[];
  subject: string;
  sent_at: string | null;
  body_text: string;
  headers: Record<string, string>;
  has_attachments: boolean;
  status: "neu" | "fehler";
  error?: string | null;
  current_folder: string;
}

export interface SyncStore {
  /** Thread, zu dem eine der Message-IDs gehoert (neueste zuerst gepruefte). */
  findThread(accountId: string, messageIds: string[]): Promise<{ id: string } | null>;
  createThread(row: { account_id: string; root_message_id: string | null; subject_norm: string; last_activity_at: string; answered: boolean }): Promise<{ id: string }>;
  touchThread(id: string, patch: { last_activity_at: string; answered?: boolean }): Promise<void>;
  /** null, wenn die Mail schon bekannt ist (gleiche Message-ID im Postfach). */
  insertMessage(row: MessageInsert): Promise<{ id: string } | null>;
  insertAttachment(row: {
    message_id: string; filename: string; mime: string; size: number; storage_path: string | null; is_ignored: boolean;
  }): Promise<void>;
  uploadAttachment(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  saveCursor(accountId: string, patch: Partial<{
    inbox_uidvalidity: string; inbox_last_uid: number; sent_uidvalidity: string; sent_last_uid: number;
  }>): Promise<void>;
}

export interface SyncDeps {
  imap: SyncImap;
  store: SyncStore;
  parse(source: Uint8Array): Promise<ParsedMail>;
}

export interface SyncSummary { fetched: number; stored: number; duplicates: number; errors: number; more: boolean; notes: string[] }

export async function syncAccount(acc: AccountRow, d: SyncDeps, limit = SYNC_LIMIT): Promise<SyncSummary> {
  const sum: SyncSummary = { fetched: 0, stored: 0, duplicates: 0, errors: 0, more: false, notes: [] };
  const fm = acc.folder_map || {};
  const plan: { key: "inbox" | "sent"; folder: string; direction: Direction }[] = [
    { key: "inbox", folder: fm.inbox || "INBOX", direction: "in" },
  ];
  if (fm.sent) plan.push({ key: "sent", folder: fm.sent, direction: "out" });
  else sum.notes.push("Kein Gesendet-Ordner bekannt – ausgehende Mails werden nicht erfasst (Verbindung testen).");

  for (const p of plan) {
    const room = limit - sum.fetched;
    if (room <= 0) { sum.more = true; break; }
    const lastUid = p.key === "inbox" ? acc.inbox_last_uid : acc.sent_last_uid;
    const validity = p.key === "inbox" ? acc.inbox_uidvalidity : acc.sent_uidvalidity;
    const res = await d.imap.fetchNew(p.folder, { lastUid, uidValidity: validity, limit: room, backfill: acc.backfill });
    sum.fetched += res.messages.length;
    sum.more = sum.more || res.more;

    let cursor = (validity != null && validity !== res.state.uidValidity) ? null : lastUid;
    if (cursor == null && !res.messages.length) cursor = res.baseline;

    const t0 = Date.now();
    for (const raw of res.messages) {
      if (Date.now() - t0 > SYNC_BUDGET_MS) { sum.more = true; break; }
      try {
        const r = await storeOne(acc, p.folder, p.direction, raw, res.state.uidValidity, d);
        if (r === "stored") sum.stored++; else sum.duplicates++;
      } catch (e) {
        // Eine kaputte Mail darf den Lauf nicht anhalten – sie wird als Fehler vermerkt.
        sum.errors++;
        sum.notes.push(`UID ${raw.uid} in ${p.folder}: ${(e as Error).message}`.slice(0, 200));
      }
      cursor = Math.max(cursor ?? 0, raw.uid);
      // Fortschritt sofort sichern: bricht der Lauf ab, geht nichts verloren.
      await d.store.saveCursor(acc.id, p.key === "inbox"
        ? { inbox_uidvalidity: res.state.uidValidity, inbox_last_uid: cursor }
        : { sent_uidvalidity: res.state.uidValidity, sent_last_uid: cursor });
    }
    const patch = p.key === "inbox"
      ? { inbox_uidvalidity: res.state.uidValidity, ...(cursor != null ? { inbox_last_uid: cursor } : {}) }
      : { sent_uidvalidity: res.state.uidValidity, ...(cursor != null ? { sent_last_uid: cursor } : {}) };
    await d.store.saveCursor(acc.id, patch);
  }
  return sum;
}

async function storeOne(
  acc: AccountRow, folder: string, direction: Direction, raw: RawFetched, uidValidity: string, d: SyncDeps,
): Promise<"stored" | "duplicate"> {
  const m = await d.parse(raw.source);
  const messageId = m.messageId ?? `<synthetic.${folder}.${uidValidity}.${raw.uid}@${acc.address}>`;
  const when = m.sentAt ?? new Date().toISOString();

  // Thread: ueber In-Reply-To/References (neueste zuerst).
  const ids = [...m.refs].reverse();
  let thread = ids.length ? await d.store.findThread(acc.id, ids) : null;
  if (!thread) {
    thread = await d.store.createThread({
      account_id: acc.id,
      root_message_id: m.refs[0] ?? messageId,
      subject_norm: normalizeSubject(m.subject),
      last_activity_at: when,
      answered: direction === "out",
    });
  } else {
    await d.store.touchThread(thread.id, { last_activity_at: when, ...(direction === "out" ? { answered: true } : {}) });
  }

  const row = await d.store.insertMessage({
    account_id: acc.id,
    thread_id: thread.id,
    folder,
    uid: raw.uid,
    message_id: messageId,
    in_reply_to: m.inReplyTo,
    refs: m.refs,
    direction,
    from_addr: m.fromAddr,
    from_name: m.fromName,
    to_addrs: m.to,
    cc_addrs: m.cc,
    subject: m.subject,
    sent_at: m.sentAt,
    body_text: m.body,
    headers: m.headers,
    has_attachments: m.attachments.length > 0,
    status: "neu",
    current_folder: folder,
  });
  if (!row) return "duplicate";

  let n = 0;
  for (const a of m.attachments) {
    n++;
    const ignored = isIgnorableAttachment(a);
    let path: string | null = null;
    if (!ignored && a.content && a.size <= MAX_ATTACHMENT_BYTES) {
      path = `${acc.id}/${row.id}/${n}-${safeFilename(a.filename)}`;
      await d.store.uploadAttachment(path, a.content, a.mime);
    }
    await d.store.insertAttachment({
      message_id: row.id, filename: a.filename, mime: a.mime, size: a.size, storage_path: path, is_ignored: ignored,
    });
  }
  return "stored";
}
