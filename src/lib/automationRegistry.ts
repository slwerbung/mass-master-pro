// Registry of available automation triggers and actions.
//
// This is the single source of truth the Admin UI uses to render forms.
// Adding a new trigger or action here makes it appear in the dropdowns with
// its config fields auto-rendered — no other UI change needed. The server
// side (supabase/functions/_shared/automations.ts) has the matching action
// handlers; keep the `type` strings in sync between the two.

export type FieldType = "text" | "number" | "time" | "select" | "checkbox";

export interface ConfigField {
  key: string;
  label: string;
  type: FieldType;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  optional?: boolean;
  help?: string;
  // If set, the UI loads the dropdown options live from HERO via admin-manage
  // (action "hero_list_options" with this source). Falls back to a manual
  // number input when the list can't be loaded.
  optionsSource?: string;
}

export interface TriggerDef {
  type: string;
  label: string;
  description: string;
  configFields?: ConfigField[];
}

export interface ActionDef {
  type: string;
  label: string;
  description: string;
  requires?: string[]; // e.g. ['hero'] — integrations this action depends on
  configFields: ConfigField[];
}

export const TRIGGERS: TriggerDef[] = [
  {
    type: "vehicle_inquiry_submitted",
    label: "Fahrzeuganfrage abgeschickt",
    description: "Ein Kunde hat über das Fahrzeug-Formular eine Anfrage gesendet.",
  },
  {
    type: "first_location_created",
    label: "Erster Standort angelegt (Nach Aufmaß)",
    description: "Im Projekt wurde der erste Standort erstellt – z.B. nach dem Aufmaß vor Ort.",
  },
  {
    type: "project_fully_approved",
    label: "Projekt vollständig freigegeben",
    description: "Der Kunde hat alle Standorte (bzw. das Fahrzeug-Layout) des Projekts freigegeben.",
  },
];

export const ACTIONS: ActionDef[] = [
  {
    type: "assign_employee",
    label: "Mitarbeiter dem Projekt zuordnen",
    description: "Weist einen Mitarbeiter dem auslösenden Projekt zu (erscheint in der Mitarbeiterliste des Projekts). Leer = der auslösende Mitarbeiter wird zugeordnet.",
    configFields: [
      {
        key: "employee_id",
        label: "Mitarbeiter (optional)",
        type: "select",
        optional: true,
        optionsSource: "app_employees",
        help: "Wähle einen Mitarbeiter. Leer = der Mitarbeiter, der den Trigger ausgelöst hat (z.B. erste Standortaufnahme).",
      },
    ],
  },
  {
    type: "hero_create_calendar_event",
    label: "HERO: Termin in Plantafel anlegen",
    description: "Legt einen Kalender-Termin am verknüpften HERO-Projekt an (erscheint in der Plantafel).",
    requires: ["hero"],
    configFields: [
      { key: "title", label: "Titel", type: "text", default: "Aufmaß vor Ort" },
      {
        key: "target", label: "Termin geht an (Mitarbeiter/Ressource)", type: "select", optional: true,
        optionsSource: "hero_targets",
        help: "Mitarbeiter oder Ressource, die den Termin in der Plantafel bekommt. Leer = der auslösende Mitarbeiter (laut HERO-Zuordnung).",
      },
      {
        key: "dayOffset", label: "Wann", type: "select", default: "0",
        options: [
          { value: "0", label: "Am selben Tag" },
          { value: "1", label: "1 Tag später" },
          { value: "2", label: "2 Tage später" },
          { value: "3", label: "3 Tage später" },
          { value: "7", label: "1 Woche später" },
          { value: "14", label: "2 Wochen später" },
        ],
      },
      { key: "time", label: "Uhrzeit", type: "time", default: "09:00" },
      { key: "durationMinutes", label: "Dauer (Minuten)", type: "number", default: 60 },
      { key: "categoryId", label: "Kategorie (HERO)", type: "select", optional: true, optionsSource: "hero_calendar_categories" },
    ],
  },
  {
    type: "hero_upload_aufmass_pdf",
    label: "HERO: Aufmaß-PDF hochladen",
    description: "Erstellt automatisch ein Aufmaß-PDF des Projekts und lädt es als Dokument ins verknüpfte HERO-Projekt.",
    requires: ["hero"],
    configFields: [
      {
        key: "documentType",
        label: "HERO-Dokumenttyp",
        type: "select",
        optional: true,
        optionsSource: "hero_doc_types",
        help: "Leer = der unter „HERO Dokumente“ (Aufmaß-PDF) im Admin hinterlegte Dokumenttyp wird verwendet.",
      },
    ],
  },
];

export const triggerLabel = (t: string) => TRIGGERS.find((x) => x.type === t)?.label ?? t;
export const actionLabel = (a: string) => ACTIONS.find((x) => x.type === a)?.label ?? a;
export const getTrigger = (t: string) => TRIGGERS.find((x) => x.type === t);
export const getAction = (a: string) => ACTIONS.find((x) => x.type === a);
