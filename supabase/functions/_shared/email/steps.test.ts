import { describe, expect, it } from "vitest";
import { suggestStep, type StepIds } from "./steps.ts";
import { pickGewerk } from "./gewerke.ts";

const steps: StepIds = {
  detailgespraech: 10, projektplanung: 11, visualisierung: 12, materialbestellung: 13, produktionsdaten: 14, reklamation: 15,
  warten_auftrag: 20, warten_layout: 21, warten_ware: 22,
};

describe("suggestStep – Tabelle aus dem Konzept", () => {
  it("Warten auf Auftrag + Angebot angenommen -> Detailgespraech (Alternative Projektplanung)", () => {
    const s = suggestStep("angebot_angenommen", 20, steps)!;
    expect(s.toStepId).toBe(10);
    expect(s.alternatives).toEqual([{ key: "projektplanung", stepId: 11 }]);
    expect(s.hint).toMatch(/Auftragsbestätigung/);
  });
  it("Warten auf Layoutfreigabe: Freigabe -> Materialbestellung, Korrektur -> Visualisierung", () => {
    expect(suggestStep("layout_freigegeben", 21, steps)?.toStepId).toBe(13);
    expect(suggestStep("layout_korrektur", 21, steps)?.toStepId).toBe(12);
  });
  it("Warten auf Ware/Daten + Druckdaten -> Produktionsdaten", () => {
    expect(suggestStep("druckdaten_geliefert", 22, steps)?.toStepId).toBe(14);
  });
  it("Mangel -> Reklamation aus jedem Schritt, aber nicht, wenn schon dort", () => {
    expect(suggestStep("mangel", 99, steps)?.toStepId).toBe(15);
    expect(suggestStep("mangel", 15, steps)).toBeNull();
  });
  it("kein Vorschlag im falschen Schritt, ohne Signal oder bei unbekanntem Schritt", () => {
    expect(suggestStep("layout_freigegeben", 99, steps)).toBeNull();
    expect(suggestStep("layout_freigegeben", null, steps)).toBeNull();
    expect(suggestStep(null, 21, steps)).toBeNull();
    expect(suggestStep("mangel", 99, { ...steps, reklamation: undefined })).toBeNull();
  });
});

describe("pickGewerk", () => {
  const g = [
    { short: "WER", name: "Werbetechnik", measure_id: 6619, default: true },
    { short: "TEX", name: "Textildruck", measure_id: 6620, services: ["Textildruck"], keywords: ["textil", "hoodie"] },
  ];
  it("Standard ist Werbetechnik", () => {
    expect(pickGewerk(g, { service: "Fahrzeugbeschriftung", text: "Sprinter" })?.short).toBe("WER");
    expect(pickGewerk(g, { service: null, text: "" })?.short).toBe("WER");
  });
  it("Textil ueber Leistung oder Stichwort", () => {
    expect(pickGewerk(g, { service: "Textildruck", text: "" })?.short).toBe("TEX");
    expect(pickGewerk(g, { service: null, text: "30 Hoodies mit Logo" })?.short).toBe("TEX");
  });
  it("leere Liste -> null", () => {
    expect(pickGewerk([], { service: null, text: "" })).toBeNull();
  });
});
