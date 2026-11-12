// HERO-Status: Namen tragen Emoji ("🚧 Projektplanung"). Regeln arbeiten mit einem stabilen Schluessel
// aus dem Namen, nie mit festen IDs (die gehoeren in project_step_settings und sind im Adminmenue pflegbar).

/** Name ohne Emoji/Sonderzeichen vorne, klein, Leerraum vereinheitlicht. */
export function normalizeStepName(name: string): string {
  return String(name || "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Anzeigename ohne fuehrendes Emoji. */
export function displayStepName(name: string): string {
  return String(name || "").replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim();
}

// Reihenfolge zaehlt: spezifische Namen vor allgemeinen ("warten auf layoutfreigabe" vor "warten auf ...").
const KEYS: [string, string][] = [
  ["reklamation", "reklamation"],
  ["layoutfreigabe", "freigabe"],
  ["abholung", "abholung"],
  ["anfragen", "anfragen"],
  ["angeboterstellung", "angebot"],
  ["warten auf auftrag", "warten_auftrag"],
  ["projektplanung", "planung"],
  ["visualisierung", "visualisierung"],
  ["materialbestellung", "material"],
  ["warten auf ware", "ware_daten"],
  ["endproduktion", "endproduktion"],
  ["plott", "plott"],
  ["abrechnung", "abrechnung"],
  ["bezahlung", "bezahlung"],
  ["abgeschlossen", "abgeschlossen"],
  ["archiviert", "archiviert"],
  ["druck", "druck"],
];

export function stepKey(name: string): string {
  const n = normalizeStepName(name);
  for (const [needle, key] of KEYS) if (n.includes(needle)) return key;
  return n.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Je hoeher, desto naeher am Abschluss (Sortierung im Stapel). Unbekannte Status: 0. */
const CLOSENESS: Record<string, number> = {
  anfragen: 10, angebot: 15, warten_auftrag: 20, planung: 30, visualisierung: 40, freigabe: 45, material: 50,
  ware_daten: 55, druck: 60, plott: 62, endproduktion: 70, reklamation: 75, abholung: 80, abrechnung: 90, bezahlung: 95,
};
export function defaultCloseness(key: string): number { return CLOSENESS[key] ?? 0; }

/** Buchhaltung bleibt draussen; Abgeschlossen/Archiviert sind keine offenen Projekte. */
const EXCLUDED = new Set(["abrechnung", "bezahlung", "abgeschlossen", "archiviert"]);
export function defaultExcluded(key: string): boolean { return EXCLUDED.has(key); }

/** Diese Status gehoeren nicht in den Projektspiegel (nicht mehr offen). */
export function isClosedKey(key: string): boolean { return key === "abgeschlossen" || key === "archiviert"; }

/** Status mit eigener Regel – nur alle anderen faengt `haengt` auf. */
export const RULE_STEP_KEYS = new Set(["reklamation", "freigabe", "abholung", "anfragen", "angebot", "warten_auftrag", "planung", "material"]);
