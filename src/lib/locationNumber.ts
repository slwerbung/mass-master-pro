/**
 * Standortnummern.
 *
 * Bisher war die Nummer eine reine laufende Zahl ab 100 ("100", "101", …).
 * Bei einem Leitsystem über mehrere Geschosse sagt das nichts – deshalb
 * bekommt sie ein Geschoss-Kürzel vorangestellt, sobald am Standort ein
 * Geschoss erfasst ist: **"EG-109"**, "1OG-110", "UG-111".
 *
 * Die laufende Zahl bleibt bewusst **projektweit** und zählt weiter wie
 * bisher. Das hat zwei Gründe:
 *
 * 1. Alle Stellen, die die Nummer wieder zerlegen, funktionieren unverändert.
 *    `nextLocationNumber` liest die Ziffern am Ende (`/(\d+)$/`), Plan-Marker
 *    und PDF-Export nehmen den Teil hinter dem letzten Bindestrich. Für sie
 *    sieht "EG-109" aus wie das schon bestehende Altformat "WER-1234-100".
 * 2. Die Nummer bleibt eindeutig, auch wenn jemand das Geschoss nachträglich
 *    ändert. Sie ist die ID, auf die sich Plan, Liste, Produktion, Monteur
 *    und Kunde beziehen – sie darf sich nicht unter der Hand verschieben.
 *
 * Eine bereits vergebene Nummer wird deshalb auch nicht umgeschrieben, wenn
 * das Geschoss später gesetzt oder korrigiert wird. Das Kürzel entsteht beim
 * Anlegen, wo Geschoss und Nummer im selben Formular stehen.
 */

/** Schlüssel des Geschossfeldes aus der Standard-Feldkonfiguration. */
export const FLOOR_FIELD_KEY = "custom_geschoss";

interface FloorPattern {
  pattern: RegExp;
  code: string;
}

/**
 * Reihenfolge zählt: das spezifischere Muster zuerst. "Untergeschoss" darf
 * nicht am "geschoss" von "Erdgeschoss" hängenbleiben.
 */
const FLOOR_PATTERNS: FloorPattern[] = [
  { pattern: /untergeschoss|\bug\b|souterrain/, code: "UG" },
  { pattern: /kellergeschoss|\bkeller\b|\bkg\b/, code: "KG" },
  { pattern: /erdgeschoss|parterre|\beg\b/, code: "EG" },
  { pattern: /zwischengeschoss|mezzanin|\bzg\b/, code: "ZG" },
  { pattern: /dachgeschoss|\bdg\b|dachboden/, code: "DG" },
  { pattern: /obergeschoss|\bog\b|\betage\b|\bstock\b/, code: "OG" },
];

export interface FloorRecognition {
  /** Das Kürzel, z.B. "EG" oder "1OG". Leer, wenn nichts erkennbar war. */
  code: string;
  /**
   * `true` nur bei einem echten Geschossmuster. Bei `false` ist `code` ein
   * Notbehelf aus den ersten Zeichen – brauchbar, wenn jemand das Geschoss
   * bewusst eingetippt hat, aber untauglich als automatischer Vorschlag.
   */
  recognized: boolean;
}

/**
 * Erkennt ein Geschoss in einem Freitext.
 *
 * Die Etagenzahl wird nur unmittelbar vor oder hinter dem Geschosswort
 * gesucht und darf hoechstens zweistellig sein. Sonst wuerde ein Grundriss
 * namens "Plan EG 2024" zum Kuerzel "2024EG".
 */
export function recognizeFloor(raw: string | undefined | null): FloorRecognition {
  const value = (raw || "").trim();
  if (!value) return { code: "", recognized: false };

  // Trennzeichen vereinheitlichen: "1.OG", "1_OG", "Plan-EG" sollen wie
  // "1 og" bzw. "plan eg" gelesen werden.
  const normalized = value
    .toLowerCase()
    .replace(/[_\-/.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const { pattern, code } of FLOOR_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match || match.index === undefined) continue;

    const before = normalized.slice(Math.max(0, match.index - 6), match.index);
    const after = normalized.slice(match.index + match[0].length, match.index + match[0].length + 5);
    const level =
      (before.match(/(\d{1,2})\s*$/) || after.match(/^\s*(\d{1,2})\b/) || [])[1] || "";
    return { code: `${level}${code}`, recognized: true };
  }

  // Kein bekanntes Muster – Buchstaben und Ziffern behalten, Rest verwerfen.
  const cleaned = value.replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase();
  return { code: cleaned.slice(0, 4), recognized: false };
}

/**
 * Kürzel für die Standortnummer: "Erdgeschoss" → EG, "1. OG" → 1OG,
 * "2. Obergeschoss" → 2OG, "Untergeschoss" → UG. Was sich keinem Muster
 * zuordnen lässt, wird auf vier Zeichen gekürzt – wer das Geschoss selbst
 * eingetippt hat, soll auch ein eigenes Kürzel bekommen.
 */
export function floorAbbreviation(raw: string | undefined | null): string {
  return recognizeFloor(raw).code;
}

/**
 * Setzt die Nummer zusammen. Ohne Kürzel bleibt es bei der reinen Zahl –
 * genau wie bisher, damit sich bei normalen Aufmaßen nichts ändert.
 */
export function buildLocationNumber(prefix: string, sequence: number): string {
  const clean = prefix.replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase();
  return clean ? `${clean}-${sequence}` : String(sequence);
}

/**
 * Findet den erfassten Geschosswert in den Formularwerten.
 *
 * Erst über den Standardschlüssel `custom_geschoss`. Wurde das Feld im Admin
 * umbenannt oder neu angelegt, greift der Rückfall über das Label – sonst
 * wäre das Kürzel weg, sobald jemand das Feld anfasst.
 */
export function findFloorValue(
  fieldValues: Record<string, string>,
  fieldConfigs: { field_key: string; field_label?: string }[],
): string {
  const direct = fieldValues[FLOOR_FIELD_KEY];
  if (direct && direct.trim()) return direct.trim();

  const byLabel = fieldConfigs.find(
    (config) =>
      config.field_key.startsWith("custom_") &&
      (config.field_label || "").toLowerCase().includes("geschoss"),
  );
  if (!byLabel) return "";
  return (fieldValues[byLabel.field_key] || "").trim();
}
