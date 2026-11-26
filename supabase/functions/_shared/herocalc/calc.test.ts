import { describe, expect, it } from "vitest";
import { recalcDraft, round2 } from "./calc.ts";

const material = (q = 2) => ({ atType: "SupplyProduct", id: 1, quantity: q, base_price: 15, net_price_per_unit: 30 });
const wage = (min: number) => ({ atType: "WageGroup", id: 6824, quantity: min, wage_cost_price: 22.4, wage_per_hour: 72 });
const draft = (positions: any[]) => ({
  data: { totals: {}, items: [{ type: "table", items: [{ atType: "SupplyService", uid: "u1", quantity: 1, vat_percent: 19, positions }] }] },
});

describe("recalcDraft (Spec 2.4)", () => {
  it("Basis: Material + 60 min -> 132,00 netto", () => {
    expect(recalcDraft(draft([material(), wage(60)])).vk).toBe(132);
  });
  it("Belegtes Beispiel 90 min", () => {
    const d = draft([material(), wage(90)]);
    expect(recalcDraft(d)).toEqual({ ek: 63.6, vk: 168, aufschlag_pct: 164.15, netto: 168, mwst: 31.92, brutto: 199.92 });
    const s = d.data.items[0].items[0] as any;
    expect([s.time_minutes, s.wage_costs, s.wage_base]).toEqual([90, 108, 33.6]);
    expect((d.data.items[0] as any).total["19"]).toBe(168);
  });
  it("Nur Material", () => {
    expect(recalcDraft(draft([material()]))).toEqual({ ek: 30, vk: 60, aufschlag_pct: 100, netto: 60, mwst: 11.4, brutto: 71.4 });
  });
  it("Nur Lohn", () => {
    const r = recalcDraft(draft([wage(60)]));
    expect([r.vk, r.ek, r.aufschlag_pct]).toEqual([72, 22.4, 221.43]);
  });
  it("Minutenpreise der Lohnzeile", () => {
    const w: any = wage(90);
    recalcDraft(draft([w]));
    expect(w.base_price).toBe(0.3733);
    expect(w.net_price_per_unit).toBe(1.2);
  });
  it("idempotent, Rundungsrauschen", () => {
    const d = draft([material(3), wage(45)]);
    const a = JSON.stringify(recalcDraft(d));
    expect(JSON.stringify(recalcDraft(d))).toBe(a);
    expect(round2(29.999999999999996)).toBe(30);
  });
  it("Menge 2 (live: 168 -> 336, Einheitswerte bleiben)", () => {
    const d = draft([material(), wage(90)]);
    (d.data.items[0].items[0] as any).quantity = 2;
    expect(recalcDraft(d)).toEqual({ ek: 127.2, vk: 336, aufschlag_pct: 164.15, netto: 336, mwst: 63.84, brutto: 399.84 });
    const s = d.data.items[0].items[0] as any;
    expect([s.net_price_per_unit, s.base_price, s.wage_costs, s.wage_base, s.time_minutes, s.marge]).toEqual([168, 63.6, 108, 33.6, 90, 164.15]);
    const t = d.data.items[0] as any;
    expect([t.total_sum, t.totalTime, t.totalBasePrice, t.totalWageCosts, t.totalWageVat]).toEqual([336, 180, 127.2, 216, 41.04]);
    const totals = (d.data as any).totals;
    expect([totals.time, totals.wage, totals.wage_base, totals.material, totals.material_base]).toEqual([180, 216, 67.2, 120, 60]);
  });
  it("Menge ungültig oder zusammen mit Rabatt wird abgelehnt (ungetestet)", () => {
    const d = draft([material()]);
    (d.data.items[0].items[0] as any).quantity = 0;
    expect(() => recalcDraft(d)).toThrow(/ungültig/);
    (d.data.items[0].items[0] as any).quantity = 2;
    (d.data.items[0].items[0] as any).sales = 5;
    expect(() => recalcDraft(d)).toThrow(/Rabatt bei quantity/);
  });
  it("Positionsrabatt 10 % (live: 168 -> 151,20)", () => {
    const d = draft([material(), wage(90)]);
    (d.data.items[0].items[0] as any).sales = 10;
    expect(recalcDraft(d)).toEqual({ ek: 63.6, vk: 151.2, aufschlag_pct: 137.74, netto: 151.2, mwst: 28.73, brutto: 179.93 });
    const s = d.data.items[0].items[0] as any;
    expect([s.net_price_per_unit, s.marge, s.wage_costs, s.wage_base]).toEqual([168, 137.74, 97.2, 33.6]);
    const t = d.data.items[0] as any;
    expect([t.total_sum, t.totalSales, t.totalWageCosts, t.totalWageVat]).toEqual([151.2, 16.8, 97.2, 18.47]);
    const totals = (d.data as any).totals;
    expect([totals.sales, totals.material, totals.wage, totals.vat]).toEqual([16.8, 54, 97.2, 28.728]);
    expect((d.data as any).total_price).toBe(151.2);
    expect((d.data as any).total_vat).toBe(28.73);
  });
});
