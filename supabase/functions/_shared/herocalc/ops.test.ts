import { describe, expect, it } from "vitest";
import { applyCommand } from "./ops.ts";
import { recalcDraft } from "./calc.ts";
import { assertUnchanged, assertWritableDraft } from "./guard.ts";

const base = () => {
  const d: any = {
    id: 1, customer_document_id: 2, version: 3, modified: "m1", status_code: 0,
    data: { totals: {}, items: [{ type: "table", items: [{ atType: "SupplyService", uid: "u1", quantity: 1, vat_percent: 19, positions: [
      { atType: "SupplyProduct", id: "p1", quantity: 2, base_price: 15, net_price_per_unit: 30 },
      { atType: "WageGroup", id: 6824, quantity: 90, wage_cost_price: 22.4, wage_per_hour: 72 },
    ] }] }] },
  };
  recalcDraft(d);
  return d;
};

describe("applyCommand", () => {
  it("set_wage_minutes 90 -> 60 liefert Vorher/Nachher und mutiert das Original nicht", () => {
    const d = base();
    const r = applyCommand(d, { cmd: "set_wage_minutes", position_uid: "u1", wage_group_id: "6824", minutes: 60 });
    expect(r.before.vk).toBe(168);
    expect(r.after.vk).toBe(132);
    expect(d.data.totals.net).toBe(168);
  });
  it("set_material mit neuem VK", () => {
    const r = applyCommand(base(), { cmd: "set_material", position_uid: "u1", product_id: "p1", quantity: 2, vk_per_unit: 40 });
    expect(r.after.vk).toBe(188);
  });
  it("remove_position / add_position", () => {
    const r = applyCommand(base(), { cmd: "remove_position", position_uid: "u1", atType: "WageGroup", id: 6824 });
    expect(r.after.vk).toBe(60);
    expect(() => applyCommand(base(), { cmd: "add_position", position_uid: "u1", position: { atType: "SupplyProduct", id: "x" } })).toThrow(/unvollständig/);
  });
  it("Fehler bei unbekannter Leistung/Position und ungültigen Minuten", () => {
    expect(() => applyCommand(base(), { cmd: "set_wage_minutes", position_uid: "nope", wage_group_id: 1, minutes: 1 })).toThrow(/nicht gefunden/);
    expect(() => applyCommand(base(), { cmd: "set_wage_minutes", position_uid: "u1", wage_group_id: 1, minutes: 1 })).toThrow(/nicht gefunden/);
    expect(() => applyCommand(base(), { cmd: "set_wage_minutes", position_uid: "u1", wage_group_id: 6824, minutes: -5 })).toThrow(/Zahl/);
  });
});

describe("guard", () => {
  it("nur Entwürfe", () => {
    const d = base();
    expect(() => assertWritableDraft(d)).not.toThrow();
    d.status_code = 1;
    expect(() => assertWritableDraft(d)).toThrow(/Kein Entwurf/);
  });
  it("Struktur", () => {
    const d = base();
    delete d.data.totals;
    expect(() => assertWritableDraft(d)).toThrow(/totals/);
  });
  it("Konflikt bei geändertem modified/version", () => {
    const a = base();
    expect(() => assertUnchanged(a, { ...a })).not.toThrow();
    expect(() => assertUnchanged(a, { ...a, modified: "m2" })).toThrow(/geändert/);
    expect(() => assertUnchanged(a, { ...a, version: 4 })).toThrow(/geändert/);
  });
});
