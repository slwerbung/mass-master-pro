// Tests mit echten HERO-Werten (live gelesen am 26.11.2026). Rechenregeln nicht ändern, nur gegen HERO prüfen.
import { describe, expect, it } from "vitest";
import { recalcDraft, round2 } from "./calc.ts";
import { applyCommand } from "./ops.ts";

// Dokument 22631222: eine Leistung, 10 Materialzeilen (eine mit Menge 1, neun mit Menge 1,2012).
const LIVE = [
  ["FVObbDQDYAA", 1, 12.5, 25], ["FVOWjnCzQAA", 1.2012, 2.9, 5.8], ["FVOaahuFcAA", 1.2012, 2.8, 5.6],
  ["FVO1AR_TIAA", 1.2012, 0.15, 0.3], ["FVO1MYsgIAA", 1.2012, 0.2, 0.4], ["FVO2c-HGIAA", 1.2012, 2.5, 5],
  ["FVOzMLuwcAA", 1.2012, 12.5, 25], ["FVOSLPiAkAA", 1.2012, 32.65, 65.3], ["FVOSfMiAkAA", 1.2012, 3.95, 15.8],
  ["FVOSQwYAkAA", 1.2012, 3.35, 13.4],
] as const;

const liveDraft = (): any => ({
  id: 1, customer_document_id: 22631222, modified: "t", status_code: 0, value: 189.1,
  data: {
    version: 1, total_price: 189.1, total_vat: 35.93, totals: {},
    items: [{ type: "table", items: [{
      atType: "SupplyService", uid: "kni4uujt", quantity: 1, vat_percent: 19, sales: 0,
      positions: LIVE.map(([id, quantity, base_price, net_price_per_unit]) => ({
        atType: "SupplyProduct", uid: id, id, quantity, base_price, net_price_per_unit, file_upload_uuid: null,
        attributes: { stock: { count: null, status: null, description: null }, measurement: { width: null, amount: null, height: null, length: null } },
      })),
    }] }],
  },
});

describe("echte HERO-Werte", () => {
  it("MwSt-Rundung: 49,50 -> 9,41 (9.405 rundet auf 9.41)", () => {
    expect(round2(9.405)).toBe(9.41);
    const d: any = { data: { totals: {}, items: [{ type: "table", items: [{ atType: "SupplyService", uid: "a", quantity: 1, vat_percent: 19,
      positions: [{ atType: "SupplyProduct", id: "x", quantity: 1, base_price: 20, net_price_per_unit: 49.5 }] }] }] } };
    const r = recalcDraft(d);
    expect([r.netto, r.mwst, r.brutto]).toEqual([49.5, 9.41, 58.91]);
  });

  it("22631222: Menge 1,2012 -> EK 85,7732 / Aufschlag 120,47 / Netto 189,10 / MwSt 35,93 / Brutto 225,03", () => {
    const d = liveDraft();
    expect(recalcDraft(d)).toEqual({ ek: 85.7732, vk: 189.1, aufschlag_pct: 120.47, netto: 189.1, mwst: 35.93, brutto: 225.03 });
    const s = d.data.items[0].items[0];
    expect([s.base_price, s.net_price_per_unit, s.marge]).toEqual([85.7732, 189.1, 120.47]);
    expect(d.data.totals).toMatchObject({ base: 85.7732, net: 189.1, material: 189.1, material_base: 85.7732, vat: 35.929 });
    expect(d.data.items[0].totals).toEqual(d.data.totals);
    expect(d.value).toBe(189.1);
  });

  it("recalc ändert einen fertig berechneten Entwurf nicht (Idempotenz)", () => {
    const d = liveDraft();
    recalcDraft(d);
    const before = JSON.stringify(d);
    const r = applyCommand(d, { cmd: "recalc" });
    expect(JSON.stringify(r.draft)).toBe(before);
    expect(r.before).toEqual(r.after);
    expect(JSON.stringify(applyCommand(r.draft, { cmd: "recalc" }).draft)).toBe(before);
  });
});
