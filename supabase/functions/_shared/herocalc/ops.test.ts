import { describe, expect, it } from "vitest";
import { applyCommand, sanitizePositions } from "./ops.ts";
import { recalcDraft } from "./calc.ts";
import { assertUnchanged, assertWritableDraft, draftHash } from "./guard.ts";
import { overview } from "./overview.ts";

const base = () => {
  const d: any = {
    id: 1, customer_document_id: 2, modified: "m1", status_code: 0, value: 0,
    data: { version: 3, totals: {}, items: [{ type: "table", items: [{ atType: "SupplyService", uid: "u1", quantity: 1, vat_percent: 19, positions: [
      { atType: "SupplyProduct", uid: "m1", id: "p1", quantity: 2, base_price: 15, net_price_per_unit: 30 },
      { atType: "WageGroup", id: 6824, quantity: 90, wage_cost_price: 22.4, wage_per_hour: 72 },
    ] }] }] },
  };
  recalcDraft(d);
  return d;
};

const findSales = (d: any) => d.data.items[0].items[0].sales;

describe("applyCommand", () => {
  it("set_wage_minutes 90 -> 60 liefert Vorher/Nachher und mutiert das Original nicht", () => {
    const d = base();
    const r = applyCommand(d, { cmd: "set_wage_minutes", position_uid: "u1", wage_group_id: "6824", minutes: 60 });
    expect(r.before.vk).toBe(168);
    expect(r.after.vk).toBe(132);
    expect(d.data.totals.net).toBe(168);
    expect(r.draft.value).toBe(132);
  });
  it("set_material mit neuem VK", () => {
    const r = applyCommand(base(), { cmd: "set_material", position_uid: "u1", product_id: "p1", quantity: 2, vk_per_unit: 40 });
    expect(r.after.vk).toBe(188);
  });
  it("set_discount in Prozent und als Betrag (live: 5 € auf 168 € -> 2.9762 %)", () => {
    const p = applyCommand(base(), { cmd: "set_discount", position_uid: "u1", percent: 10 });
    expect([p.after.vk, p.after.mwst]).toEqual([151.2, 28.73]);
    const a = applyCommand(base(), { cmd: "set_discount", position_uid: "u1", amount: 5 });
    expect(findSales(a.draft)).toBe(2.9762);
    expect(a.after).toEqual({ ek: 63.6, vk: 163, aufschlag_pct: 156.29, netto: 163, mwst: 30.97, brutto: 193.97 });
    const s = a.draft.data.items[0].items[0];
    expect([s.wage_costs, s.marge, s.net_price_per_unit]).toEqual([104.79, 156.29, 168]);
    expect(a.draft.data.items[0].totalSales).toBe(5);
    expect(a.draft.data.items[0].totalWageVat).toBe(19.91);
    expect(a.draft.data.totals.material).toBe(58.21);
  });
  it("set_discount: ungültige Eingaben", () => {
    expect(() => applyCommand(base(), { cmd: "set_discount", position_uid: "u1" })).toThrow(/genau eines/);
    expect(() => applyCommand(base(), { cmd: "set_discount", position_uid: "u1", percent: 5, amount: 5 })).toThrow(/genau eines/);
    expect(() => applyCommand(base(), { cmd: "set_discount", position_uid: "u1", amount: 500 })).toThrow(/kleiner/);
    expect(() => applyCommand(base(), { cmd: "set_discount", position_uid: "u1", percent: 100 })).toThrow(/unter 100/);
  });
  it("Rabatt wieder auf 0 setzen stellt den Preis her", () => {
    const d = applyCommand(base(), { cmd: "set_discount", position_uid: "u1", percent: 10 }).draft;
    expect(applyCommand(d, { cmd: "set_discount", position_uid: "u1", percent: 0 }).after.vk).toBe(168);
  });
  it("set_quantity 2 verdoppelt Summen, 1 stellt zurück; Rabatt+Menge abgelehnt", () => {
    const r = applyCommand(base(), { cmd: "set_quantity", position_uid: "u1", quantity: 2 });
    expect([r.before.vk, r.after.vk, r.after.ek, r.draft.value]).toEqual([168, 336, 127.2, 336]);
    expect(applyCommand(r.draft, { cmd: "set_quantity", position_uid: "u1", quantity: 1 }).after.vk).toBe(168);
    // Rabatt bei Menge > 1 ist live belegt (Rabatt auf die Gesamtsumme): 168 * 2 = 336, 10 % = 33,60 -> 302,40
    const rq = applyCommand(r.draft, { cmd: "set_discount", position_uid: "u1", percent: 10 });
    expect([rq.after.vk, rq.draft.data.totals.sales]).toEqual([302.4, 33.6]);
    expect(() => applyCommand(base(), { cmd: "set_quantity", position_uid: "u1", quantity: 0 })).toThrow(/größer als 0/);
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
  it("Konflikt bei geändertem modified/version", async () => {
    const a = base();
    await expect(assertUnchanged(a, structuredClone(a))).resolves.toBeUndefined();
    await expect(assertUnchanged(a, { ...a, modified: "m2" })).rejects.toThrow(/geändert/);
    await expect(assertUnchanged(a, { ...a, data: { ...a.data, version: 4 } })).rejects.toThrow(/geändert/);
  });
  it("Konflikt auch ohne Änderung von modified/version (Hash)", async () => {
    const a = base();
    const b = structuredClone(a);
    b.data.items[0].items[0].positions[1].quantity = 91;
    await expect(assertUnchanged(a, b)).rejects.toThrow(/geändert/);
    expect(await draftHash(a)).toBe(await draftHash(structuredClone(a)));
    expect(await draftHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("mehrere Leistungen sind freigegeben: Summen addieren sich über beide Leistungen", () => {
    const two = base();
    const second = structuredClone(two.data.items[0].items[0]);
    second.uid = "u2";
    two.data.items[0].items.push(second);
    recalcDraft(two);
    const r = applyCommand(two, { cmd: "set_quantity", position_uid: "u1", quantity: 2 });
    expect([r.before.vk, r.after.vk]).toEqual([336, 504]);
    expect(r.draft.data.items[0].totals.net).toBe(504);
    expect(r.draft.data.items[0].items[1].quantity).toBe(1);
  });
  it("Festpreis (is_fixed_net_price) wird beim Schreiben abgelehnt", () => {
    const fixed = base();
    fixed.data.items[0].items[0].is_fixed_net_price = true;
    expect(() => applyCommand(fixed, { cmd: "set_quantity", position_uid: "u1", quantity: 2 })).toThrow(/Festpreis/);
    expect(() => applyCommand(fixed, { cmd: "recalc" })).toThrow(/Festpreis/);
  });
  it("eigener Preis (is_custom_price) ist freigegeben: 100 + 50,50, Menge 2, Rabatt 10 % -> Netto 270,90", () => {
    const d = base();
    const s = d.data.items[0].items[0];
    Object.assign(s, { is_custom_price: true, custom_material_price: 100, custom_wage_price: 50.5, quantity: 2, sales: 10 });
    const r = applyCommand(d, { cmd: "recalc" });
    expect([r.after.vk, r.after.netto]).toEqual([270.9, 270.9]);
    expect(r.draft.data.totals.sales).toBe(30.1);
    expect(r.draft.data.totals.material).toBe(180);
    expect(r.draft.data.totals.wage).toBe(90.9);
    expect(r.draft.data.items[0].items[0].net_price_per_unit).toBe(150.5);
    expect(r.draft.value).toBe(270.9);
    // EK bleibt aus den Zeilen (Material 2 x 15 + Lohn 90 min), nur der VK ist überschrieben
    expect(r.after.ek).toBe(127.2);
  });
  it("eigener Preis ohne gültige custom-Felder wird abgelehnt", () => {
    const d = base();
    Object.assign(d.data.items[0].items[0], { is_custom_price: true, custom_material_price: 100 });
    expect(() => applyCommand(d, { cmd: "recalc" })).toThrow(/eigener Preis/);
  });
});

describe("Bereinigung beim Schreiben (sanitizePositions)", () => {
  it("attributes null/fehlend und file_upload_uuid \"\" werden auf die Standardform gesetzt", () => {
    const d = base();
    const [m1] = d.data.items[0].items[0].positions;
    m1.attributes = null;
    m1.file_upload_uuid = "";
    const r = applyCommand(d, { cmd: "recalc" });
    const m = r.draft.data.items[0].items[0].positions[0];
    expect(m.attributes).toEqual({
      stock: { count: null, status: null, description: null },
      measurement: { width: null, amount: null, height: null, length: null },
    });
    expect(m.file_upload_uuid).toBeNull();
    // Original bleibt unverändert, Lohnzeile wird nicht angefasst
    expect(d.data.items[0].items[0].positions[0].attributes).toBeNull();
    expect("attributes" in r.draft.data.items[0].items[0].positions[1]).toBe(false);
  });
  it("vorhandene gültige attributes und file_upload_uuid bleiben", () => {
    const d = base();
    const m1 = d.data.items[0].items[0].positions[0];
    m1.attributes = { stock: { count: 3 } };
    m1.file_upload_uuid = "abc";
    const m = applyCommand(d, { cmd: "recalc" }).draft.data.items[0].items[0].positions[0];
    expect(m.attributes).toEqual({ stock: { count: 3 } });
    expect(m.file_upload_uuid).toBe("abc");
  });
  it("sanitizePositions zählt Korrekturen und ist idempotent", () => {
    const d = base();
    d.data.items[0].items[0].positions[0].attributes = null;
    d.data.items[0].items[0].positions[0].file_upload_uuid = "";
    expect(sanitizePositions(d)).toBe(2);
    expect(sanitizePositions(d)).toBe(0);
  });
});

describe("overview", () => {
  it("kompakte Übersicht ohne vollen Draft", () => {
    const o = overview(base());
    expect(o.summary.vk).toBe(168);
    expect(o.tables[0].services[0].positions.map((x: any) => x.atType)).toEqual(["SupplyProduct", "WageGroup"]);
    expect(JSON.stringify(o).length).toBeLessThan(2000);
  });
});
