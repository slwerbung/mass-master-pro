import { mergeWithDefaultLocationFields } from "@/lib/customerFields";

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
}

export default function LocationInfoFields({ location, fields, customerOnly = false }: Props) {
  const visibleFields = mergeWithDefaultLocationFields(fields).filter((field) => field.is_active && (!customerOnly || field.customer_visible));
  if (visibleFields.length === 0) return null;

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

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {visibleFields.map((field) => {
        const value = resolveValue(field.field_key);
        if (value === undefined || value === null || value === "") return null;
        const displayValue = field.field_type === "checkbox"
          ? (value === true || value === "true" ? "Ja" : "Nein")
          : String(value);

        return (
          <div key={field.field_key} className="space-y-1 rounded-lg border p-3 bg-muted/20">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{field.field_label}</p>
            <p className="text-sm whitespace-pre-wrap">{displayValue}</p>
          </div>
        );
      })}
    </div>
  );
}
