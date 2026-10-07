// IMAP-Zugriff fuer den Mail-Assistenten.
//
// Harte Regeln (Konzept „Kein Versand, kein Loeschen"):
//   * Hier steht KEIN SMTP und KEIN Loeschen. Verschoben wird nur, geloescht nie.
//     `imap.test.ts` prueft den Quelltext darauf.
//   * IMAP-Befehle laufen NIE innerhalb einer laufenden fetch-Schleife: erst
//     einsammeln (`fetchAll`), dann handeln. Sonst haengt der Server die
//     Verbindung auf.
//
// `imapflow` kommt ueber die Import-Map der jeweiligen Function (`deno.json`).

import { ImapFlow } from "imapflow";

export interface ImapCreds {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Implizites TLS. Standard: an bei Port 993. Nur fuer Tests auf false. */
  secure?: boolean;
}

export interface FolderInfo {
  path: string;
  name: string;
  /** IMAP-Sonderkennzeichen: \Sent, \Drafts, \Trash, \Junk, \Archive, \All */
  specialUse: string | null;
  flags: string[];
}

export interface RawMessage {
  uid: number;
  flags: string[];
  source: Uint8Array;
}

const FETCH_CHUNK = 3;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;

export function makeClient(c: ImapCreds): ImapFlow {
  return new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.secure ?? c.port === 993,
    // Nur bei ausdruecklich unverschluesseltem Test-Server (secure=false) kein STARTTLS erzwingen.
    ...(c.secure === false ? { doSTARTTLS: false } : {}),
    auth: { user: c.user, pass: c.pass },
    logger: false,
    // Ohne diese Grenze blockiert ein haengender Server die ganze Function.
    socketTimeout: 60_000,
    greetingTimeout: 20_000,
    connectionTimeout: 20_000,
  });
}

/** Verbindung auf, Arbeit, Verbindung zu — auch wenn die Arbeit scheitert. */
export async function withImap<T>(c: ImapCreds, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = makeClient(c);
  // Ein Socket-Fehler wuerde sonst als unbehandeltes Ereignis die Function beenden.
  client.on("error", () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try { await client.logout(); } catch { /* Verbindung ist ohnehin weg */ }
  }
}

export async function listFolders(client: ImapFlow): Promise<FolderInfo[]> {
  const list = await client.list();
  return list.map((m: any) => ({
    path: m.path,
    name: m.name,
    specialUse: m.specialUse ?? null,
    flags: [...(m.flags ?? [])],
  }));
}

/** Sonderordner ueber das IMAP-Kennzeichen finden, nicht ueber den Namen. */
export function pickSpecial(folders: FolderInfo[], use: "\\Sent" | "\\Drafts" | "\\Trash" | "\\Junk"): string | null {
  return folders.find((f) => f.specialUse === use)?.path ?? null;
}

export interface FolderState {
  uidValidity: string;
  uidNext: number;
  exists: number;
}

export interface FetchResult {
  state: FolderState;
  /** UID, ab der beim naechsten Mal weitergemacht wird, wenn nichts geholt wurde (uidNext - 1). */
  baseline: number;
  messages: RawMessage[];
  /** true, wenn noch mehr neue Mails warten (Limit erreicht). */
  more: boolean;
}

/**
 * Neue Mails eines Ordners holen, ab der UID nach `lastUid`.
 *
 * - `lastUid = null` heisst „noch nie synchronisiert": dann nur die letzten
 *   `backfill` Mails, nicht das ganze Archiv (jede Mail kostet KI-Aufrufe).
 * - Hat sich `uidValidity` geaendert, sind alle gespeicherten UIDs wertlos;
 *   dann wird wie beim ersten Mal begonnen. Doppelte fangen die Message-IDs ab.
 */
export async function fetchNew(
  client: ImapFlow,
  folder: string,
  opts: { lastUid: number | null; uidValidity: string | null; limit: number; backfill: number },
): Promise<FetchResult> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const mb: any = client.mailbox;
    const state: FolderState = {
      uidValidity: String(mb.uidValidity ?? ""),
      uidNext: Number(mb.uidNext ?? 0),
      exists: Number(mb.exists ?? 0),
    };
    const baseline = Math.max(0, state.uidNext - 1);
    if (!state.exists) return { state, baseline, messages: [], more: false };

    const reset = opts.lastUid == null || (opts.uidValidity != null && opts.uidValidity !== state.uidValidity);
    let from: number;
    if (reset && opts.backfill <= 0) {
      // Nur kuenftige Mails: nichts holen, ab jetzt mitlaufen.
      return { state, baseline, messages: [], more: false };
    }
    if (reset) {
      // Die UID der `backfill`-letzten Mail ueber die Sequenznummer finden.
      const seqStart = Math.max(1, state.exists - opts.backfill + 1);
      const first = await client.fetchOne(String(seqStart), { uid: true });
      from = first && first.uid ? Number(first.uid) : 1;
    } else {
      from = (opts.lastUid as number) + 1;
    }

    // `N:*` liefert IMMER mindestens die letzte Mail, auch wenn ihre UID < N ist.
    const found: number[] = ((await client.search({ uid: `${from}:*` }, { uid: true })) || [])
      .filter((u: number) => u >= from)
      .sort((a: number, b: number) => a - b);
    const take = found.slice(0, opts.limit);
    if (!take.length) return { state, baseline, messages: [], more: false };

    // In kleinen Paketen holen und bei MAX_BATCH_BYTES abbrechen: 50 Mails mit grossen
    // Anhaengen auf einmal sprengen den Speicher der Edge Runtime (HTTP 546). Der Rest
    // bleibt fuer den naechsten Lauf liegen (`more`).
    const messages: RawMessage[] = [];
    let bytes = 0;
    for (let i = 0; i < take.length; i += FETCH_CHUNK) {
      const chunk = take.slice(i, i + FETCH_CHUNK);
      const fetched = await client.fetchAll(chunk.join(","), { uid: true, flags: true, source: true }, { uid: true });
      for (const m of fetched as any[]) {
        if (!m.source) continue;
        bytes += (m.source as Uint8Array).byteLength;
        messages.push({ uid: Number(m.uid), flags: [...(m.flags ?? [])], source: m.source as Uint8Array });
      }
      if (bytes >= MAX_BATCH_BYTES) break;
    }
    messages.sort((a, b) => a.uid - b.uid);
    const lastTaken = messages.length ? messages[messages.length - 1].uid : 0;
    return { state, baseline, messages, more: found.some((u) => u > lastTaken) };
  } finally {
    lock.release();
  }
}

/** Legt fehlende Ordner an (idempotent). Gibt die neu angelegten zurueck. */
export async function ensureFolders(client: ImapFlow, folders: FolderInfo[], wanted: string[]): Promise<string[]> {
  const have = new Set(folders.map((f) => f.path));
  const created: string[] = [];
  for (const path of wanted) {
    if (!path || have.has(path)) continue;
    await client.mailboxCreate(path);
    have.add(path);
    created.push(path);
  }
  return created;
}

/** Eine Mail in einen anderen Ordner verschieben. Gibt die neue UID zurueck, wenn der Server sie nennt. */
export async function moveMessage(client: ImapFlow, folder: string, uid: number, dest: string): Promise<number | null> {
  const lock = await client.getMailboxLock(folder);
  try {
    const res: any = await client.messageMove(String(uid), dest, { uid: true });
    const map: Map<number, number> | undefined = res?.uidMap;
    return map?.get(uid) ?? null;
  } finally {
    lock.release();
  }
}

/** Schlagwoerter setzen (Thunderbird zeigt sie als Tags). */
export async function addKeywords(client: ImapFlow, folder: string, uid: number, keywords: string[]): Promise<void> {
  if (!keywords.length) return;
  const lock = await client.getMailboxLock(folder);
  try {
    await client.messageFlagsAdd(String(uid), keywords, { uid: true });
  } finally {
    lock.release();
  }
}

export async function removeKeywords(client: ImapFlow, folder: string, uid: number, keywords: string[]): Promise<void> {
  if (!keywords.length) return;
  const lock = await client.getMailboxLock(folder);
  try {
    await client.messageFlagsRemove(String(uid), keywords, { uid: true });
  } finally {
    lock.release();
  }
}

/** Entwurf in den Entwuerfe-Ordner schreiben. Gibt die UID zurueck, wenn bekannt. */
export async function appendDraft(client: ImapFlow, draftsPath: string, raw: Uint8Array): Promise<number | null> {
  const res: any = await client.append(draftsPath, raw as any, ["\\Draft", "\\Seen"]);
  return res?.uid ? Number(res.uid) : null;
}

/** UID einer Mail ueber ihre Message-ID finden. Gebraucht, um einen ueberholten
 *  eigenen Entwurf zu ersetzen: der alte wandert per `moveMessage` in den
 *  Papierkorb, geloescht wird nie. */
export async function findUidByMessageId(client: ImapFlow, folder: string, messageId: string): Promise<number | null> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const hits = await client.search({ header: { "message-id": messageId } }, { uid: true });
    return hits && hits.length ? Number(hits[hits.length - 1]) : null;
  } finally {
    lock.release();
  }
}
