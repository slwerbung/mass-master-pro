import { describe, expect, it } from "vitest";
import { decide, normalizeAutopilot } from "./autopilot.ts";
import { AUTOPILOT_DEFAULTS } from "./types.ts";

const base = { autopilot: AUTOPILOT_DEFAULTS, shadowMode: false, confidence: 0.9 };

describe("Autopilot", () => {
  it("Aus bleibt aus, auch bei bester Konfidenz", () => {
    expect(decide("forward_beleg", { ...base })).toBe("skip");
  });
  it("Automatisch nur ab Konfidenz 0,7 — darunter Vorschlag", () => {
    expect(decide("move_folders", { ...base, confidence: 0.7 })).toBe("auto");
    expect(decide("move_folders", { ...base, confidence: 0.69 })).toBe("suggest");
    expect(decide("move_folders", { ...base, confidence: null })).toBe("suggest");
  });
  it("sichere Zuordnung (Thread/Nummer) braucht keine Modell-Konfidenz", () => {
    expect(decide("log_certain", { ...base, confidence: null, certain: true })).toBe("auto");
  });
  it("Vorschlag bleibt Vorschlag", () => {
    expect(decide("create_project", base)).toBe("suggest");
  });
  it("Schattenmodus: Automatik rechnet nur, Vorschlaege bleiben Vorschlaege", () => {
    expect(decide("move_folders", { ...base, shadowMode: true })).toBe("shadow");
    expect(decide("create_project", { ...base, shadowMode: true })).toBe("suggest");
    expect(decide("forward_beleg", { ...base, shadowMode: true })).toBe("skip");
  });
  it("normalisiert gespeicherte Stufen und verwirft Muell", () => {
    const a = normalizeAutopilot({ draft: "off", move_folders: "banane", log_assumed: "auto" });
    expect(a.draft).toBe("off");
    expect(a.move_folders).toBe("auto");
    expect(a.log_assumed).toBe("auto");
    expect(normalizeAutopilot(null)).toEqual(AUTOPILOT_DEFAULTS);
  });
});
