import { describe, expect, it } from "vitest";
import { mapDocumentTypes, mapSteps, normalizeName } from "./heroReload.ts";

describe("heroReload", () => {
  it("normalisiert Emoji, Bindestriche und Umlaute", () => {
    expect(normalizeName("📏 Vor-Ort-Termin")).toBe("vor ort termin");
    expect(normalizeName("🖥️ Produktionsdaten")).toBe("produktionsdaten");
    expect(normalizeName("Aufmaßdokument")).toBe("aufmassdokument");
  });
  it("ordnet Schritte ueber ihre Namen zu (Namen aus der HERO-Konfiguration)", () => {
    const steps = [
      { id: 2825, name: "📬Anfragen" }, { id: 266510, name: "📏 Vor-Ort-Termin" }, { id: 266511, name: "📄 Angeboterstellung" },
      { id: 266648, name: "⏳ Warten auf Auftrag" }, { id: 266647, name: "📋 Detailgespräch" }, { id: 266512, name: "🚧 Projektplanung" },
      { id: 266370, name: "🖌 Visualisierung / Layout" }, { id: 266649, name: "⌛ Warten auf Layoutfreigabe" }, { id: 266740, name: "🧾 Materialbestellung" },
      { id: 266741, name: "⏲ Warten auf Ware / Daten" }, { id: 266371, name: "🖥️ Produktionsdaten" }, { id: 2834, name: "⌚ Warten auf Bezahlung" },
      { id: 2835, name: "❗ Reklamation" }, { id: 2836, name: "✅ Abgeschlossen" }, { id: 2837, name: "🗄 Archiviert" },
    ];
    const r = mapSteps(steps);
    expect(r.steps).toEqual({
      angebot: 266511, vor_ort: 266510, detailgespraech: 266647, projektplanung: 266512, visualisierung: 266370, materialbestellung: 266740,
      produktionsdaten: 266371, reklamation: 2835, warten_auftrag: 266648, warten_layout: 266649, warten_ware: 266741,
    });
    expect(r.excluded.sort()).toEqual([2834, 2836, 2837]);
    expect(r.missing).toEqual([]);
  });
  it("meldet, was nicht gefunden wurde", () => {
    const r = mapSteps([{ id: 1, name: "Anfragen" }]);
    expect(r.missing).toContain("reklamation");
    expect(r.missing).toContain("archiviert");
  });
  it("Dokumenttypen", () => {
    const r = mapDocumentTypes([{ id: 171300, name: "Angebot" }, { id: 338164, name: "Plan / Layout" }, { id: 428979, name: "Druckdaten" }, { id: 279269, name: "Aufmaßdokument" }, { id: 1250455, name: "Lager-Etiketten" }]);
    expect(r.found).toEqual({ layouts: 338164, aufmasse: 279269, druckdaten: 428979 });
    expect(r.offerTypeId).toBe(171300);
  });
});
