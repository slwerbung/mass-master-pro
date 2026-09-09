import { FloorPlan } from "@/types/project";
import { FLOOR_FIELD_KEY } from "@/lib/locationNumber";

/**
 * Vererbung vom Grundriss an den Standort.
 *
 * Gebäude und Geschoss hängen am Plan, nicht am einzelnen Schild: ein
 * Grundriss zeigt immer genau ein Geschoss eines Gebäudes. Beides einmal am
 * Plan zu pflegen und an jeden dort gesetzten Standort zu vererben spart bei
 * 300 Schildern 600 Eingaben.
 *
 * Die Werte landen trotzdem **am Standort** (`customFields`) und nicht nur am
 * Plan. Damit arbeiten Filter, Stückliste, Export und die Positionsnummer
 * unverändert weiter – der Plan liefert nur die Vorgabe. Und ein Standort, der
 * ausnahmsweise abweicht (Schild im Treppenhaus zwischen zwei Geschossen),
 * lässt sich einzeln überschreiben, ohne dass der Plan geändert werden muss.
 */

/** Schlüssel des Gebäudefeldes aus der Standard-Feldkonfiguration. */
export const BUILDING_FIELD_KEY = "custom_gebaeude";

export interface FieldConfigLike {
  field_key: string;
  field_label?: string;
}

/**
 * Findet den Schlüssel eines Feldes: erst über den Standardschlüssel, dann
 * über das Label. Der Rückfall ist nötig, weil Standortfelder frei
 * konfigurierbar sind – der Admin vergibt beim Anlegen `custom_<zeitstempel>`,
 * nicht `custom_geschoss`.
 */
export function findFieldKey(
  fieldConfigs: FieldConfigLike[],
  standardKey: string,
  labelHint: string,
): string | null {
  if (fieldConfigs.some((config) => config.field_key === standardKey)) return standardKey;
  const byLabel = fieldConfigs.find(
    (config) =>
      config.field_key.startsWith("custom_") &&
      (config.field_label || "").toLowerCase().includes(labelHint),
  );
  return byLabel?.field_key ?? null;
}

/**
 * Die Feldwerte, die ein neuer Standort von seinem Grundriss übernimmt.
 *
 * Leere Angaben am Plan werden übersprungen – ein leerer Wert würde nur ein
 * vom Nutzer bereits gefülltes Feld überschreiben.
 */
export function inheritedFieldsFromPlan(
  plan: Pick<FloorPlan, "building" | "floor"> | undefined | null,
  fieldConfigs: FieldConfigLike[],
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!plan) return result;

  const building = (plan.building || "").trim();
  if (building) {
    const key = findFieldKey(fieldConfigs, BUILDING_FIELD_KEY, "gebäude")
      ?? findFieldKey(fieldConfigs, BUILDING_FIELD_KEY, "gebaeude");
    if (key) result[key] = building;
  }

  const floor = (plan.floor || "").trim();
  if (floor) {
    const key = findFieldKey(fieldConfigs, FLOOR_FIELD_KEY, "geschoss");
    if (key) result[key] = floor;
  }

  return result;
}

/**
 * Beschriftung eines Grundrisses in Listen und Reitern: „Haus A · 1. OG".
 * Sind Gebäude und Geschoss gepflegt, sagen sie mehr als ein Dateiname wie
 * „Plan_final_v3".
 */
export function floorPlanLabel(plan: Pick<FloorPlan, "name" | "building" | "floor">): string {
  const parts = [plan.building, plan.floor].map((part) => (part || "").trim()).filter(Boolean);
  if (parts.length === 0) return plan.name;
  return parts.join(" · ");
}
