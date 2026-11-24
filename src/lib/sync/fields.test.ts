import { describe, it, expect } from "vitest";
import { diffForPush, locationFieldsFromLocal, locationFieldsFromRow, mergeIncoming, mergeMarkers, applyLocationFields } from "./fields";

describe("Sync v2 – Felder", () => {
  it("leere Werte sind gleich (undefined, null, \"\")", () => {
    expect(diffForPush({ comment: "" }, { comment: null })).toEqual({});
    expect(diffForPush({ comment: "x" }, { comment: null })).toEqual({ comment: { base: null, value: "x" } });
  });

  it("lokal und online in IndexedDB-/Zeilenform ergeben dieselben Felder", () => {
    const local = { locationNumber: "3", comment: "a", customFields: JSON.stringify({ custom_x: "1" }), areaMeasurements: JSON.stringify([{ index: 1, widthMm: 2, heightMm: 3 }]) };
    const row = { location_number: "3", comment: "a", label: "", custom_fields: { custom_x: "1", __areaMeasurements: [{ index: 1, widthMm: 2, heightMm: 3 }] } };
    expect(diffForPush(locationFieldsFromLocal(local), locationFieldsFromRow(row))).toEqual({});
  });

  it("applyLocationFields trennt Flaechenmasse von Zusatzfeldern", () => {
    const rec = applyLocationFields({ id: "l" }, { location_number: "1", "cf.custom_a": "x", "cf.__areaMeasurements": [{ index: 1, widthMm: 1, heightMm: 1 }] });
    expect(JSON.parse(rec.customFields)).toEqual({ custom_a: "x" });
    expect(JSON.parse(rec.areaMeasurements)).toEqual([{ index: 1, widthMm: 1, heightMm: 1 }]);
  });

  it("Dreiwege-Abgleich: hier geaendert bleibt, dort geaendert kommt, beides = Konflikt", () => {
    const base = { comment: "a", label: "b", system: "c" };
    const local = { comment: "A", label: "b", system: "C1" };
    const remote = { comment: "a", label: "B", system: "C2" };
    const m = mergeIncoming(local, base, remote);
    expect(m.local).toEqual({ comment: "A", label: "B", system: "C1" });
    expect(m.conflicts).toEqual([{ field: "system", mine: "C1", theirs: "C2" }]);
    expect(m.changed).toBe(true);
  });

  it("gleiche Aenderung auf beiden Seiten ist kein Konflikt", () => {
    expect(mergeIncoming({ comment: "x" }, { comment: "a" }, { comment: "x" }).conflicts).toEqual([]);
  });

  it("Grundriss-Markierungen werden nach id zusammengefuehrt", () => {
    const base = [{ id: "1", x: 0 }, { id: "2", x: 0 }];
    const mine = [{ id: "1", x: 0 }, { id: "3", x: 0 }];          // 2 entfernt, 3 neu
    const cur = [{ id: "1", x: 5 }, { id: "2", x: 0 }, { id: "4", x: 0 }]; // 1 verschoben, 4 neu
    expect(mergeMarkers(base, mine, cur)).toEqual([{ id: "1", x: 5 }, { id: "4", x: 0 }, { id: "3", x: 0 }]);
    expect(mergeIncoming({ markers: mine }, { markers: base }, { markers: cur }).conflicts).toEqual([]);
  });
});
