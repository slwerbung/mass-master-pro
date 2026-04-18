export interface ProjectFieldConfig {
  id?: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  field_options?: string | null;
  is_active: boolean;
  is_required?: boolean;
  sort_order: number;
  applies_to?: string;
}

/**
 * Protected built-in fields. They are always present in the config, always
 * shown on the "new project" form, and cannot be deleted or renamed via the
 * admin UI. Enforced both on the client (greyed-out rows) and on the server
 * (admin-manage edge function rejects edits/deletes).
 */
export const PROTECTED_PROJECT_FIELD_KEYS = new Set(["projectNumber", "customerName"]);

export function isProtectedProjectField(fieldKey: string): boolean {
  return PROTECTED_PROJECT_FIELD_KEYS.has(fieldKey);
}

export const DEFAULT_PROJECT_FIELDS: ProjectFieldConfig[] = [
  { field_key: "projectNumber", field_label: "Projektnummer / Projektname", field_type: "text", is_active: true, is_required: true,  sort_order: 0,  applies_to: "all" },
  { field_key: "customerName",  field_label: "Kunde",                         field_type: "text", is_active: true, is_required: false, sort_order: 10, applies_to: "all" },
];

export function mergeWithDefaultProjectFields<T extends Partial<ProjectFieldConfig>>(fields: T[]): (T & ProjectFieldConfig)[] {
  const map = new Map<string, T & ProjectFieldConfig>();
  DEFAULT_PROJECT_FIELDS.forEach((field) => map.set(field.field_key, field as T & ProjectFieldConfig));
  (fields || []).forEach((field) => {
    if (!field.field_key) return;
    const existing = map.get(field.field_key);
    map.set(field.field_key, {
      ...(existing || {} as T & ProjectFieldConfig),
      ...field,
      is_active: field.is_active ?? existing?.is_active ?? true,
      is_required: (field as any).is_required ?? existing?.is_required ?? false,
      sort_order: field.sort_order ?? existing?.sort_order ?? 999,
      applies_to: (field as any).applies_to ?? existing?.applies_to ?? 'all',
    });
  });
  return Array.from(map.values()).sort((a,b)=> (a.sort_order ?? 999) - (b.sort_order ?? 999));
}

export function getProjectFieldValue(project: any, key: string): string | boolean | undefined {
  if (!project) return undefined;
  if (key === 'projectNumber') return project.projectNumber || project.project_number || undefined;
  if (key === 'customerName')  return project.customerName  || project.customer_name  || undefined;
  const custom = project.customFields && typeof project.customFields === 'object' ? project.customFields : (project.custom_fields && typeof project.custom_fields === 'object' ? project.custom_fields : {});
  return custom?.[key];
}
