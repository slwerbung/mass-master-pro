import { describe, expect, it } from "vitest";
import { type AccountRow, type MessageInsert, type SyncDeps, type SyncStore, STUCK_SKIP, SYNC_LIMIT, syncAccount } from "./sync.ts";
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
  const log = { threads: [] as any[], msgs: [] as MessageInsert[], atts: [] as any[], uploads: [] as string[], cursors: [] as any[], touched: [] as any[], fetchCalls: [] as any[], stuck: [] as any[] };
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
    async markStuck(_id, m) { log.stuck.push(m); },
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
        if (o.skipFirst) {
          return { state: { uidValidity: f.validity ?? "7", uidNext: 99, exists: f.uids.length }, baseline: 98, messages: [], more: true, skipped: take[0] ?? null };
        }
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
    // Ohne current_uid kann der Assistent die Mail spaeter nicht verschieben.
    expect(log.msgs.map((m) => [m.current_folder, m.current_uid])).toEqual([["INBOX", 11], ["INBOX", 12], ["Sent", 6]]);
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

  it("speichert jeden Anhang (auch ausgeblendete Signaturbilder), laesst Uebergrosses ohne Datei", async () => {
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
    expect(log.uploads).toEqual(["A1/M1/1-Layout V2.pdf", "A1/M1/2-sig.png"]);
    expect(log.atts.map((a) => [a.filename, a.storage_path !== null, a.is_ignored])).toEqual([
      ["Layout V2.pdf", true, false], ["sig.png", true, true], ["riesig.zip", false, false],
    ]);
    expect(log.msgs[0].has_attachments).toBe(true);
  });

  it("Umlaute im Dateinamen: Speicherschluessel nur ASCII; ein fehlgeschlagener Upload nimmt die anderen nicht mit", async () => {
    const big = new Uint8Array(10);
    const { deps, log } = fake({
      11: mail({
        attachments: [
          { filename: "Auftragsbestätigung Größe.pdf", mime: "application/pdf", size: 200_000, inline: false, content: big },
          { filename: "kaputt.pdf", mime: "application/pdf", size: 200_000, inline: false, content: big },
          { filename: "Foto.jpg", mime: "image/jpeg", size: 200_000, inline: false, content: big },
        ],
      }),
    }, { INBOX: { uids: [11] } });
    const up = deps.store.uploadAttachment;
    deps.store.uploadAttachment = async (p, b, m) => {
      if (p.includes("kaputt")) throw new Error("Anhang-Upload: Invalid key");
      return up(p, b, m);
    };
    const sum = await syncAccount(acc({ folder_map: { inbox: "INBOX" } }), deps);
    expect(log.uploads).toEqual(["A1/M1/1-Auftragsbestaetigung Groesse.pdf", "A1/M1/3-Foto.jpg"]);
    expect(log.atts.map((a) => [a.filename, a.storage_path !== null])).toEqual([
      ["Auftragsbestätigung Größe.pdf", true], ["kaputt.pdf", false], ["Foto.jpg", true],
    ]);
    expect(sum.errors).toBe(1);
    expect(sum.notes.join(" ")).toMatch(/kaputt\.pdf/);
  });

  it("ohne Gesendet-Ordner nur Posteingang, mit Hinweis", async () => {
    const { deps } = fake({}, { INBOX: { uids: [11] } });
    const r = await syncAccount(acc({ folder_map: {} }), deps);
    expect(r.notes[0]).toMatch(/Gesendet/);
    expect(r.fetched).toBe(1);
  });

  describe("Postfach haengt an einer Mail (harter Abbruch)", () => {
    it("normaler Lauf: Markierung setzen und am Ende loeschen", async () => {
      const { deps, log } = fake({}, { INBOX: { uids: [11] }, Sent: { uids: [], validity: "9" } });
      await syncAccount(acc(), deps);
      expect(log.stuck).toEqual([{ key: "INBOX#7#10", tries: 1 }, { key: "Sent#9#5", tries: 1 }, null]);
    });

    it("auch ein normaler Fehler loescht die Markierung (zaehlt nicht als Abbruch)", async () => {
      const { deps, log } = fake({}, { INBOX: { uids: [11] } });
      deps.imap.fetchNew = async () => { throw new Error("Netz weg"); };
      await expect(syncAccount(acc(), deps)).rejects.toThrow("Netz weg");
      expect(log.stuck.at(-1)).toBeNull();
    });

    it("2. Versuch an derselben Stelle holt nur eine Mail", async () => {
      const { deps, log } = fake({}, { INBOX: { uids: [11, 12, 13] }, Sent: { uids: [], validity: "9" } });
      await syncAccount(acc({ sync_stuck: { key: "INBOX#7#10", tries: 1 } }), deps);
      expect(log.fetchCalls[0]).toMatchObject({ folder: "INBOX", limit: 1 });
      expect(log.msgs.map((m) => m.uid)).toEqual([11]);
    });

    it("ab dem 3. Versuch wird die Mail uebersprungen und der Cursor weitergeschoben", async () => {
      const { deps, log } = fake({}, { INBOX: { uids: [11, 12] }, Sent: { uids: [], validity: "9" } });
      const r = await syncAccount(acc({ sync_stuck: { key: "INBOX#7#10", tries: STUCK_SKIP - 1 } }), deps);
      expect(log.msgs).toEqual([]);
      expect(log.cursors[0]).toEqual({ id: "A1", inbox_last_uid: 11 });
      expect(r.errors).toBe(1);
      expect(r.notes.join(" ")).toMatch(/UID 11 in INBOX übersprungen/);
      expect(log.stuck.at(-1)).toBeNull();
    });

    it("andere Stelle (Fortschritt gemacht) = neuer Zaehler", async () => {
      const { deps, log } = fake({}, { INBOX: { uids: [13] }, Sent: { uids: [], validity: "9" } });
      await syncAccount(acc({ inbox_last_uid: 12, sync_stuck: { key: "INBOX#7#10", tries: 5 } }), deps);
      expect(log.stuck[0]).toEqual({ key: "INBOX#7#12", tries: 1 });
      expect(log.msgs.map((m) => m.uid)).toEqual([13]);
    });
  });

  it("grosse Mail: Anhaenge kommen einzeln ueber fetchPart, zu grosse nur als Zeile ohne Datei", async () => {
    const { deps, log } = fake({}, { INBOX: { uids: [11] }, Sent: { uids: [], validity: "9" } });
    const orig = deps.imap.fetchNew;
    deps.imap.fetchNew = async (folder, o) => {
      const r = await orig(folder, o);
      r.messages = r.messages.map((m) => ({ ...m, parts: [
        { key: "1.2", filename: "anhang", mime: "image/jpeg", encoding: "base64", size: 18000, inline: true },
        { key: "2", filename: "Plan.pdf", mime: "application/pdf", encoding: "base64", size: 9_000_000, inline: false },
        { key: "3", filename: "riesig.zip", mime: "application/zip", encoding: "base64", size: 30 * 1024 * 1024, inline: false },
      ] }));
      return r;
    };
    const fetched: string[] = [];
    deps.imap.fetchPart = async (folder, uid, ref) => { fetched.push(`${folder}/${uid}/${ref.key}`); return new Uint8Array(ref.key === "2" ? 9_000_000 : 18000); };
    const r = await syncAccount(acc(), deps);
    expect(r.errors).toBe(0);
    expect(fetched).toEqual(["INBOX/11/1.2", "INBOX/11/2"]);
    expect(log.msgs[0].has_attachments).toBe(true);
    expect(log.atts.map((a) => [a.filename, a.storage_path, a.is_ignored])).toEqual([
      ["anhang", "A1/M1/1-anhang", true],
      ["Plan.pdf", "A1/M1/2-Plan.pdf", false],
      ["riesig.zip", null, false],
    ]);
  });

  it("grosse Mail: scheitert ein Teil, bleibt die Zeile ohne Datei und der Fehler wird gemeldet", async () => {
    const { deps, log } = fake({}, { INBOX: { uids: [11] }, Sent: { uids: [], validity: "9" } });
    const orig = deps.imap.fetchNew;
    deps.imap.fetchNew = async (folder, o) => {
      const r = await orig(folder, o);
      r.messages = r.messages.map((m) => ({ ...m, parts: [{ key: "2", filename: "Plan.pdf", mime: "application/pdf", encoding: "base64", size: 100, inline: false }] }));
      return r;
    };
    deps.imap.fetchPart = async () => { throw new Error("Verbindung weg"); };
    const r = await syncAccount(acc(), deps);
    expect(r.errors).toBe(1);
    expect(r.notes[0]).toContain("Plan.pdf: Verbindung weg");
    expect(log.atts).toEqual([expect.objectContaining({ filename: "Plan.pdf", storage_path: null })]);
  });
});
