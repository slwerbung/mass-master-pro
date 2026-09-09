import { FloorPlan } from "@/types/project";
import { FLOOR_FIELD_KEY } from "@/lib/locationNumber";
import { BaseFieldConfig } from "@/lib/customerFields";

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

/** Projekttyp, bei dem die beiden eingebauten Felder gelten. */
export const PLAN_PROJECT_TYPE = "aufmass_mit_plan";

/** Schlüssel des Gebäudefeldes aus der Standard-Feldkonfiguration. */
export const BUILDING_FIELD_KEY = "custom_gebaeude";

/**
 * Gebäude und Geschoss gibt es **immer**, sie stehen im Code und nicht in der
 * Feldkonfiguration.
 *
 * Sie sind kein frei definierbares Standortfeld wie „Schildtyp" oder
 * „Montageart", sondern Teil der Mechanik: die Vererbung vom Grundriss
 * (`inheritedFieldsFromPlan`) und das Geschoss-Kürzel in der Standortnummer
 * (`buildLocationNumber`) hängen an ihnen. Müsste man sie erst im Admin
 * anlegen, wäre beides so lange still kaputt – und zwar ohne Fehlermeldung,
 * weil ein fehlendes Feld einfach nichts vererbt.
 *
 * Sie erscheinen nur bei Plan-Projekten. Bei normalen Aufmaßen und
 * Fahrzeugbeschriftungen ändert sich dadurch nichts.
 */
export const PLAN_BUILTIN_FIELDS: (BaseFieldConfig & { applies_to: string })[] = [
  {
    field_key: BUILDING_FIELD_KEY, field_label: "Gebäude", field_type: "text",
    is_active: true, customer_visible: true, sort_order: 42, applies_to: PLAN_PROJECT_TYPE,
  },
  {
    field_key: FLOOR_FIELD_KEY, field_label: "Geschoss", field_type: "text",
    is_active: true, customer_visible: true, sort_order: 44, applies_to: PLAN_PROJECT_TYPE,
  },
];

/**
 * Ergänzt die Feldkonfiguration um Gebäude und Geschoss – aber nur bei
 * Plan-Projekten und nur, wenn es sie nicht schon gibt.
 *
 * Der Dublettenschutz geht über Schlüssel **und** Label: wer sich im Admin
 * selbst ein Feld „Gebäude" angelegt hat, soll es behalten und nicht ein
 * zweites daneben stehen haben. Sein Feld gewinnt, weil daran seine bereits
 * erfassten Werte hängen.
 */
export function withPlanBuiltinFields<T extends FieldConfigLike>(
  fieldConfigs: T[],
  projectType: string | undefined | null,
): (T | (BaseFieldConfig & { applies_to: string }))[] {
  if (projectType !== PLAN_PROJECT_TYPE) return fieldConfigs;

  const fehlend = PLAN_BUILTIN_FIELDS.filter((builtin) => {
    const hinweis = builtin.field_key === BUILDING_FIELD_KEY ? "gebäude" : "geschoss";
    if (findFieldKey(fieldConfigs, builtin.field_key, hinweis)) return false;
    // "Gebaeude" ohne Umlaut kommt in von Hand angelegten Feldern vor.
    return builtin.field_key !== BUILDING_FIELD_KEY
      || !findFieldKey(fieldConfigs, builtin.field_key, "gebaeude");
  });
  if (fehlend.length === 0) return fieldConfigs;

  return [...fieldConfigs, ...fehlend].sort(
    (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999),
  );
}

export interface FieldConfigLike {
  field_key: string;
  field_label?: string;
  sort_order?: number;
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
