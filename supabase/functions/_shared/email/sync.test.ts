import { describe, expect, it } from "vitest";
import { type AccountRow, type MessageInsert, type SyncDeps, type SyncStore, SYNC_LIMIT, syncAccount } from "./sync.ts";
import type { ParsedMail } from "./parse.ts";

const acc = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: "A1", label: "info@", address: "info@slwerbung.de", folder_map: { inbox: "INBOX", sent: "Sent" },
  inbox_uidvalidity: "7", inbox_last_uid: 10, sent_uidvalidity: "9", sent_last_uid: 5, backfill: 50, ...over,
});

function mail(over: Partial<ParsedMail> = {}): ParsedMail {
  return {
    messageId: "<m1@x>", inReplyTo: null, refs: [], fromAddr: "kunde@x.de", fromName: "Kunde", to: ["info@slwerbung.de"], cc: [],
    subject: "Anfrage", sentAt: "2026-10-05T08:00:00.000Z", body: "Hallo", headers: {}, attachments: [], ...over,
  };
}

function fake(parsed: Record<number, ParsedMail | Error>, folders: Record<string, { uids: number[]; validity?: string; uidNext?: number; more?: boolean }>) {
  const log = { threads: [] as any[], msgs: [] as MessageInsert[], atts: [] as any[], uploads: [] as string[], cursors: [] as any[], touched: [] as any[], fetchCalls: [] as any[] };
  const known = new Set<string>();
  const threadByMsg = new Map<string, string>();
  const store: SyncStore = {
    async findThread(_a, ids) { for (const i of ids) if (threadByMsg.has(i)) return { id: threadByMsg.get(i)! }; return null; },
    async createThread(r) { const id = `T${log.threads.length + 1}`; log.threads.push({ id, ...r }); return { id }; },
    async touchThread(id, patch) { log.touched.push({ id, ...patch }); },
    async insertMessage(r) {
      if (known.has(r.message_id)) return null;
      known.add(r.message_id); threadByMsg.set(r.message_id, r.thread_id!);
      log.msgs.push(r); return { id: `M${log.msgs.length}` };
    },
    async insertAttachment(r) { log.atts.push(r); },
    async uploadAttachment(p) { log.uploads.push(p); },
    async saveCursor(id, patch) { log.cursors.push({ id, ...patch }); },
  };
  const deps: SyncDeps = {
    store,
    parse: async (src) => {
      const uid = Number(new TextDecoder().decode(src));
      const p = parsed[uid];
      if (p instanceof Error) throw p;
      return p ?? mail({ messageId: `<m${uid}@x>` });
    },
    imap: {
      async fetchNew(folder, o) {
        log.fetchCalls.push({ folder, ...o });
        const f = folders[folder] ?? { uids: [] };
        const from = o.lastUid == null ? 1 : o.lastUid + 1;
        const take = f.uids.filter((u) => u >= from).slice(0, o.limit);
        return {
          state: { uidValidity: f.validity ?? "7", uidNext: f.uidNext ?? Math.max(0, ...f.uids) + 1, exists: f.uids.length },
          baseline: (f.uidNext ?? Math.max(0, ...f.uids) + 1) - 1,
          messages: take.map((u) => ({ uid: u, flags: [], source: new TextEncoder().encode(String(u)) })),
          more: f.uids.filter((u) => u >= from).length > take.length || !!f.more,
        };
      },
    },
  };
  return { deps, log };
}

describe("syncAccount", () => {
  it("holt Posteingang und Gesendet, setzt Richtung und Cursor", async () => {
    const { deps, log } = fake({}, { INBOX: { uids: [11, 12] }, Sent: { uids: [6], validity: "9" } });
    const r = await syncAccount(acc(), deps);
    expect(r).toMatchObject({ fetched: 3, stored: 3, errors: 0 });
    expect(log.msgs.map((m) => [m.folder, m.direction, m.uid])).toEqual([["INBOX", "in", 11], ["INBOX", "in", 12], ["Sent", "out", 6]]);
    expect(log.msgs.every((m) => m.status === "neu")).toBe(true);
    // Fortschritt wird nach jeder Mail gesichert, am Ende je Ordner noch einmal.
    expect(log.cursors).toEqual([
      { id: "A1", inbox_uidvalidity: "7", inbox_last_uid: 11 },
      { id: "A1", inbox_uidvalidity: "7", inbox_last_uid: 12 },
      { id: "A1", inbox_uidvalidity: "7", inbox_last_uid: 12 },
      { id: "A1", sent_uidvalidity: "9", sent_last_uid: 6 },
      { id: "A1", sent_uidvalidity: "9", sent_last_uid: 6 },
    ]);
  });

  it("begrenzt auf SYNC_LIMIT Mails je Lauf ueber beide Ordner und meldet 'more'", async () => {
    const uids = Array.from({ length: 60 }, (_, i) => 11 + i);
    const { deps, log } = fake({}, { INBOX: { uids }, Sent: { uids: [6], validity: "9" } });
    const r = await syncAccount(acc(), deps);
    expect(r.fetched).toBe(SYNC_LIMIT);
    expect(r.more).toBe(true);
    expect(log.fetchCalls).toHaveLength(1);
    expect(log.cursors.at(-1)?.inbox_last_uid).toBe(10 + SYNC_LIMIT);
  });

  it("verknuepft Antworten ueber References mit dem Thread; Gesendetes markiert ihn als beantwortet", async () => {
    const { deps, log } = fake(
      {
        11: mail({ messageId: "<a@x>", subject: "Anfrage Sprinter" }),
        12: mail({ messageId: "<b@x>", subject: "AW: Anfrage Sprinter", refs: ["<a@x>"], inReplyTo: "<a@x>" }),
      },
      { INBOX: { uids: [11] }, Sent: { uids: [6], validity: "9" } },
    );
    deps.parse = ((orig) => async (src: Uint8Array) => {
      const uid = Number(new TextDecoder().decode(src));
      return uid === 6 ? mail({ messageId: "<b@x>", fromAddr: "info@slwerbung.de", refs: ["<a@x>"], inReplyTo: "<a@x>", subject: "AW: Anfrage Sprinter" }) : orig(src);
    })(deps.parse);
    await syncAccount(acc(), deps);
    expect(log.threads).toHaveLength(1);
    expect(log.threads[0]).toMatchObject({ root_message_id: "<a@x>", subject_norm: "anfrage sprinter", answered: false });
    expect(log.msgs[1].thread_id).toBe("T1");
    expect(log.touched).toEqual([{ id: "T1", last_activity_at: "2026-10-05T08:00:00.000Z", answered: true }]);
  });

  it("Dubletten (gleiche Message-ID) werden nicht doppelt gespeichert, der Cursor rueckt trotzdem vor", async () => {
    const { deps, log } = fake({ 11: mail({ messageId: "<same@x>" }), 12: mail({ messageId: "<same@x>" }) }, { INBOX: { uids: [11, 12] } });
    const r = await syncAccount(acc({ folder_map: { inbox: "INBOX" } }), deps);
    expect(r).toMatchObject({ stored: 1, duplicates: 1 });
    expect(log.cursors.at(-1)!.inbox_last_uid).toBe(12);
  });

  it("eine kaputte Mail haelt den Lauf nicht an", async () => {
    const { deps, log } = fake({ 11: new Error("kaputtes MIME") }, { INBOX: { uids: [11, 12] } });
    const r = await syncAccount(acc({ folder_map: { inbox: "INBOX" } }), deps);
    expect(r).toMatchObject({ stored: 1, errors: 1 });
    expect(r.notes.join(" ")).toContain("kaputtes MIME");
    expect(log.cursors.at(-1)!.inbox_last_uid).toBe(12);
  });

  it("erfindet eine Message-ID, wenn sie fehlt", async () => {
    const { deps, log } = fake({ 11: mail({ messageId: null }) }, { INBOX: { uids: [11] } });
    await syncAccount(acc({ folder_map: { inbox: "INBOX" } }), deps);
    expect(log.msgs[0].message_id).toBe("<synthetic.INBOX.7.11@info@slwerbung.de>");
  });

  it("Erstlauf ohne Mails merkt sich die Grundlinie (uidNext - 1)", async () => {
    const { deps, log } = fake({}, { INBOX: { uids: [], uidNext: 100 } });
    await syncAccount(acc({ inbox_last_uid: null, inbox_uidvalidity: null, folder_map: { inbox: "INBOX" } }), deps);
    expect(log.cursors).toEqual([{ id: "A1", inbox_uidvalidity: "7", inbox_last_uid: 99 }]);
  });

  it("geaenderte UIDVALIDITY: Cursor wird neu aufgebaut", async () => {
    const { deps, log } = fake({}, { INBOX: { uids: [1, 2], validity: "8" } });
    await syncAccount(acc({ folder_map: { inbox: "INBOX" } }), deps);
    expect(log.cursors[0]).toEqual({ id: "A1", inbox_uidvalidity: "8", inbox_last_uid: 2 });
  });

  it("speichert Anhaenge, ignoriert Winziges, laesst Uebergrosses ohne Datei", async () => {
    const big = new Uint8Array(10);
    const { deps, log } = fake({
      11: mail({
        attachments: [
          { filename: "Layout V2.pdf", mime: "application/pdf", size: 200_000, inline: false, content: big },
          { filename: "sig.png", mime: "image/png", size: 800, inline: true, content: big },
          { filename: "riesig.zip", mime: "application/zip", size: 20 * 1024 * 1024, inline: false, content: big },
        ],
      }),
    }, { INBOX: { uids: [11] } });
    await syncAccount(acc({ folder_map: { inbox: "INBOX" } }), deps);
    expect(log.uploads).toEqual(["A1/M1/1-Layout V2.pdf"]);
    expect(log.atts.map((a) => [a.filename, a.storage_path !== null, a.is_ignored])).toEqual([
      ["Layout V2.pdf", true, false], ["sig.png", false, true], ["riesig.zip", false, false],
    ]);
    expect(log.msgs[0].has_attachments).toBe(true);
  });

  it("ohne Gesendet-Ordner nur Posteingang, mit Hinweis", async () => {
    const { deps } = fake({}, { INBOX: { uids: [11] } });
    const r = await syncAccount(acc({ folder_map: {} }), deps);
    expect(r.notes[0]).toMatch(/Gesendet/);
    expect(r.fetched).toBe(1);
  });
});
