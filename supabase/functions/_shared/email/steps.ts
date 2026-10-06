// Statuswechsel-Vorschlaege (Konzept „Statuswechsel"): nur aus klaren Signalen im
// Kontext des aktuellen Schritts. Die Schritt-IDs kommen aus `email_config.hero.steps`.

import type { Signal } from "./classify.ts";

export interface StepIds {
  angebot?: number; vor_ort?: number; detailgespraech?: number; projektplanung?: number; visualisierung?: number;
  materialbestellung?: number; produktionsdaten?: number; reklamation?: number;
  warten_auftrag?: number; warten_layout?: number; warten_ware?: number;
}

export interface StepSuggestion {
  toKey: keyof StepIds;
  toStepId: number;
  /** Weitere sinnvolle Ziele (z. B. Projektplanung statt Detailgespraech). */
  alternatives: { key: keyof StepIds; stepId: number }[];
  reason: string;
  /** Zusatzhinweis fuer den Menschen (z. B. „AB in HERO erstellen und versenden"). */
  hint?: string;
}

const LABEL: Record<keyof StepIds, string> = {
  angebot: "Angeboterstellung", vor_ort: "Vor-Ort-Termin", detailgespraech: "Detailgespräch", projektplanung: "Projektplanung",
  visualisierung: "Visualisierung / Layout", materialbestellung: "Materialbestellung", produktionsdaten: "Produktionsdaten",
  reklamation: "Reklamation", warten_auftrag: "Warten auf Auftrag", warten_layout: "Warten auf Layoutfreigabe", warten_ware: "Warten auf Ware / Daten",
};
export const stepLabel = (k: string) => LABEL[k as keyof StepIds] ?? k;

export function suggestStep(signal: Signal | null, currentStepId: number | null, steps: StepIds): StepSuggestion | null {
  if (!signal) return null;
  const id = (k: keyof StepIds) => steps[k];
  const make = (to: keyof StepIds, reason: string, alt: (keyof StepIds)[] = [], hint?: string): StepSuggestion | null => {
    const stepId = id(to);
    if (!stepId) return null;
    if (currentStepId === stepId) return null; // schon dort: nichts vorzuschlagen
    return {
      toKey: to, toStepId: stepId, reason, hint,
      alternatives: alt.map((k) => ({ key: k, stepId: id(k)! })).filter((a) => a.stepId),
    };
  };
  switch (signal) {
    case "mangel":
      return make("reklamation", "Mangel oder Beschwerde in der Mail"); // aus jedem Schritt
    case "angebot_angenommen":
      if (currentStepId !== id("warten_auftrag")) return null;
      return make("detailgespraech", "Angebot wurde angenommen", ["projektplanung"], "Auftragsbestätigung in HERO erstellen und versenden.");
    case "layout_freigegeben":
      if (currentStepId !== id("warten_layout")) return null;
      return make("materialbestellung", "Layout wurde freigegeben");
    case "layout_korrektur":
      if (currentStepId !== id("warten_layout")) return null;
      return make("visualisierung", "Korrekturwunsch zum Layout");
    case "druckdaten_geliefert":
      if (currentStepId !== id("warten_ware")) return null;
      return make("produktionsdaten", "Druckdaten wurden geliefert");
  }
}
