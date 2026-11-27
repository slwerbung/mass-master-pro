import { describe, expect, it } from "vitest";
import { fakeDb } from "./testdb.ts";
import { AbError, createAb, prepareAb, type AbDeps } from "./abCreate.ts";

// Aufbau wie `published_customer_document_draft.data` echter HERO-Dokumente (siehe confirmation.test.ts)
const draft = (items: { uid: string; name: string; qty: number; price: number }[]) => ({
  items: [{ uid: "t1", type: "table", items: items.map((i, index) => ({ uid: i.uid, type: "product", atType: "SupplyService", id: String(index + 1), name: i.name, quantity: i.qty, unit_type: "Stk", net_price_per_unit: i.price, vat_percent: 19 })) }],
});
const offerDoc = (id: number, status = 200, items = [{ uid: "u1", name: "Banner", qty: 2, price: 100 }, { uid: "u2", name: "Montage", qty: 1, price: 50 }]) =>
  ({ id, nr: `AN-${id}`, date: "2026-11-01", statusCode: status, statusName: status >= 100 ? "Versendet" : "Entwurf", value: null, projectId: 100, projectNr: "WER-1", baseType: "offer", fileUuid: null, draft: draft(items) });

const world = () => fakeDb({
  project_cards: [{ id: "c1", hero_id: 100, rule_key: "ab_fehlt", state: "open", locked_until: null, locked_by: null }], project_actions_log: [],
});
function deps(over: Partial<AbDeps> & { offers?: any[]; failCreate?: boolean } = {}) {
  const calls: any = { created: [], logbook: [] };
  const d: AbDeps = {
    sb: over.sb ?? world(), confirmationTypeId: 7, shadow: false, user: "Julian", now: new Date("2026-11-27T08:00:00Z"),
    hero: {
      offers: async () => over.offers ?? [offerDoc(5)], confirmations: async () => [],
      createDocument: async (p, t, actions) => { if (over.failCreate) throw new Error("HTTP 500"); calls.created.push({ p, t, actions }); return { id: 900, nr: "AB-1" }; },
      addLogbook: async (_p, text) => { calls.logbook.push(text); },
    },
    ...over,
  } as AbDeps;
  return { d, calls };
}
describe("AB aus Angebot in der App", () => {
  it("Vorschau: neuestes abgeschlossenes Angebot mit Positionen, Entwuerfe zaehlen nicht", async () => {
    const { d } = deps({ offers: [offerDoc(9, 10), offerDoc(5)] });
    const p = await prepareAb(d, 100);
    expect(p.offer).toMatchObject({ id: 5, nr: "AN-5" });
    expect(p.positions).toHaveLength(2);
    expect(p.configured).toBe(true);
  });
  it("legt den Entwurf an, schreibt Logbuch und schliesst die Karte", async () => {
    const { d, calls } = deps();
    const r = await createAb(d, 100, undefined);
    expect(r).toMatchObject({ ok: true, shadow: false, documentId: 900, documentNr: "AB-1", positions: 2 });
    expect(calls.created[0]).toMatchObject({ p: 100, t: 7 });
    expect(calls.logbook[0]).toContain("AB-1");
    expect((await d.sb.from("project_cards").select("*").eq("id", "c1")).data[0]).toMatchObject({ state: "done", close_reason: "AB-Entwurf in der App angelegt" });
    expect((await d.sb.from("project_actions_log").select("*")).data[0]).toMatchObject({ action: "create_ab", shadow: false });
  });
  it("Auswahl und Menge kommen vom Client, Namen und Preise nie", async () => {
    const { d, calls } = deps();
    const r = await createAb(d, 100, [{ sourceDocId: 5, uid: "u1", quantity: 3, include: true, name: "GEFAELSCHT", netPrice: 1 }, { sourceDocId: 5, uid: "u2", include: false }]);
    expect(r.positions).toBe(1);
    const copy = JSON.stringify(calls.created[0].actions);
    expect(copy).toContain("u1");
    expect(copy).not.toContain("GEFAELSCHT");
    expect(copy).not.toContain("u2");
    expect(copy).toContain("\"quantity\":3");
  });
  it("Schattenmodus: nichts nach HERO, Karte bleibt, nur Protokoll", async () => {
    const { d, calls } = deps({ shadow: true });
    const r = await createAb(d, 100, undefined);
    expect(r).toMatchObject({ shadow: true, documentId: null });
    expect(calls.created).toHaveLength(0);
    expect((await d.sb.from("project_cards").select("*").eq("id", "c1")).data[0].state).toBe("open");
    expect((await d.sb.from("project_actions_log").select("*")).data[0]).toMatchObject({ shadow: true });
  });
  it("Fehler: kein Angebot, kein Dokumenttyp, nichts gewaehlt, HERO scheitert", async () => {
    await expect(createAb(deps({ offers: [offerDoc(9, 10)] }).d, 100, undefined)).rejects.toThrow(AbError);
    await expect(createAb(deps({ confirmationTypeId: null }).d, 100, undefined)).rejects.toThrow("nicht eingerichtet");
    await expect(createAb(deps().d, 100, [{ sourceDocId: 5, uid: "u1", include: false }, { sourceDocId: 5, uid: "u2", include: false }])).rejects.toThrow("Keine Position");
    const { d } = deps({ failCreate: true });
    await expect(createAb(d, 100, undefined)).rejects.toThrow();
    expect((await d.sb.from("project_cards").select("*").eq("id", "c1")).data[0].state).toBe("open");
  });
});
