import { mergeWithDefaultLocationFields } from "@/lib/customerFields";
import { getProjectFieldValue, mergeWithDefaultProjectFields } from "@/lib/projectFields";

export interface LocationInfoFieldConfig {
  id?: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  is_active: boolean;
  customer_visible: boolean;
  sort_order: number;
}

interface Props {
  location: any;
  fields: LocationInfoFieldConfig[];
  customerOnly?: boolean;
  project?: any;
  projectFields?: any[];
  // When true, the "locationName" field is skipped because the parent
  // already shows it (e.g. in the card title). Set by LocationCard.
  hideLocationName?: boolean;
}

export default function LocationInfoFields({ location, fields, customerOnly = false, project, projectFields = [], hideLocationName = false }: Props) {
  const visibleFields = mergeWithDefaultLocationFields(fields).filter((field) => {
    if (!field.is_active) return false;
    if (customerOnly && !field.customer_visible) return false;
    if (hideLocationName && field.field_key === "locationName") return false;
    return true;
  });
  const visibleProjectFields = mergeWithDefaultProjectFields(projectFields || []).filter((field) => field.is_active);
  if (visibleFields.length === 0 && visibleProjectFields.length === 0) return null;

  const customFields = location?.custom_fields && typeof location.custom_fields === "object"
    ? location.custom_fields
    : (location?.customFields && typeof location.customFields === "object" ? location.customFields : {});

  const resolveValue = (fieldKey: string) => {
    switch (fieldKey) {
      case "locationName":
        return location.location_name ?? location.locationName;
      case "system":
        return location.system;
      case "label":
        return location.label;
      case "locationType":
        return location.location_type ?? location.locationType;
      case "comment":
        return location.comment;
      default:
        return customFields?.[fieldKey];
    }
  };

  const projectRows = visibleProjectFields.map((field) => {
    const value = getProjectFieldValue(project, field.field_key);
    if (value === undefined || value === null || value === "") return null;
    const displayValue = field.field_type === "checkbox" ? ((value === true || value === "true") ? "Ja" : "Nein") : String(value);
    return { key: `project-${field.field_key}`, label: field.field_label, displayValue };
  }).filter(Boolean) as {key:string;label:string;displayValue:string}[];

  const locationRows = visibleFields.map((field) => {
    const value = resolveValue(field.field_key);
    if (value === undefined || value === null || value === "") return null;
    const displayValue = field.field_type === "checkbox"
      ? (value === true || value === "true" ? "Ja" : "Nein")
      : String(value);
    return { key: field.field_key, label: field.field_label, displayValue };
  }).filter(Boolean) as {key:string;label:string;displayValue:string}[];

  const rows = [...projectRows, ...locationRows];
  if (rows.length === 0) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.key} className="space-y-1 rounded-lg border p-3 bg-muted/20">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.label}</p>
          <p className="text-sm whitespace-pre-wrap">{row.displayValue}</p>
        </div>
      ))}
    </div>
  );
}
