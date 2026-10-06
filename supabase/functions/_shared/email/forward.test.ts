import { describe, expect, it } from "vitest";
import { forwardBelegDraft, forwardText, type ForwardDeps } from "./forward.ts";

const msg = { id: "M1", from_addr: "rechnung@lieferant.de", from_name: "Lieferant GmbH", subject: "Rechnung 4711", sent_at: "2026-10-05T08:00:00Z", body_text: "x" };
function deps(o: Partial<ForwardDeps> = {}) {
  const log = { mime: [] as any[], appended: 0 };
  const d: ForwardDeps = {
    address: "belege@lexoffice.example",
    loadMessage: async () => msg,
    loadFiles: async () => [{ filename: "R4711.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2]) }],
    buildMime: async (h) => { log.mime.push(h); return new Uint8Array([9]); },
    append: async () => { log.appended++; return 5; },
    ...o,
  };
  return { d, log };
}

describe("forwardBelegDraft", () => {
  it("baut einen Entwurf an die Belegadresse mit allen Anhaengen und legt ihn ab – ohne zu senden", async () => {
    const t = deps();
    expect(await forwardBelegDraft("M1", t.d)).toEqual({ files: 1, uid: 5 });
    expect(t.log.mime[0]).toMatchObject({ to: "belege@lexoffice.example", subject: "Fwd: Rechnung 4711" });
    expect(t.log.mime[0].files).toHaveLength(1);
    expect(t.log.appended).toBe(1);
  });
  it("lehnt fehlende/ungueltige Adresse, fehlende Mail und fehlende Anhaenge ab – ohne etwas abzulegen", async () => {
    for (const [o, re] of [
      [{ address: "" }, /Belegadresse/], [{ address: "kaputt" }, /Belegadresse/],
      [{ loadMessage: async () => null }, /nicht gefunden/], [{ loadFiles: async () => [] }, /keinen gespeicherten Anhang/],
    ] as const) {
      const t = deps(o as any);
      await expect(forwardBelegDraft("M1", t.d)).rejects.toThrow(re);
      expect(t.log.appended).toBe(0);
    }
  });
  it("Text nennt Absender, Betreff und Datum", () => {
    const t = forwardText(msg);
    expect(t).toContain("Lieferant GmbH <rechnung@lieferant.de>");
    expect(t).toContain("Rechnung 4711");
  });
});
