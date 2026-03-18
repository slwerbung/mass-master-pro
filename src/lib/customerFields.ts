export interface BaseFieldConfig {
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  is_active: boolean;
  customer_visible: boolean;
  sort_order: number;
}

export const DEFAULT_LOCATION_FIELDS: BaseFieldConfig[] = [
  { field_key: "locationName", field_label: "Standortname", field_type: "text", is_active: true, customer_visible: true, sort_order: 5 },
  { field_key: "system", field_label: "System", field_type: "text", is_active: true, customer_visible: true, sort_order: 10 },
  { field_key: "locationType", field_label: "Standorttyp", field_type: "text", is_active: true, customer_visible: true, sort_order: 20 },
  { field_key: "label", field_label: "Beschriftung", field_type: "text", is_active: true, customer_visible: true, sort_order: 30 },
  { field_key: "comment", field_label: "Kommentar / Informationen", field_type: "textarea", is_active: true, customer_visible: true, sort_order: 40 },
];

export function mergeWithDefaultLocationFields<T extends Partial<BaseFieldConfig>>(fields: T[]): (T & BaseFieldConfig)[] {
  const map = new Map<string, T & BaseFieldConfig>();

  DEFAULT_LOCATION_FIELDS.forEach((field) => {
    map.set(field.field_key, field as T & BaseFieldConfig);
  });

  (fields || []).forEach((field) => {
    if (!field.field_key) return;
    const existing = map.get(field.field_key);
    map.set(field.field_key, {
      ...(existing || {} as T & BaseFieldConfig),
      ...field,
      is_active: field.is_active ?? existing?.is_active ?? true,
      customer_visible: field.customer_visible ?? existing?.customer_visible ?? true,
      sort_order: field.sort_order ?? existing?.sort_order ?? 999,
    });
  });

  return Array.from(map.values()).sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
}
