// Feiertage aus oeffentlichen Quellen. Das Parsen ist hier bewusst von den
// fetch-Aufrufen getrennt: die Netzwerkseite laesst sich nicht sinnvoll testen,
// die Formate der beiden APIs dagegen sehr wohl — und genau dort sitzen die
// Fehler, wenn eine Quelle ihre Antwort aendert.

export interface Holiday { date: string; name: string }

export const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * feiertage-api.de
 *
 * Mit `nur_land=BW`:   { "Neujahrstag": { datum: "2026-01-01", hinweis: "" }, ... }
 * Ohne `nur_land`:     { "BW": { "Neujahrstag": { datum: ... } }, ... }
 *
 * Beide Formen werden gelesen, damit ein Verhaltenswechsel der API den Import
 * nicht sofort unbrauchbar macht.
 */
export function parseFeiertageApi(data: unknown, state: string): Holiday[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, any>;

  // Verschachtelt, wenn unter dem Bundesland-Schluessel selbst ein Objekt ohne
  // `datum` liegt — dann ist das die Ebene mit den Feiertagen.
  const nested = obj[state];
  const level: Record<string, any> =
    nested && typeof nested === "object" && !("datum" in nested) ? nested : obj;

  const out: Holiday[] = [];
  for (const [name, val] of Object.entries(level)) {
    if (!val || typeof val !== "object") continue;
    const datum = (val as any).datum;
    if (isIsoDate(datum)) out.push({ date: datum, name });
  }
  return dedupe(out);
}

/**
 * date.nager.at (v3)
 *
 * [{ date, localName, name, global, counties: ["DE-BW", ...] | null }, ...]
 *
 * `global: true` oder `counties: null` gilt bundesweit; sonst muss das
 * Bundesland ausdruecklich in `counties` stehen.
 */
export function parseNager(rows: unknown, state: string): Holiday[] {
  if (!Array.isArray(rows)) return [];
  const want = `DE-${state}`;
  const out: Holiday[] = [];
  for (const r of rows as any[]) {
    if (!r || !isIsoDate(r.date)) continue;
    const counties = r.counties;
    const applies =
      r.global === true ||
      counties == null ||
      (Array.isArray(counties) && counties.includes(want));
    if (!applies) continue;
    out.push({ date: r.date, name: String(r.localName || r.name || "Feiertag") });
  }
  return dedupe(out);
}

/** Ein Datum darf nur einmal vorkommen — sonst kollidiert der Upsert. */
function dedupe(list: Holiday[]): Holiday[] {
  const seen = new Map<string, Holiday>();
  for (const h of list) if (!seen.has(h.date)) seen.set(h.date, h);
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const GERMAN_STATES = [
  "BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV",
  "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH",
] as const;

export function isGermanState(s: string): boolean {
  return (GERMAN_STATES as readonly string[]).includes(s);
}

const TIMEOUT_MS = 8000;

async function getJson(url: string): Promise<unknown> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

/**
 * Holt die Feiertage. Erst feiertage-api.de (deutsche Bundeslaender direkt),
 * bei Ausfall date.nager.at. Wirft nur, wenn BEIDE nichts liefern — dann soll
 * der Aufrufer das auch sehen und nicht stillschweigend leere Listen speichern.
 */
export async function fetchHolidays(
  state: string,
  year: number,
): Promise<{ list: Holiday[]; source: string }> {
  const errors: string[] = [];
  try {
    const data = await getJson(`https://feiertage-api.de/api/?jahr=${year}&nur_land=${encodeURIComponent(state)}`);
    const list = parseFeiertageApi(data, state);
    if (list.length > 0) return { list, source: "feiertage-api.de" };
    errors.push("feiertage-api.de: keine Feiertage gelesen");
  } catch (e) {
    errors.push(`feiertage-api.de: ${(e as Error)?.message || e}`);
  }
  try {
    const rows = await getJson(`https://date.nager.at/api/v3/PublicHolidays/${year}/DE`);
    const list = parseNager(rows, state);
    if (list.length > 0) return { list, source: "date.nager.at" };
    errors.push("date.nager.at: keine Feiertage fuer dieses Bundesland");
  } catch (e) {
    errors.push(`date.nager.at: ${(e as Error)?.message || e}`);
  }
  throw new Error(errors.join(" | "));
}
