import { supabase } from '@/integrations/supabase/client';
import {
  SignPlanData, SignRecord, SignCollection,
  SignArrowDirection, SignBuilding, SignDestination, SignFloor, SignFloorPlanLink,
  SignLabelLine, SignPlanMarker, SignPosition, SignPositionStatus, SignPositionType,
  SignQrToken, SignType,
} from '@/types/signPlan';
import {
  loadSignPlan, saveSignPlan, getLastSyncedAt, setLastSyncedAt, getSignPlanProjectIds,
} from './signPlanStorage';
import { isLeitsystemEnabled } from './featureFlags';
import { mergeCollection, pruneTombstones, time } from './signPlanMerge';

/**
 * Sync des Leitsystem-Bestands zwischen IndexedDB und Supabase.
 *
 * Anders als der Projekt-Sync entscheidet dieser hier PRO DATENSATZ, nicht
 * pro Projekt: verglichen wird `updatedAt` gegen `updated_at`. Wer an
 * Position 12 arbeitet, waehrend jemand anderes Position 40 aendert, verliert
 * nichts. Nur wenn zwei Leute DENSELBEN Datensatz anfassen, gilt weiterhin
 * last-write-wins.
 *
 * Loeschungen laufen ueber Grabsteine (`deletedAt`). Ein Datensatz, der
 * remote fehlt, lokal aber existiert, wird nur dann hochgeladen, wenn er
 * juenger ist als der letzte erfolgreiche Sync – sonst wurde er in der
 * Zwischenzeit von jemand anderem geloescht und verschwindet auch lokal.
 */

// Die generierten Supabase-Typen (src/integrations/supabase/types.ts) kennen
// die sign_*-Tabellen noch nicht. Denselben Weg geht supabaseSync.ts bereits
// fuer floor_plans, bis die Typen neu generiert werden.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Row = Record<string, unknown>;

// ─── Tabellen-Zuordnung ─────────────────────────────────────────────────────

interface CollectionSpec<T extends SignRecord = SignRecord> {
  collection: SignCollection;
  table: string;
  toRow: (record: T, projectId: string) => Row;
  fromRow: (row: Row, projectId: string) => T;
}

/** Behaelt die konkrete Typisierung je Sammlung, liefert aber eine
 *  einheitliche Liste, ueber die der Sync laufen kann. */
function defineSpec<T extends SignRecord>(spec: CollectionSpec<T>): CollectionSpec {
  return spec as unknown as CollectionSpec;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const id = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const bool = (value: unknown): boolean => value === true;

function baseRow(record: SignRecord, projectId: string): Row {
  return {
    id: record.id,
    project_id: projectId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function baseRecord(row: Row, projectId: string): SignRecord {
  return {
    id: str(row.id),
    projectId,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    deletedAt: null,
  };
}

/**
 * Reihenfolge ist Fremdschluessel-Reihenfolge: erst das, worauf andere
 * zeigen. Geloescht wird in umgekehrter Richtung.
 */
const SPECS: CollectionSpec[] = [
  defineSpec<SignBuilding>({
    collection: 'buildings',
    table: 'sign_buildings',
    toRow: (r, p) => ({ ...baseRow(r, p), name: r.name, sort_order: r.sortOrder }),
    fromRow: (row, p) => ({ ...baseRecord(row, p), name: str(row.name), sortOrder: num(row.sort_order) ?? 0 }),
  }),
  defineSpec<SignFloor>({
    collection: 'floors',
    table: 'sign_floors',
    toRow: (r, p) => ({ ...baseRow(r, p), building_id: r.buildingId, name: r.name, code: r.code, level: r.level }),
    fromRow: (row, p) => ({
      ...baseRecord(row, p),
      buildingId: id(row.building_id),
      name: str(row.name),
      code: str(row.code),
      level: num(row.level) ?? 0,
    }),
  }),
  defineSpec<SignFloorPlanLink>({
    collection: 'floorPlanLinks',
    table: 'sign_floor_plan_links',
    toRow: (r, p) => ({ ...baseRow(r, p), floor_plan_id: r.floorPlanId, floor_id: r.floorId }),
    fromRow: (row, p) => ({ ...baseRecord(row, p), floorPlanId: str(row.floor_plan_id), floorId: str(row.floor_id) }),
  }),
  defineSpec<SignType>({
    collection: 'types',
    table: 'sign_types',
    toRow: (r, p) => ({
      ...baseRow(r, p),
      code: r.code,
      name: r.name,
      width_mm: r.widthMm,
      height_mm: r.heightMm,
      material: r.material || null,
      mounting: r.mounting || null,
      unit_price: r.unitPrice,
      description_neutral: r.descriptionNeutral || null,
      manufacturer: r.manufacturer || null,
      article_number: r.articleNumber || null,
      color: r.color,
      sort_order: r.sortOrder,
    }),
    fromRow: (row, p) => ({
      ...baseRecord(row, p),
      code: str(row.code),
      name: str(row.name),
      widthMm: num(row.width_mm),
      heightMm: num(row.height_mm),
      material: str(row.material),
      mounting: str(row.mounting),
      unitPrice: num(row.unit_price),
      descriptionNeutral: str(row.description_neutral),
      manufacturer: str(row.manufacturer),
      articleNumber: str(row.article_number),
      color: str(row.color) || '#2563eb',
      sortOrder: num(row.sort_order) ?? 0,
    }),
  }),
  defineSpec<SignPosition>({
    collection: 'positions',
    table: 'sign_positions',
    toRow: (r, p) => ({
      ...baseRow(r, p),
      floor_id: r.floorId,
      position_number: r.positionNumber,
      title: r.title || null,
      status: r.status,
      is_addition: r.isAddition,
      note: r.note || null,
      location_id: r.locationId,
    }),
    fromRow: (row, p) => ({
      ...baseRecord(row, p),
      floorId: id(row.floor_id),
      positionNumber: str(row.position_number),
      title: str(row.title),
      status: (str(row.status) || 'geplant') as SignPositionStatus,
      isAddition: bool(row.is_addition),
      note: str(row.note),
      locationId: id(row.location_id),
    }),
  }),
  defineSpec<SignPositionType>({
    collection: 'positionTypes',
    table: 'sign_position_types',
    toRow: (r, p) => ({ ...baseRow(r, p), position_id: r.positionId, sign_type_id: r.signTypeId, quantity: r.quantity }),
    fromRow: (row, p) => ({
      ...baseRecord(row, p),
      positionId: str(row.position_id),
      signTypeId: str(row.sign_type_id),
      quantity: num(row.quantity) ?? 1,
    }),
  }),
  defineSpec<SignPlanMarker>({
    collection: 'markers',
    table: 'sign_plan_markers',
    toRow: (r, p) => ({ ...baseRow(r, p), floor_plan_id: r.floorPlanId, position_id: r.positionId, x: r.x, y: r.y }),
    fromRow: (row, p) => ({
      ...baseRecord(row, p),
      floorPlanId: str(row.floor_plan_id),
      positionId: str(row.position_id),
      x: num(row.x) ?? 0,
      y: num(row.y) ?? 0,
    }),
  }),
  defineSpec<SignDestination>({
    collection: 'destinations',
    table: 'sign_destinations',
    toRow: (r, p) => ({ ...baseRow(r, p), name: r.name, name_secondary: r.nameSecondary || null, sort_order: r.sortOrder }),
    fromRow: (row, p) => ({
      ...baseRecord(row, p),
      name: str(row.name),
      nameSecondary: str(row.name_secondary),
      sortOrder: num(row.sort_order) ?? 0,
    }),
  }),
  defineSpec<SignLabelLine>({
    collection: 'labelLines',
    table: 'sign_label_lines',
    toRow: (r, p) => ({
      ...baseRow(r, p),
      position_type_id: r.positionTypeId,
      sort_order: r.sortOrder,
      destination_id: r.destinationId,
      text_override: r.textOverride || null,
      text_secondary: r.textSecondary || null,
      arrow: r.arrow,
      pictogram: r.pictogram || null,
      is_tactile: r.isTactile,
      is_braille: r.isBraille,
    }),
    fromRow: (row, p) => ({
      ...baseRecord(row, p),
      positionTypeId: str(row.position_type_id),
      sortOrder: num(row.sort_order) ?? 0,
      destinationId: id(row.destination_id),
      textOverride: str(row.text_override),
      textSecondary: str(row.text_secondary),
      arrow: (str(row.arrow) || 'none') as SignArrowDirection,
      pictogram: str(row.pictogram),
      isTactile: bool(row.is_tactile),
      isBraille: bool(row.is_braille),
    }),
  }),
  defineSpec<SignQrToken>({
    collection: 'qrTokens',
    table: 'sign_qr_tokens',
    toRow: (r, p) => ({ ...baseRow(r, p), position_id: r.positionId, token: r.token }),
    fromRow: (row, p) => ({ ...baseRecord(row, p), positionId: str(row.position_id), token: str(row.token) }),
  }),
];

// ─── Oeffentliche API ───────────────────────────────────────────────────────

export type SignSyncResult = 'synced' | 'skipped' | 'offline';

async function hasLocalSignPlan(projectId: string): Promise<boolean> {
  const ids = await getSignPlanProjectIds();
  return ids.includes(projectId);
}

/**
 * Gleicht den Leitsystem-Bestand eines Projekts mit Supabase ab.
 */
export async function syncSignPlanProject(projectId: string): Promise<SignSyncResult> {
  // Ohne Flag und ohne lokale Daten gibt es nichts abzugleichen – dann sparen
  // wir uns zehn Abfragen pro Projekt bei allen, die den Prototyp nicht nutzen.
  if (!isLeitsystemEnabled() && !(await hasLocalSignPlan(projectId))) return 'skipped';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';

  const local = await loadSignPlan(projectId);
  const lastSyncedAt = time(await getLastSyncedAt(projectId));

  // 1. Remote-Stand holen.
  const remoteByCollection = new Map<SignCollection, SignRecord[]>();
  for (const spec of SPECS) {
    const { data, error } = await db.from(spec.table).select('*').eq('project_id', projectId);
    if (error) throw error;
    remoteByCollection.set(
      spec.collection,
      ((data || []) as Row[]).map((row) => spec.fromRow(row, projectId)),
    );
  }

  // 2. Pro Sammlung zusammenfuehren.
  const merged: SignPlanData = { ...local };
  const mergedTarget = merged as unknown as Record<SignCollection, SignRecord[]>;
  const localSource = local as unknown as Record<SignCollection, SignRecord[]>;
  const uploads = new Map<SignCollection, SignRecord[]>();
  const deletes = new Map<SignCollection, string[]>();

  for (const spec of SPECS) {
    const plan = mergeCollection(
      localSource[spec.collection] || [],
      remoteByCollection.get(spec.collection) || [],
      lastSyncedAt,
    );
    mergedTarget[spec.collection] = plan.merged;
    uploads.set(spec.collection, plan.toUpload);
    deletes.set(spec.collection, plan.toDelete);
  }

  // 3. Loeschungen zuerst, in umgekehrter Fremdschluessel-Reihenfolge.
  for (const spec of [...SPECS].reverse()) {
    const ids = deletes.get(spec.collection) || [];
    if (ids.length === 0) continue;
    const { error } = await db.from(spec.table).delete().in('id', ids);
    if (error) throw error;
  }

  // 4. Uploads in Fremdschluessel-Reihenfolge.
  for (const spec of SPECS) {
    const records = uploads.get(spec.collection) || [];
    const rows = records.filter((record) => !record.deletedAt).map((record) => spec.toRow(record, projectId));
    if (rows.length === 0) continue;
    const { error } = await db.from(spec.table).upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  pruneTombstones(merged);
  await saveSignPlan(projectId, merged);
  await setLastSyncedAt(projectId, new Date().toISOString());
  return 'synced';
}

/**
 * Wie oben, schluckt aber jeden Fehler. So aufgerufen aus dem Projekt-Sync:
 * ein Problem im Prototyp darf den produktiven Sync nie zum Stehen bringen.
 */
export async function syncSignPlanProjectSafely(projectId: string): Promise<void> {
  try {
    await syncSignPlanProject(projectId);
  } catch (error) {
    console.warn(`Leitsystem-Sync fuer Projekt ${projectId} fehlgeschlagen:`, error);
  }
}
