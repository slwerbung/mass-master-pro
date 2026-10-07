// Autopilot-Entscheidung: darf eine Aktion von selbst laufen, ist sie nur ein
// Vorschlag, oder bleibt sie aus?
//
// Regel aus dem Konzept: „Automatisch" greift nur bei Konfidenz ab 0,7 bzw. bei
// sicherer Zuordnung; darunter wird jede Aktion zum Vorschlag. Im Schattenmodus
// laeuft keine AUTOMATIK im Postfach oder in HERO — der Assistent rechnet nur.

import {
  AUTOPILOT_ACTIONS, AUTOPILOT_DEFAULTS, CONFIDENCE_AUTO_MIN,
  type Autopilot, type AutopilotAction, type AutopilotLevel,
} from "./types.ts";

export type Decision = "skip" | "suggest" | "auto" | "shadow";

/** Gespeicherte Stufen mit den Standardwerten auffuellen; Muell wird verworfen. */
export function normalizeAutopilot(raw: unknown): Autopilot {
  const out: Autopilot = { ...AUTOPILOT_DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const k of AUTOPILOT_ACTIONS) {
      const v = (raw as Record<string, unknown>)[k];
      if (v === "off" || v === "suggest" || v === "auto") out[k] = v as AutopilotLevel;
    }
  }
  return out;
}

export function decide(
  action: AutopilotAction,
  opts: {
    autopilot: Autopilot;
    shadowMode: boolean;
    confidence: number | null;
    /** Thread oder Projektnummer — eindeutig, unabhaengig von der Modell-Konfidenz. */
    certain?: boolean;
  },
): Decision {
  const level = opts.autopilot[action];
  if (level === "off") return "skip";
  // Ein Vorschlag aendert selbst nichts: er liegt nur in der Datenbank, bis jemand
  // ihn in der Mail-App annimmt. Das gilt auch im Schattenmodus.
  if (level === "suggest") return "suggest";
  // level === "auto": im Schattenmodus nur rechnen, nichts anfassen.
  if (opts.shadowMode) return "shadow";
  const sure = opts.certain === true || (opts.confidence != null && opts.confidence >= CONFIDENCE_AUTO_MIN);
  return sure ? "auto" : "suggest";
}
