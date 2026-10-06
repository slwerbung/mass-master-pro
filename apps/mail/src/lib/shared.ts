// KOPIE von supabase/functions/_shared/email/types.ts – nicht von Hand aendern.
// `npm run sync-shared` im Repo-Root aktualisiert sie; ein Test prueft, dass beide gleich sind.
// Gemeinsame Begriffe des Mail-Assistenten. Reine Typen und Konstanten, keine Abhaengigkeiten.

export const CATEGORIES = [
  "anfrage_neu",
  "projekt_kommunikation",
  "layout_freigabe",
  "auftrag",
  "reklamation",
  "lieferant",
  "beleg",
  "ausschreibung",
  "verwaltung",
  "newsletter",
  "system",
  "werbung_spam",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  anfrage_neu: "Neue Anfrage",
  projekt_kommunikation: "Projekt-Kommunikation",
  layout_freigabe: "Layout / Freigabe",
  auftrag: "Auftrag",
  reklamation: "Reklamation",
  lieferant: "Lieferant",
  beleg: "Beleg / Rechnung",
  ausschreibung: "Ausschreibung",
  verwaltung: "Verwaltung",
  newsletter: "Newsletter",
  system: "System",
  werbung_spam: "Werbung / Spam",
};

/** Kategorien, die im Posteingang bleiben (brauchen eine Handlung). */
export const INBOX_CATEGORIES: Category[] = [
  "anfrage_neu", "projekt_kommunikation", "layout_freigabe", "auftrag", "reklamation",
];

/** Kategorie -> Schluessel in `email_config.folders`. Posteingang = null. */
export const CATEGORY_FOLDER_KEY: Record<Category, string | null> = {
  anfrage_neu: null,
  projekt_kommunikation: null,
  layout_freigabe: null,
  auftrag: null,
  reklamation: null,
  lieferant: "lieferanten",
  beleg: "belege",
  ausschreibung: "ausschreibungen",
  verwaltung: "verwaltung",
  newsletter: "newsletter",
  system: "system",
  werbung_spam: "aussortiert",
};

export type MessageStatus = "neu" | "klassifiziert" | "zugeordnet" | "ohne_bezug" | "erledigt" | "wartet" | "fehler";
export type MatchMethod = "thread" | "nummer" | "kontakt" | "ki" | "manuell";
export type Direction = "in" | "out";

export type AiTask = "understand" | "pick_project" | "summarize_out" | "draft" | "prepare_offer";
export const AI_TASKS: AiTask[] = ["understand", "pick_project", "summarize_out", "draft", "prepare_offer"];

export type AutopilotLevel = "off" | "suggest" | "auto";
export const AUTOPILOT_ACTIONS = [
  "move_folders", "move_discard", "move_answered", "keywords", "log_certain", "log_assumed",
  "attachments", "draft", "create_project", "prepare_offer", "status_change", "forward_beleg",
] as const;
export type AutopilotAction = (typeof AUTOPILOT_ACTIONS)[number];
export type Autopilot = Record<AutopilotAction, AutopilotLevel>;

export const AUTOPILOT_LABELS: Record<AutopilotAction, string> = {
  move_folders: "In Ordner 2–7 verschieben",
  move_discard: "In „9 Aussortiert“ verschieben",
  move_answered: "Beantwortete Kundenmail nach „1 Kunden & Projekte“",
  keywords: "IMAP-Schlagwörter setzen",
  log_certain: "Logbuch bei sicherer Zuordnung",
  log_assumed: "Logbuch bei vermuteter Zuordnung",
  attachments: "Anhänge ans HERO-Projekt",
  draft: "Antwortentwurf",
  create_project: "Kontakt + Projekt anlegen",
  prepare_offer: "Angebot vorbereiten",
  status_change: "Statuswechsel",
  forward_beleg: "Beleg an Lexoffice weiterleiten",
};

/** Standardstufen laut Konzept (Abschnitt „Autopilot-Stufen"). */
export const AUTOPILOT_DEFAULTS: Autopilot = {
  move_folders: "auto",
  move_discard: "auto",
  move_answered: "auto",
  keywords: "auto",
  log_certain: "auto",
  log_assumed: "suggest",
  attachments: "suggest",
  draft: "auto",
  create_project: "suggest",
  prepare_offer: "suggest",
  status_change: "suggest",
  forward_beleg: "off",
};

export const CONFIDENCE_AUTO_MIN = 0.7;

export type FolderKey =
  | "kunden" | "lieferanten" | "belege" | "ausschreibungen" | "verwaltung" | "newsletter" | "system" | "belegabholung" | "aussortiert";
export const FOLDER_KEYS: FolderKey[] = [
  "kunden", "lieferanten", "belege", "ausschreibungen", "verwaltung", "newsletter", "system", "belegabholung", "aussortiert",
];
export type FolderNames = Record<FolderKey, string>;

export const DEFAULT_FOLDER_NAMES: FolderNames = {
  kunden: "1 Kunden & Projekte",
  lieferanten: "2 Lieferanten & Bestellungen",
  belege: "3 Belege & Rechnungen",
  ausschreibungen: "4 Ausschreibungen",
  verwaltung: "5 Verwaltung",
  newsletter: "6 Newsletter & Infos",
  system: "7 System",
  belegabholung: "8 Belege abholen (Portal)",
  aussortiert: "9 Aussortiert",
};

/** Pfade im Postfach (Sonderordner ueber IMAP-Kennzeichen erkannt, Zielordner angelegt). */
export interface FolderMap {
  inbox?: string;
  sent?: string;
  drafts?: string;
  trash?: string;
  folders?: Partial<FolderNames>;
}
