import { mergeWithDefaultProjectFields, getProjectFieldValue } from '@/lib/projectFields';

interface FieldConfig {
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  is_active: boolean;
  sort_order: number;
  applies_to?: string;
}

export default function ProjectInfoFields({ project, fields }: { project: any; fields: FieldConfig[] }) {
  const visible = mergeWithDefaultProjectFields(fields || []).filter((f) => f.is_active);
  const rows = visible.map((field) => {
    const value = getProjectFieldValue(project, field.field_key);
    if (value === undefined || value === null || value === '') return null;
    return {
      key: field.field_key,
      label: field.field_label,
      value: field.field_type === 'checkbox' ? ((value === true || value === 'true') ? 'Ja' : 'Nein') : String(value),
    };
  }).filter(Boolean) as {key:string;label:string;value:string}[];

  if (rows.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.key} className="rounded-lg border bg-background/50 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.label}</p>
          <p className="text-sm mt-1 break-words whitespace-pre-wrap">{row.value}</p>
        </div>
      ))}
    </div>
  );
}
