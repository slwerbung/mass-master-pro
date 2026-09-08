import { Location } from "@/types/project";
import { BaseFieldConfig } from "@/lib/customerFields";

/**
 * Filtern der Standortliste.
 *
 * Die Filter werden NICHT fest verdrahtet, sondern aus der Feldkonfiguration
 * und den tatsaechlich vorkommenden Werten erzeugt. Legt jemand im Admin ein
 * neues Standortfeld an, laesst sich sofort danach filtern – ohne dass hier
 * etwas nachgezogen werden muss.
 */

export const ALL_VALUES = "__alle__";

export interface LocationFilter {
  /** Freitext ueber Nummer, Name und alle Feldwerte. */
  search: string;
  /** Feldschluessel → ausgewaehlter Wert (oder ALL_VALUES). */
  values: Record<string, string>;
}

export const emptyLocationFilter = (): LocationFilter => ({ search: "", values: {} });

export function isLocationFilterActive(filter: LocationFilter): boolean {
  if (filter.search.trim()) return true;
  return Object.values(filter.values).some((value) => value && value !== ALL_VALUES);
}

/** Die fest im Standort verankerten Felder – alles andere liegt in customFields. */
const BUILT_IN_KEYS: Record<string, (location: Location) => string | undefined> = {
  locationName: (l) => l.locationName,
  system: (l) => l.system,
  label: (l) => l.label,
  locationType: (l) => l.locationType,
  comment: (l) => l.comment,
};

/** Wert eines Feldes an einem Standort – egal ob eingebaut oder frei konfiguriert. */
export function locationFieldValue(location: Location, fieldKey: string): string {
  const builtIn = BUILT_IN_KEYS[fieldKey];
  if (builtIn) return (builtIn(location) || "").trim();
  return (location.customFields?.[fieldKey] || "").trim();
}

export interface FilterableField {
  fieldKey: string;
  label: string;
  /** Die im Projekt tatsaechlich vorkommenden Werte, alphabetisch. */
  values: string[];
}

/**
 * Welche Felder taugen als Auswahlfilter?
 *
 * Nur Felder, die im Projekt ueberhaupt gefuellt sind und nicht bei jedem
 * Standort etwas anderes enthalten. Ein Kommentarfeld mit 300 verschiedenen
 * Texten ergibt keine sinnvolle Auswahlliste – dafuer gibt es die Suche.
 */
export function filterableFields(
  locations: Location[],
  fieldConfigs: Pick<BaseFieldConfig, "field_key" | "field_label" | "field_type" | "is_active">[],
  maxDistinct = 25,
): FilterableField[] {
  const result: FilterableField[] = [];

  for (const config of fieldConfigs) {
    if (config.is_active === false) continue;
    if (config.field_type === "textarea") continue; // Freitext filtert man ueber die Suche

    const values = new Set<string>();
    for (const location of locations) {
      const value = locationFieldValue(location, config.field_key);
      if (value) values.add(value);
    }
    if (values.size === 0) continue;
    if (values.size > maxDistinct) continue;

    result.push({
      fieldKey: config.field_key,
      label: config.field_label,
      values: [...values].sort((a, b) => a.localeCompare(b, "de", { numeric: true, sensitivity: "base" })),
    });
  }

  return result;
}

export function applyLocationFilter(locations: Location[], filter: LocationFilter): Location[] {
  const needle = filter.search.trim().toLowerCase();
  const active = Object.entries(filter.values).filter(([, value]) => value && value !== ALL_VALUES);

  if (!needle && active.length === 0) return locations;

  return locations.filter((location) => {
    for (const [fieldKey, expected] of active) {
      if (locationFieldValue(location, fieldKey) !== expected) return false;
    }
    if (!needle) return true;

    const haystack = [
      location.locationNumber,
      location.locationName,
      location.system,
      location.label,
      location.locationType,
      location.comment,
      ...Object.values(location.customFields || {}),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
