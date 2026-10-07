import { describe, expect, it } from "vitest";
import { forwardBeleg, forwardText, isBelegFile, pickBelegFiles, type ForwardDeps, type ForwardMsg } from "./forward.ts";

const msg: ForwardMsg = { id: "M1", from_addr: "rechnung@lieferant.de", from_name: "Lieferant GmbH", subject: "Rechnung 4711", sent_at: "2026-10-05T08:00:00Z", body_text: "x", forwarded_at: null };
function deps(o: Partial<ForwardDeps> = {}) {
  const log = { mime: [] as any[], appended: 0, sent: [] as any[], marked: [] as any[] };
  const d: ForwardDeps = {
    address: "belege@lexware.example",
    loadMessage: async () => msg,
    loadFiles: async () => [{ filename: "R4711.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2]) }],
    buildMime: async (h) => { log.mime.push(h); return new Uint8Array([9]); },
    append: async () => { log.appended++; return 5; },
    send: async (raw, to) => { log.sent.push([raw.length, to]); },
    markForwarded: async (id, how) => { log.marked.push([id, how]); },
    ...o,
  };
  return { d, log };
}

describe("Versand (send)", () => {
  it("sendet an die Belegadresse, merkt sich die Weiterleitung, legt KEINEN Entwurf an", async () => {
    const t = deps();
    expect(await forwardBeleg("M1", t.d, "send")).toEqual({ files: 1, how: "gesendet", uid: null });
    expect(t.log.sent).toEqual([[1, "belege@lexware.example"]]);
    expect(t.log.mime[0]).toMatchObject({ to: "belege@lexware.example", subject: "Fwd: Rechnung 4711" });
    expect(t.log.mime[0].text).toContain("automatisch");
    expect(t.log.marked).toEqual([["M1", "gesendet"]]);
    expect(t.log.appended).toBe(0);
  });
  it("scheitert der Versand, entsteht stattdessen ein Entwurf (mit Grund)", async () => {
    const t = deps({ send: async () => { throw new Error("ETIMEDOUT smtp.ionos.de:465"); } });
    const r = await forwardBeleg("M1", t.d, "send");
    expect(r).toMatchObject({ how: "entwurf", uid: 5, fallbackReason: "ETIMEDOUT smtp.ionos.de:465" });
    expect(t.log.appended).toBe(1);
    expect(t.log.marked).toEqual([["M1", "entwurf"]]);
    expect(t.log.mime.at(-1).text).toContain("Entwurf");
  });
  it("ohne Versand-Einrichtung: Entwurf", async () => {
    const t = deps({ send: undefined });
    expect(await forwardBeleg("M1", t.d, "send")).toMatchObject({ how: "entwurf", fallbackReason: "Versand nicht eingerichtet" });
  });
  it("mode draft sendet nie", async () => {
    const t = deps();
    expect((await forwardBeleg("M1", t.d, "draft")).how).toBe("entwurf");
    expect(t.log.sent).toEqual([]);
  });
});

describe("Schutz", () => {
  it("nie doppelt: schon weitergeleitet -> Fehler, nichts wird gesendet", async () => {
    const t = deps({ loadMessage: async () => ({ ...msg, forwarded_at: "2026-10-06" }) });
    await expect(forwardBeleg("M1", t.d, "send")).rejects.toThrow(/schon weitergeleitet/);
    expect(t.log.sent).toEqual([]);
  });
  it("ungueltige Adresse, fehlende Mail, kein Beleg-Anhang -> nichts gesendet, nichts abgelegt", async () => {
    for (const [o, re] of [
      [{ address: "" }, /Belegadresse/], [{ address: "kaputt" }, /Belegadresse/],
      [{ loadMessage: async () => null }, /nicht gefunden/], [{ loadFiles: async () => [] }, /keinen gespeicherten Beleg-Anhang/],
    ] as const) {
      const t = deps(o as any);
      await expect(forwardBeleg("M1", t.d, "send")).rejects.toThrow(re);
      expect(t.log.sent).toEqual([]);
      expect(t.log.appended).toBe(0);
    }
  });
  it("Text nennt Absender, Betreff und Datum", () => {
    const t = forwardText(msg, false);
    expect(t).toContain("Lieferant GmbH <rechnung@lieferant.de>");
    expect(t).toContain("Rechnung 4711");
  });
});

describe("pickBelegFiles", () => {
  const r = (filename: string, mime: string, role: string | null = null) => ({ filename, mime, role });
  it("nur Dateien, die als Beleg taugen", () => {
    expect(isBelegFile(r("a.pdf", "application/octet-stream"))).toBe(true);
    expect(isBelegFile(r("scan", "image/jpeg"))).toBe(true);
    expect(isBelegFile(r("agb.docx", "application/vnd.ms-word"))).toBe(false);
    expect(pickBelegFiles([r("a.pdf", "application/pdf"), r("x.zip", "application/zip")]).map((x) => x.filename)).toEqual(["a.pdf"]);
  });
  it("gibt es Anhaenge mit Rolle „Rechnung“, gehen nur diese raus (nicht auch AGB/Flyer)", () => {
    const rows = [r("rechnung.pdf", "application/pdf", "rechnung"), r("flyer.pdf", "application/pdf", "sonstiges")];
    expect(pickBelegFiles(rows).map((x) => x.filename)).toEqual(["rechnung.pdf"]);
    expect(pickBelegFiles([r("a.pdf", "application/pdf", "sonstiges")])).toHaveLength(1);
  });
});
