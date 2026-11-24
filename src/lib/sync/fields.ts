/**
 * Sync v2 – reine Feldlogik (ohne IndexedDB/Netz, darum gut testbar).
 *
 * Jede Einheit (Projekt, Standort, Detailbild, Grundriss) wird als flache
 * Feldliste betrachtet: Spalten heissen wie in Supabase, Zusatzfelder als
 * "cf.<schluessel>" (custom_fields). Der Client merkt sich pro Einheit die
 * zuletzt vom Server bestaetigte Fassung ("base"). Damit gilt:
 *
 *   lokal != base           → hier geaendert, muss hoch
 *   server != base          → woanders geaendert, muss runter
 *   beides, unterschiedlich → echter Konflikt, der Mitarbeiter entscheidet
 *
 * Der Server prueft beim Hochladen dasselbe noch einmal atomar (sync_push),
 * falls zwischen Laden und Hochladen jemand anders gespeichert hat.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type FieldMap = Record<string, Json>;
export type SyncKind = "project" | "location" | "detail" | "floor_plan";

/** Leere Werte sind gleich: undefined, null und "" (wie sync_norm auf dem Server). */
export function norm(v: unknown): Json {
  if (v === undefined || v === null || v === "") return null;
  return v as Json;
}

function stable(v: unknown): string {
  const n = norm(v);
  if (n === null || typeof n !== "object") return JSON.stringify(n);
  if (Array.isArray(n)) return `[${n.map(stable).join(",")}]`;
  return `{${Object.keys(n).sort().map((k) => `${JSON.stringify(k)}:${stable((n as any)[k])}`).join(",")}}`;
}

export function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function addCustom(out: FieldMap, custom: unknown) {
  if (!custom || typeof custom !== "object") return;
  for (const [k, v] of Object.entries(custom as Record<string, unknown>)) {
    const n = norm(v);
    if (n !== null) out[`cf.${k}`] = n;
  }
}

function parseMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return undefined; }
}

// ── Lokal (IndexedDB-Datensaetze) → Felder ───────────────────────────────────

export function projectFieldsFromLocal(r: any): FieldMap {
  const out: FieldMap = {
    project_number: norm(r.projectNumber),
    project_type: norm(r.projectType),
    customer_name: norm(r.customerName),
  };
  addCustom(out, parseMaybe(r.customFields));
  return out;
}

export function locationFieldsFromLocal(r: any): FieldMap {
  const out: FieldMap = {
    location_number: norm(r.locationNumber),
    location_name: norm(r.locationName),
    comment: norm(r.comment),
    system: norm(r.system),
    label: norm(r.label),
    location_type: norm(r.locationType),
    guest_info: norm(r.guestInfo),
  };
  addCustom(out, parseMaybe(r.customFields));
  const area = parseMaybe(r.areaMeasurements);
  if (Array.isArray(area) && area.length > 0) out["cf.__areaMeasurements"] = area as Json;
  return out;
}

export function detailFieldsFromLocal(r: any): FieldMap {
  return { caption: norm(r.caption) };
}

export function floorPlanFieldsFromLocal(r: any): FieldMap {
  return {
    name: norm(r.name),
    page_index: typeof r.pageIndex === "number" ? r.pageIndex : null,
    markers: (parseMaybe(r.markers) as Json) ?? [],
  };
}

// ── Server-Zeilen → Felder ───────────────────────────────────────────────────

export function projectFieldsFromRow(row: any): FieldMap {
  const out: FieldMap = {
    project_number: norm(row.project_number),
    project_type: norm(row.project_type),
    customer_name: norm(row.customer_name),
  };
  addCustom(out, row.custom_fields);
  return out;
}

export function locationFieldsFromRow(row: any): FieldMap {
  const out: FieldMap = {
    location_number: norm(row.location_number),
    location_name: norm(row.location_name),
    comment: norm(row.comment),
    system: norm(row.system),
    label: norm(row.label),
    location_type: norm(row.location_type),
    guest_info: norm(row.guest_info),
  };
  addCustom(out, row.custom_fields);
  const area = out["cf.__areaMeasurements"];
  if (Array.isArray(area) && area.length === 0) delete out["cf.__areaMeasurements"];
  return out;
}

export function detailFieldsFromRow(row: any): FieldMap {
  return { caption: norm(row.caption) };
}

export function floorPlanFieldsFromRow(row: any): FieldMap {
  return {
    name: norm(row.name),
    page_index: typeof row.page_index === "number" ? row.page_index : null,
    markers: Array.isArray(row.markers) ? row.markers : [],
  };
}

export const fieldsFromLocal: Record<SyncKind, (r: any) => FieldMap> = {
  project: projectFieldsFromLocal,
  location: locationFieldsFromLocal,
  detail: detailFieldsFromLocal,
  floor_plan: floorPlanFieldsFromLocal,
};

export const fieldsFromRow: Record<SyncKind, (r: any) => FieldMap> = {
  project: projectFieldsFromRow,
  location: locationFieldsFromRow,
  detail: detailFieldsFromRow,
  floor_plan: floorPlanFieldsFromRow,
};

// ── Felder → lokale Datensaetze ──────────────────────────────────────────────

function customFrom(fields: FieldMap, skip: string[] = []): Record<string, Json> | undefined {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!k.startsWith("cf.")) continue;
    const key = k.slice(3);
    if (skip.includes(key) || v === null) continue;
    out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const text = (v: Json) => (v === null ? undefined : String(v));

/** Schreibt Felder in einen lokalen Projekt-Datensatz (IndexedDB-Form). */
export function applyProjectFields(record: any, f: FieldMap): any {
  const custom = customFrom(f);
  return {
    ...record,
    projectNumber: text(f.project_number) ?? record.projectNumber ?? "",
    projectType: (text(f.project_type) as any) ?? record.projectType,
    customerName: text(f.customer_name),
    customFields: custom ? JSON.stringify(custom) : undefined,
  };
}

/** Schreibt Felder in einen lokalen Standort-Datensatz (IndexedDB-Form). */
export function applyLocationFields(record: any, f: FieldMap): any {
  const custom = customFrom(f, ["__areaMeasurements"]);
  const area = f["cf.__areaMeasurements"];
  return {
    ...record,
    locationNumber: text(f.location_number) ?? record.locationNumber ?? "",
    locationName: text(f.location_name),
    comment: text(f.comment),
    system: text(f.system),
    label: text(f.label),
    locationType: text(f.location_type),
    guestInfo: text(f.guest_info),
    customFields: custom ? JSON.stringify(custom) : undefined,
    areaMeasurements: Array.isArray(area) && area.length > 0 ? JSON.stringify(area) : undefined,
  };
}

export function applyDetailFields(record: any, f: FieldMap): any {
  return { ...record, caption: text(f.caption) };
}

export function applyFloorPlanFields(record: any, f: FieldMap): any {
  return {
    ...record,
    name: text(f.name) ?? record.name ?? "",
    pageIndex: typeof f.page_index === "number" ? f.page_index : record.pageIndex ?? 0,
    markers: JSON.stringify(Array.isArray(f.markers) ? f.markers : []),
  };
}

export const applyFields: Record<SyncKind, (record: any, f: FieldMap) => any> = {
  project: applyProjectFields,
  location: applyLocationFields,
  detail: applyDetailFields,
  floor_plan: applyFloorPlanFields,
};

// ── Vergleichen ──────────────────────────────────────────────────────────────

function keysOf(...maps: FieldMap[]): string[] {
  const s = new Set<string>();
  for (const m of maps) for (const k of Object.keys(m)) s.add(k);
  return [...s];
}

/** Lokale Aenderungen gegenueber base, im Format von sync_push. */
export function diffForPush(local: FieldMap, base: FieldMap, skip: Set<string> = new Set()): Record<string, { base: Json; value: Json }> {
  const out: Record<string, { base: Json; value: Json }> = {};
  for (const k of keysOf(local, base)) {
    if (skip.has(k)) continue;
    const l = norm(local[k]);
    const b = norm(base[k]);
    if (!same(l, b)) out[k] = { base: b, value: l };
  }
  return out;
}

export interface MergeResult {
  /** Neuer lokaler Stand. */
  local: FieldMap;
  /** Felder, die hier UND dort unterschiedlich geaendert wurden. */
  conflicts: { field: string; mine: Json; theirs: Json }[];
  /** Hat sich am lokalen Stand etwas geaendert (Anzeige neu laden)? */
  changed: boolean;
}

/**
 * Dreiwege-Abgleich beim Herunterladen.
 * Grundriss-Markierungen werden nie als Konflikt gemeldet, sondern nach id
 * zusammengefuehrt (wie sync_merge_markers auf dem Server).
 */
export function mergeIncoming(local: FieldMap, base: FieldMap, remote: FieldMap): MergeResult {
  const out: FieldMap = {};
  const conflicts: MergeResult["conflicts"] = [];
  let changed = false;
  for (const k of keysOf(local, base, remote)) {
    const l = norm(local[k]);
    const b = norm(base[k]);
    const r = norm(remote[k]);
    let v: Json;
    if (same(l, b)) v = r;                 // hier unveraendert → Server
    else if (same(r, b) || same(l, r)) v = l; // nur hier geaendert / gleich
    else if (k === "markers") v = mergeMarkers(b, l, r);
    else { v = l; conflicts.push({ field: k, mine: l, theirs: r }); }
    if (v !== null) out[k] = v;
    if (!same(v, l)) changed = true;
  }
  return { local: out, conflicts, changed };
}

/** Markierungen nach id: hier Entferntes raus, hier Neues/Geaendertes rein. */
export function mergeMarkers(base: Json, mine: Json, cur: Json): Json {
  const arr = (v: Json) => (Array.isArray(v) ? (v as any[]) : []);
  const b = arr(base), m = arr(mine), c = arr(cur);
  const baseById = new Map(b.map((x) => [x?.id, x]));
  const mineIds = new Set(m.map((x) => x?.id));
  const removed = new Set(b.filter((x) => !mineIds.has(x?.id)).map((x) => x?.id));
  const touched = m.filter((x) => !baseById.has(x?.id) || !same(baseById.get(x?.id), x));
  const touchedIds = new Set(touched.map((x) => x?.id));
  return [...c.filter((x) => !removed.has(x?.id) && !touchedIds.has(x?.id)), ...touched];
}

// ── Anzeige ──────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  project_number: "Projektnummer",
  project_type: "Projektart",
  customer_name: "Kunde",
  location_number: "Standortnummer",
  location_name: "Bezeichnung",
  comment: "Kommentar",
  system: "System",
  label: "Beschriftung",
  location_type: "Art",
  guest_info: "Info vom Kunden",
  caption: "Bildbeschreibung",
  name: "Name",
  page_index: "Seite",
  markers: "Markierungen",
  "cf.__areaMeasurements": "Flächenmaße",
  "image.annotated": "Foto (bemaßt)",
  "image.original": "Foto (Original)",
  deleted: "Gelöscht",
};

export function fieldLabel(field: string, customLabels: Record<string, string> = {}): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  if (field.startsWith("cf.")) return customLabels[field.slice(3)] || field.slice(3);
  return field;
}

export function displayValue(v: Json): string {
  if (v === null || v === undefined) return "(leer)";
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((x) => x && typeof x === "object" && "widthMm" in (x as any))) {
    return (v as any[]).map((x) => `${x.widthMm} × ${x.heightMm} mm`).join(", ");
  }
  return JSON.stringify(v);
}
