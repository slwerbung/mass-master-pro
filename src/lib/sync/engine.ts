/**
 * Sync v2 – Engine (Nov. 2026).
 *
 * Grundsatz: LOKAL ZUERST. Jede Aenderung landet sofort in IndexedDB, die App
 * funktioniert ohne Netz vollstaendig (Gebaeude ohne Empfang). Die Engine
 * gleicht im Hintergrund ab, sobald Netz da ist und die App ruhig ist
 * (quietTime: nicht bei offener Kamera/Editor).
 *
 * Abgleich pro Einheit (Projekt, Standort, Detailbild, Grundriss) mit der
 * zuletzt vom Server bestaetigten Fassung ("base", Store `sync-base`):
 *
 *  Hochladen (push):  nur Felder, die lokal von base abweichen, jeweils mit
 *                     dem base-Wert. Der Server (sync_push) uebernimmt sie
 *                     nur, wenn dort seitdem niemand dasselbe Feld geaendert
 *                     hat → sonst Konflikt, der Mitarbeiter entscheidet.
 *  Bilder:            neue Fassung = neuer Pfad. sync_set_image setzt ihn nur,
 *                     wenn der Server noch die base-Fassung hat.
 *  Herunterladen:     Dreiwege-Abgleich (mergeIncoming). Was hier nicht
 *                     geaendert wurde, kommt vom Server; Bilder werden ersetzt,
 *                     sobald sich ihr Pfad auf dem Server aendert.
 *  Live:              Realtime auf projects/locations/floor_plans → das offene
 *                     Projekt wird sofort nachgeladen.
 *
 * Ein Bild-Blob ohne `path` ist hier neu bzw. geaendert. Jede Schreibstelle
 * in indexedDBStorage legt Blobs ohne `path` an – dadurch erkennt die Engine
 * neue Fotos ohne zusaetzliche Buchfuehrung.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  getSyncDB,
  createImageId,
  createDetailBlobId,
  type AufmassDB,
  type SyncBaseRecord,
  type SyncConflictRecord,
} from "@/lib/indexedDBStorage";
import { waitForQuiet } from "@/lib/quietTime";
import { finishSyncError, finishSyncSuccess, startSync, updateSyncState } from "@/lib/syncStatus";
import { signedFileUrl } from "@/lib/storageUrl";
import { getSession } from "@/lib/session";
import {
  applyFields,
  diffForPush,
  fieldsFromLocal,
  fieldsFromRow,
  mergeIncoming,
  mergeMarkers,
  same,
  type FieldMap,
  type Json,
  type SyncKind,
} from "./fields";

const BUCKET = "project-files";
const DIRTY_KEY = "mmp_sync_dirty_v2";
const LEGACY_TOMBSTONE_KEY = "mmp_deleted_v1";
/** Kennzeichnet Altbestand-Blobs (vor Sync v2) – nicht "geaendert", aber zu ersetzen. */
const LEGACY_PATH = "legacy:";

type Slot = "annotated" | "original";
const SLOTS: Slot[] = ["annotated", "original"];

// ─── Ereignisse fuer die Oberflaeche ────────────────────────────────────────

export const syncEvents = new EventTarget();

function emitProject(projectId: string) {
  syncEvents.dispatchEvent(new CustomEvent("project-updated", { detail: { projectId } }));
}
function emitConflicts(projectId: string) {
  syncEvents.dispatchEvent(new CustomEvent("conflicts-changed", { detail: { projectId } }));
}

/** Seite neu laden, wenn sich dieses Projekt lokal durch den Abgleich geaendert hat. */
export function onProjectUpdated(projectId: string, cb: () => void): () => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  const handler = (e: Event) => {
    if ((e as CustomEvent).detail?.projectId !== projectId) return;
    if (t) clearTimeout(t);
    t = setTimeout(cb, 250);
  };
  syncEvents.addEventListener("project-updated", handler);
  return () => { if (t) clearTimeout(t); syncEvents.removeEventListener("project-updated", handler); };
}

export function onConflictsChanged(cb: (projectId: string) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail?.projectId);
  syncEvents.addEventListener("conflicts-changed", handler);
  return () => syncEvents.removeEventListener("conflicts-changed", handler);
}

// ─── Hilfen ─────────────────────────────────────────────────────────────────

const bkey = (kind: SyncKind, id: string) => `${kind}:${id}`;

function isNetworkError(e: unknown): boolean {
  const msg = String((e as any)?.message || e || "");
  return typeof navigator !== "undefined" && !navigator.onLine
    || /fetch|network|Failed to fetch|NetworkError|Load failed|timeout/i.test(msg);
}

class SyncError extends Error {}

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw new SyncError(error.message || String(error));
  return data as T;
}

function readTombstones(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_TOMBSTONE_KEY) || "{}");
    return new Set([...(raw.locations || []), ...(raw.details || [])]);
  } catch { return new Set(); }
}

function newImagePath(kind: "location" | "detail" | "floor_plan", ownerId: string, slot: string, locationId?: string): string {
  const v = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (kind === "location") return `images/${ownerId}/${slot}-${v}.jpg`;
  if (kind === "detail") return `detail-images/${locationId}/${ownerId}/${slot}-${v}.jpg`;
  return `floor-plans/${locationId}/${ownerId}-${v}.jpg`; // locationId = Projekt
}

async function uploadBlob(path: string, blob: Blob): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error && !/exists|Duplicate/i.test(error.message || "")) throw new SyncError(error.message);
}

async function removePaths(paths: (string | null | undefined)[]) {
  const list = [...new Set(paths.filter((p): p is string => !!p && !p.startsWith(LEGACY_PATH)))];
  if (list.length === 0) return;
  try { await supabase.storage.from(BUCKET).remove(list); } catch { /* Aufraeumen ist optional */ }
}

async function getConflictFields(db: AufmassDB, kind: SyncKind, id: string): Promise<Set<string>> {
  const all = await db.getAllFromIndex("sync-conflicts", "by-project", (await projectOf(db, kind, id)) || "");
  return new Set(all.filter((c) => c.kind === kind && c.id === id).map((c) => c.field));
}

async function projectOf(db: AufmassDB, kind: SyncKind, id: string): Promise<string | null> {
  const base = await db.get("sync-base", bkey(kind, id));
  if (base) return base.projectId;
  if (kind === "project") return id;
  if (kind === "location") return (await db.get("locations", id))?.projectId ?? null;
  if (kind === "floor_plan") return (await db.get("floor-plans", id))?.projectId ?? null;
  const d = await db.get("detail-images", id);
  return d ? (await db.get("locations", d.locationId))?.projectId ?? null : null;
}

async function putConflict(db: AufmassDB, c: Omit<SyncConflictRecord, "key" | "createdAt">) {
  const key = `${c.kind}:${c.id}:${c.field}`;
  const existing = await db.get("sync-conflicts", key);
  await db.put("sync-conflicts", { ...c, key, createdAt: existing?.createdAt ?? Date.now() });
}

// ─── Lokale Datensaetze lesen/schreiben ─────────────────────────────────────

const STORE: Record<SyncKind, "projects" | "locations" | "detail-images" | "floor-plans"> = {
  project: "projects",
  location: "locations",
  detail: "detail-images",
  floor_plan: "floor-plans",
};

async function writeLocalFields(db: AufmassDB, kind: SyncKind, id: string, fields: FieldMap) {
  const rec = await db.get(STORE[kind] as any, id);
  if (!rec) return;
  await db.put(STORE[kind] as any, applyFields[kind](rec, fields));
}

function blobStoreFor(kind: SyncKind): "images" | "detail-image-blobs" | "floor-plan-images" {
  return kind === "location" ? "images" : kind === "detail" ? "detail-image-blobs" : "floor-plan-images";
}
function blobIdFor(kind: SyncKind, id: string, slot: string): string {
  if (kind === "location") return createImageId(id, slot as Slot);
  if (kind === "detail") return createDetailBlobId(id, slot as Slot);
  return id;
}

async function getBlobRec(db: AufmassDB, kind: SyncKind, id: string, slot: string): Promise<{ blob: Blob; path?: string } | undefined> {
  return (await db.get(blobStoreFor(kind) as any, blobIdFor(kind, id, slot))) as any;
}

async function setBlobPath(db: AufmassDB, kind: SyncKind, id: string, slot: string, path: string, expectedBlob: Blob) {
  const rec: any = await db.get(blobStoreFor(kind) as any, blobIdFor(kind, id, slot));
  // Nur wenn das Bild inzwischen nicht erneut geaendert wurde. IndexedDB
  // liefert bei jedem Lesen eine Kopie – darum Vergleich ueber Groesse/Typ
  // (ein neu gespeichertes JPEG hat praktisch nie exakt dieselbe Groesse).
  if (rec && !rec.path && rec.blob?.size === expectedBlob.size && rec.blob?.type === expectedBlob.type) {
    await db.put(blobStoreFor(kind) as any, { ...rec, path });
  }
}

/** Lokal geaendertes Bild (Blob ohne Serverpfad)? */
const isDirtyBlob = (rec?: { path?: string }) => !!rec && !rec.path;

// ─── Bild-Downloads (Hintergrund, max. 2 gleichzeitig) ──────────────────────

interface DownloadJob { kind: SyncKind; id: string; slot: string; path: string; projectId: string; parentId: string; priority: number }
const downloadQueue: DownloadJob[] = [];
const downloadKeys = new Set<string>();
let downloadsRunning = 0;

function queueDownload(job: DownloadJob) {
  const key = `${job.kind}:${job.id}:${job.slot}:${job.path}`;
  if (downloadKeys.has(key)) return;
  downloadKeys.add(key);
  downloadQueue.push(job);
  downloadQueue.sort((a, b) => a.priority - b.priority);
  pumpDownloads();
}

function pumpDownloads() {
  while (downloadsRunning < 2 && downloadQueue.length > 0) {
    const job = downloadQueue.shift()!;
    downloadsRunning++;
    runDownload(job).finally(() => {
      downloadsRunning--;
      downloadKeys.delete(`${job.kind}:${job.id}:${job.slot}:${job.path}`);
      pumpDownloads();
    });
  }
  updatePendingState();
}

async function runDownload(job: DownloadJob) {
  try {
    await waitForQuiet();
    const db = await getSyncDB();
    const current = await getBlobRec(db, job.kind, job.id, job.slot);
    if (isDirtyBlob(current) || current?.path === job.path) return; // hier geaendert bzw. schon da
    const url = await signedFileUrl(job.path);
    if (!url) return;
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const again = await getBlobRec(db, job.kind, job.id, job.slot);
    if (isDirtyBlob(again)) return;
    // Gibt es den Eigentuemer noch?
    if (!(await db.get(STORE[job.kind] as any, job.id))) return;
    const store = blobStoreFor(job.kind);
    const rec: any = job.kind === "location"
      ? { id: blobIdFor("location", job.id, job.slot), locationId: job.id, type: job.slot, blob, path: job.path }
      : job.kind === "detail"
        ? { id: blobIdFor("detail", job.id, job.slot), detailImageId: job.id, type: job.slot, blob, path: job.path }
        : { id: job.id, floorPlanId: job.id, blob, path: job.path };
    await db.put(store as any, rec);
    emitProject(job.projectId);
  } catch {
    /* naechster Abgleich versucht es erneut */
  }
}

async function removeLocalBlob(db: AufmassDB, kind: SyncKind, id: string, slot: string) {
  await db.delete(blobStoreFor(kind) as any, blobIdFor(kind, id, slot));
}

/** Fuer Tests/Anzeige: warten, bis alle Bild-Downloads durch sind. */
export async function downloadsIdle(): Promise<void> {
  while (downloadQueue.length > 0 || downloadsRunning > 0) await new Promise((r) => setTimeout(r, 20));
}

// ─── Herunterladen (pull) ───────────────────────────────────────────────────

interface RemoteSnapshot {
  project: any | null;
  accessIds: string[];
  locations: any[];
  locationImages: any[];
  details: any[];
  floorPlans: any[];
}

async function fetchRemote(projectId: string): Promise<RemoteSnapshot> {
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, project_number, project_type, customer_name, custom_fields, employee_id, created_at, updated_at, revision, archived_at, compacted_at")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new SyncError(error.message);
  if (!project) return { project: null, accessIds: [], locations: [], locationImages: [], details: [], floorPlans: [] };

  const [locs, assigns, fps] = await Promise.all([
    supabase.from("locations")
      .select("id, project_id, location_number, location_name, comment, system, label, location_type, guest_info, custom_fields, created_at, updated_at, revision")
      .eq("project_id", projectId),
    (supabase as any).from("project_employee_assignments").select("employee_id").eq("project_id", projectId),
    (supabase as any).from("floor_plans").select("id, project_id, name, storage_path, page_index, markers, created_at, revision").eq("project_id", projectId),
  ]);
  if (locs.error) throw new SyncError(locs.error.message);
  if (fps.error) throw new SyncError(fps.error.message);
  const ids = (locs.data || []).map((l: any) => l.id);
  let locationImages: any[] = [];
  let details: any[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const [li, di] = await Promise.all([
      supabase.from("location_images").select("location_id, image_type, storage_path").in("location_id", chunk),
      supabase.from("detail_images").select("id, location_id, caption, annotated_path, original_path, created_at, revision").in("location_id", chunk),
    ]);
    if (li.error) throw new SyncError(li.error.message);
    if (di.error) throw new SyncError(di.error.message);
    locationImages = locationImages.concat(li.data || []);
    details = details.concat(di.data || []);
  }
  const accessIds = [...new Set([(project as any).employee_id, ...((assigns.data || []) as any[]).map((a) => a.employee_id)].filter(Boolean))] as string[];
  return { project, accessIds, locations: locs.data || [], locationImages, details, floorPlans: fps.data || [] };
}

const pulling = new Map<string, Promise<boolean>>();

/**
 * Online-Fassung eines Projekts holen und mit dem lokalen Stand
 * zusammenfuehren. Gibt false zurueck, wenn das Projekt online nicht
 * (mehr) existiert bzw. nicht sichtbar ist.
 */
export function pullProject(projectId: string): Promise<boolean> {
  const running = pulling.get(projectId);
  if (running) return running;
  const p = pullProjectInternal(projectId).finally(() => pulling.delete(projectId));
  pulling.set(projectId, p);
  return p;
}

async function pullProjectInternal(projectId: string): Promise<boolean> {
  const remote = await fetchRemote(projectId);
  const db = await getSyncDB();
  if (!remote.project) return false;
  let changed = false;
  let conflictsChanged = false;
  const tomb = readTombstones();

  // ── Projekt ──
  const R = remote.project;
  const pBase = await db.get("sync-base", bkey("project", projectId));
  const pLocal = await db.get("projects", projectId);
  const rFields = fieldsFromRow.project(R);
  if (!pLocal) {
    await db.put("projects", applyFields.project({
      id: projectId,
      employeeId: R.employee_id ?? null,
      accessEmployeeIds: remote.accessIds,
      createdAt: R.created_at,
      updatedAt: R.updated_at,
    }, rFields));
    changed = true;
  } else {
    let localFields = fieldsFromLocal.project(pLocal);
    if (!pBase) {
      // Altbestand: lokal gesetzte, online leere Felder behalten.
      const adopted: FieldMap = { ...rFields };
      for (const [k, v] of Object.entries(localFields)) if (v !== null && (rFields[k] ?? null) === null) adopted[k] = v;
      localFields = adopted;
      await db.put("projects", { ...applyFields.project(pLocal, adopted), employeeId: R.employee_id ?? null, accessEmployeeIds: remote.accessIds });
      changed = true;
    } else if (pBase.revision !== R.revision) {
      const m = mergeIncoming(localFields, pBase.fields, rFields);
      for (const c of m.conflicts) { await putConflict(db, { projectId, kind: "project", id: projectId, field: c.field, mine: c.mine, theirs: c.theirs, label: "Projekt" }); conflictsChanged = true; }
      await db.put("projects", { ...applyFields.project(pLocal, m.local), employeeId: R.employee_id ?? null, accessEmployeeIds: remote.accessIds });
      changed = changed || m.changed;
    } else if (JSON.stringify(pLocal.accessEmployeeIds || []) !== JSON.stringify(remote.accessIds)) {
      await db.put("projects", { ...pLocal, employeeId: R.employee_id ?? null, accessEmployeeIds: remote.accessIds });
    }
  }
  await db.put("sync-base", { key: bkey("project", projectId), kind: "project", id: projectId, projectId, revision: R.revision ?? 0, fields: rFields, images: {} });

  // ── Standorte ──
  const imagesByLoc = new Map<string, Record<string, string>>();
  for (const li of remote.locationImages) {
    const m = imagesByLoc.get(li.location_id) || {};
    m[li.image_type] = li.storage_path;
    imagesByLoc.set(li.location_id, m);
  }
  const remoteLocIds = new Set(remote.locations.map((l) => l.id));
  for (const row of remote.locations) {
    const r = await pullEntity(db, "location", row, projectId, projectId, imagesByLoc.get(row.id) || {}, tomb);
    changed = changed || r.changed;
    conflictsChanged = conflictsChanged || r.conflicts;
  }

  // ── Detailbilder ──
  const remoteDetailIds = new Set(remote.details.map((d) => d.id));
  for (const row of remote.details) {
    const r = await pullEntity(db, "detail", row, projectId, row.location_id, { annotated: row.annotated_path, original: row.original_path }, tomb);
    changed = changed || r.changed;
    conflictsChanged = conflictsChanged || r.conflicts;
  }

  // ── Grundrisse ──
  const remoteFpIds = new Set(remote.floorPlans.map((f) => f.id));
  for (const row of remote.floorPlans) {
    const r = await pullEntity(db, "floor_plan", row, projectId, projectId, { image: row.storage_path }, tomb);
    changed = changed || r.changed;
  }

  // ── Online geloescht ──
  const bases = await db.getAllFromIndex("sync-base", "by-project", projectId);
  for (const b of bases) {
    const gone = (b.kind === "location" && !remoteLocIds.has(b.id))
      || (b.kind === "detail" && !remoteDetailIds.has(b.id))
      || (b.kind === "floor_plan" && !remoteFpIds.has(b.id));
    if (!gone) continue;
    const r = await handleRemoteDeletion(db, b);
    changed = changed || r.changed;
    conflictsChanged = conflictsChanged || r.conflicts;
  }
  // Altbestand: lokal vorhanden, nie mit Basis, online weg, aber schon einmal
  // auf dem Server gewesen (synced-Flag) → dort geloescht.
  for (const loc of await db.getAllFromIndex("locations", "by-project", projectId)) {
    if (remoteLocIds.has(loc.id) || (await db.get("sync-base", bkey("location", loc.id)))) continue;
    if (loc.synced) { await deleteLocalLocation(db, loc.id); changed = true; continue; }
    for (const d of await db.getAllFromIndex("detail-images", "by-location", loc.id)) {
      if (!remoteDetailIds.has(d.id) && !(await db.get("sync-base", bkey("detail", d.id))) && d.synced) {
        await deleteLocalDetail(db, d.id); changed = true;
      }
    }
  }

  if (changed) emitProject(projectId);
  if (conflictsChanged) { emitConflicts(projectId); await updatePendingState(); }
  return true;
}

async function pullEntity(
  db: AufmassDB,
  kind: SyncKind,
  row: any,
  projectId: string,
  parentId: string,
  remoteImages: Record<string, string | null>,
  tomb: Set<string>,
): Promise<{ changed: boolean; conflicts: boolean }> {
  const id = row.id as string;
  const key = bkey(kind, id);
  const base = await db.get("sync-base", key);
  const local: any = await db.get(STORE[kind] as any, id);
  const rFields = fieldsFromRow[kind](row);
  let changed = false;
  let conflicts = false;
  const label = kind === "location" ? `Standort ${row.location_number ?? ""}`.trim()
    : kind === "detail" ? "Detailbild" : kind === "floor_plan" ? `Grundriss ${row.name ?? ""}`.trim() : "Projekt";

  if (!local) {
    if (base) {
      // Hier geloescht, Loeschung noch nicht hochgeladen → nicht zurueckholen.
      return { changed, conflicts };
    }
    if (tomb.has(id)) {
      // Altbestand-Loeschvermerk: Basis anlegen, damit push online loescht.
      await db.put("sync-base", { key, kind, id, projectId, parentId, revision: row.revision ?? 0, fields: rFields, images: remoteImages });
      return { changed, conflicts };
    }
    // Neu vom Server.
    if (kind === "detail" && !(await db.get("locations", parentId))) return { changed, conflicts };
    const fresh = kind === "location"
      ? { id, projectId, createdAt: row.created_at, updatedAt: row.updated_at, synced: true }
      : kind === "detail"
        ? { id, locationId: parentId, createdAt: row.created_at, synced: true }
        : { id, projectId, createdAt: row.created_at, markers: "[]", name: "", pageIndex: 0 };
    await db.put(STORE[kind] as any, applyFields[kind](fresh, rFields));
    changed = true;
  } else if (!base) {
    // Altbestand vor Sync v2 (oder Download ohne Basis): einmalig einordnen.
    const localNewer = kind === "location"
      && new Date(local.updatedAt ?? local.createdAt).getTime() > new Date(row.updated_at).getTime() + 1000;
    if (kind === "floor_plan") {
      const lf = fieldsFromLocal.floor_plan(local);
      const union = mergeMarkers(rFields.markers, lf.markers, rFields.markers);
      // Markierungen beider Seiten behalten; der Rest kommt vom Server.
      const markers = [...(union as any[]), ...((lf.markers as any[]) || []).filter((m) => !(union as any[]).some((u) => u?.id === m?.id))];
      await db.put(STORE[kind] as any, applyFields.floor_plan(local, { ...rFields, markers }));
    } else if (!localNewer) {
      await db.put(STORE[kind] as any, { ...applyFields[kind](local, rFields), synced: true });
    } else {
      await db.put(STORE[kind] as any, { ...local, synced: true });
    }
    // Alt-Blobs ohne Pfad: Online-Fassung uebernehmen (wird heruntergeladen),
    // ausser der Standort ist hier neuer oder online fehlt das Bild – dann
    // bleibt der Blob "geaendert" und wird hochgeladen.
    for (const slot of Object.keys(remoteImages)) {
      const rec: any = await getBlobRec(db, kind, id, slot);
      if (rec && !rec.path && remoteImages[slot] && !localNewer) {
        await db.put(blobStoreFor(kind) as any, { ...rec, path: LEGACY_PATH });
      }
    }
    changed = true;
  } else if ((base.revision ?? -1) !== (row.revision ?? 0)) {
    const m = mergeIncoming(fieldsFromLocal[kind](local), base.fields, rFields);
    if (m.changed) {
      await db.put(STORE[kind] as any, applyFields[kind](local, m.local));
      changed = true;
    }
    for (const c of m.conflicts) {
      await putConflict(db, { projectId, kind, id, field: c.field, mine: c.mine, theirs: c.theirs, label });
      conflicts = true;
    }
  }

  // ── Bilder ──
  const images: Record<string, string | null> = { ...(base?.images || {}) };
  for (const [slot, rp] of Object.entries(remoteImages)) {
    const rec: any = await getBlobRec(db, kind, id, slot);
    const bp = base?.images?.[slot] ?? null;
    if (isDirtyBlob(rec)) {
      // Hier geaendert: base behalten, damit der Server beim Hochladen
      // erkennt, ob es dort inzwischen eine andere Fassung gibt.
      images[slot] = base ? bp : (rp ?? null);
      continue;
    }
    images[slot] = rp ?? null;
    if (rp && rec?.path !== rp) {
      const priority = slot === "original" ? 5 : kind === "location" ? 1 : kind === "floor_plan" ? 2 : 3;
      queueDownload({ kind, id, slot, path: rp, projectId, parentId, priority });
    } else if (!rp && rec && base && bp) {
      // Online entfernt (z. B. Archiv: Original verworfen).
      await removeLocalBlob(db, kind, id, slot);
      changed = true;
    }
  }
  await db.put("sync-base", { key, kind, id, projectId, parentId, revision: row.revision ?? 0, fields: rFields, images });
  return { changed, conflicts };
}

async function localDiffers(db: AufmassDB, b: SyncBaseRecord): Promise<boolean> {
  const local: any = await db.get(STORE[b.kind] as any, b.id);
  if (!local) return false;
  if (Object.keys(diffForPush(fieldsFromLocal[b.kind](local), b.fields)).length > 0) return true;
  for (const slot of Object.keys(b.images || {})) if (isDirtyBlob(await getBlobRec(db, b.kind, b.id, slot))) return true;
  return false;
}

async function handleRemoteDeletion(db: AufmassDB, b: SyncBaseRecord): Promise<{ changed: boolean; conflicts: boolean }> {
  const local = await db.get(STORE[b.kind] as any, b.id);
  if (!local) { await db.delete("sync-base", b.key); return { changed: false, conflicts: false }; }
  if (await localDiffers(db, b)) {
    // Woanders geloescht, hier noch geaendert → nachfragen.
    await putConflict(db, {
      projectId: b.projectId, kind: b.kind, id: b.id, field: "deleted", mine: "geändert", theirs: null,
      label: b.kind === "location" ? `Standort ${(local as any).locationNumber ?? ""}`.trim() : b.kind === "detail" ? "Detailbild" : "Grundriss",
    });
    return { changed: false, conflicts: true };
  }
  if (b.kind === "location") await deleteLocalLocation(db, b.id);
  else if (b.kind === "detail") await deleteLocalDetail(db, b.id);
  else if (b.kind === "floor_plan") { await db.delete("floor-plans", b.id); await db.delete("floor-plan-images", b.id); }
  await db.delete("sync-base", b.key);
  return { changed: true, conflicts: false };
}

async function deleteLocalDetail(db: AufmassDB, id: string) {
  await db.delete("detail-image-blobs", createDetailBlobId(id, "annotated"));
  await db.delete("detail-image-blobs", createDetailBlobId(id, "original"));
  await db.delete("detail-images", id);
  await db.delete("sync-base", bkey("detail", id));
}

async function deleteLocalLocation(db: AufmassDB, id: string) {
  for (const d of await db.getAllFromIndex("detail-images", "by-location", id)) await deleteLocalDetail(db, d.id);
  await db.delete("images", createImageId(id, "annotated"));
  await db.delete("images", createImageId(id, "original"));
  await db.delete("locations", id);
  await db.delete("sync-base", bkey("location", id));
}

// ─── Hochladen (push) ───────────────────────────────────────────────────────

interface PushResult { status: "ok" | "conflict" | "gone"; row?: any; conflicts?: { field: string; theirs: Json }[] }

async function pushFields(
  db: AufmassDB,
  kind: SyncKind,
  id: string,
  projectId: string,
  parentId: string,
  create: Record<string, unknown> | null,
  label: string,
): Promise<"ok" | "gone" | "skip"> {
  const local: any = await db.get(STORE[kind] as any, id);
  if (!local) return "skip";
  const base = await db.get("sync-base", bkey(kind, id));
  const localFields = fieldsFromLocal[kind](local);
  let changes: Record<string, { base: Json; value: Json }>;
  if (base) {
    changes = diffForPush(localFields, base.fields, await getConflictFields(db, kind, id));
    if (Object.keys(changes).length === 0) return "ok";
  } else {
    changes = diffForPush(localFields, {});
  }
  const res = await rpc<PushResult>("sync_push", {
    p_kind: kind, p_id: id, p_changes: changes, p_create: base ? null : create, p_force: [],
  });
  if (res.status === "gone") return "gone";
  const row = res.row;
  const rFields = fieldsFromRow[kind](row);
  // Lokal inzwischen weiter getippt? Dreiwege-Abgleich gegen die alte Basis.
  const nowLocal: any = await db.get(STORE[kind] as any, id);
  if (nowLocal) {
    const m = mergeIncoming(fieldsFromLocal[kind](nowLocal), base?.fields ?? rFields, rFields);
    if (m.changed) { await db.put(STORE[kind] as any, applyFields[kind](nowLocal, m.local)); emitProject(projectId); }
  }
  for (const c of res.conflicts || []) {
    await putConflict(db, { projectId, kind, id, field: c.field, mine: localFields[c.field] ?? null, theirs: c.theirs, label });
  }
  if ((res.conflicts || []).length > 0) emitConflicts(projectId);
  await db.put("sync-base", {
    key: bkey(kind, id), kind, id, projectId, parentId,
    revision: row.revision ?? 0, fields: rFields, images: base?.images ?? {},
  });
  if (kind === "location" || kind === "detail") {
    const rec: any = await db.get(STORE[kind] as any, id);
    if (rec && !rec.synced) await db.put(STORE[kind] as any, { ...rec, synced: true });
  }
  return "ok";
}

async function pushImage(db: AufmassDB, kind: "location" | "detail", id: string, slot: Slot, projectId: string, parentId: string, label: string) {
  const rec = await getBlobRec(db, kind, id, slot);
  if (!isDirtyBlob(rec)) return;
  const base = await db.get("sync-base", bkey(kind, id));
  if (!base) return; // Einheit noch nicht angelegt
  if (await db.get("sync-conflicts", `${kind}:${id}:image.${slot}`)) return; // erst entscheiden
  await waitForQuiet();
  const path = newImagePath(kind, kind === "location" ? id : id, slot, parentId);
  await uploadBlob(path, rec!.blob);
  const res = await rpc<{ status: string; theirs?: string; old_path?: string; old_deletable?: boolean }>("sync_set_image", {
    p_kind: kind, p_id: id, p_slot: slot, p_path: path, p_base: base.images?.[slot] ?? null, p_force: false,
  });
  if (res.status === "gone") { await removePaths([path]); return; }
  if (res.status === "conflict") {
    await removePaths([path]);
    await putConflict(db, { projectId, kind, id, field: `image.${slot}`, mine: "lokales Foto", theirs: res.theirs ?? null, label });
    emitConflicts(projectId);
    return;
  }
  await setBlobPath(db, kind, id, slot, path, rec!.blob);
  const fresh = await db.get("sync-base", bkey(kind, id));
  if (fresh) await db.put("sync-base", { ...fresh, images: { ...(fresh.images || {}), [slot]: path } });
  if (res.old_deletable && res.old_path) await removePaths([res.old_path]);
}

async function pushDelete(db: AufmassDB, b: SyncBaseRecord) {
  const res = await rpc<{ status: string; free_paths?: string[] }>("sync_delete", { p_kind: b.kind, p_id: b.id });
  await removePaths(res.free_paths || []);
  await db.delete("sync-base", b.key);
  for (const c of await db.getAllFromIndex("sync-conflicts", "by-project", b.projectId)) {
    if (c.id === b.id) await db.delete("sync-conflicts", c.key);
  }
}

async function pushProject(projectId: string): Promise<void> {
  const db = await getSyncDB();
  const project: any = await db.get("projects", projectId);
  if (!project) return;

  // Erstes Mal (Altbestand/neues Geraet): erst einordnen, dann hochladen.
  if (!(await db.get("sync-base", bkey("project", projectId)))) {
    const exists = await pullProject(projectId);
    if (!exists) {
      const session = getSession();
      const employeeId = project.employeeId ?? (session?.role === "employee" ? session.id : null);
      const created = await pushFields(db, "project", projectId, projectId, projectId, {
        ...withCustom(fieldsFromLocal.project(project)),
        user_id: employeeId || projectId,
        employee_id: employeeId,
        created_at: project.createdAt,
      }, "Projekt");
      if (created !== "ok") return;
    }
  } else {
    await pushFields(db, "project", projectId, projectId, projectId, null, "Projekt");
  }

  const locations: any[] = await db.getAllFromIndex("locations", "by-project", projectId);
  const bases = await db.getAllFromIndex("sync-base", "by-project", projectId);
  const localLocIds = new Set(locations.map((l) => l.id));

  // Standorte (Felder, dann Bilder, dann Detailbilder)
  for (const loc of locations) {
    const label = `Standort ${loc.locationNumber ?? ""}`.trim();
    if (await db.get("sync-conflicts", `location:${loc.id}:deleted`)) continue;
    const r = await pushFields(db, "location", loc.id, projectId, projectId, {
      ...withCustom(fieldsFromLocal.location(loc)),
      project_id: projectId,
      created_at: loc.createdAt,
    }, label);
    if (r === "gone") { await markGone(db, "location", loc.id, projectId, label); continue; }
    for (const slot of SLOTS) await pushImage(db, "location", loc.id, slot, projectId, projectId, label);

    const details: any[] = await db.getAllFromIndex("detail-images", "by-location", loc.id);
    for (const d of details) {
      if (await db.get("sync-conflicts", `detail:${d.id}:deleted`)) continue;
      const dBase = await db.get("sync-base", bkey("detail", d.id));
      if (!dBase) {
        // Neues Detailbild: erst Dateien, dann Zeile.
        const ann = await getBlobRec(db, "detail", d.id, "annotated");
        const orig = await getBlobRec(db, "detail", d.id, "original");
        if (!ann && !orig) continue;
        await waitForQuiet();
        const annPath = ann?.path && !ann.path.startsWith(LEGACY_PATH) ? ann.path : newImagePath("detail", d.id, "annotated", loc.id);
        const origPath = orig ? (orig.path && !orig.path.startsWith(LEGACY_PATH) ? orig.path : newImagePath("detail", d.id, "original", loc.id)) : annPath;
        if (ann && !ann.path) await uploadBlob(annPath, ann.blob);
        if (orig && !orig.path) await uploadBlob(origPath, orig.blob);
        const res = await pushFields(db, "detail", d.id, projectId, loc.id, {
          caption: d.caption ?? null,
          location_id: loc.id,
          annotated_path: ann ? annPath : origPath,
          original_path: origPath,
          created_at: d.createdAt,
        }, "Detailbild");
        if (res !== "ok") continue;
        if (ann) await setBlobPath(db, "detail", d.id, "annotated", annPath, ann.blob);
        if (orig) await setBlobPath(db, "detail", d.id, "original", origPath, orig.blob);
        const nb = await db.get("sync-base", bkey("detail", d.id));
        if (nb) await db.put("sync-base", { ...nb, images: { annotated: ann ? annPath : origPath, original: origPath } });
      } else {
        const r2 = await pushFields(db, "detail", d.id, projectId, loc.id, null, "Detailbild");
        if (r2 === "gone") { await markGone(db, "detail", d.id, projectId, "Detailbild"); continue; }
        for (const slot of SLOTS) await pushImage(db, "detail", d.id, slot, projectId, loc.id, "Detailbild");
      }
    }
  }

  // Grundrisse
  const floorPlans: any[] = await db.getAllFromIndex("floor-plans", "by-project", projectId);
  for (const fp of floorPlans) {
    const fBase = await db.get("sync-base", bkey("floor_plan", fp.id));
    if (!fBase) {
      const img = await getBlobRec(db, "floor_plan", fp.id, "image");
      if (!img) continue;
      await waitForQuiet();
      const path = img.path && !img.path.startsWith(LEGACY_PATH) ? img.path : newImagePath("floor_plan", fp.id, "image", projectId);
      if (!img.path) await uploadBlob(path, img.blob);
      const res = await pushFields(db, "floor_plan", fp.id, projectId, projectId, {
        ...fieldsFromLocal.floor_plan(fp),
        project_id: projectId,
        storage_path: path,
        created_at: fp.createdAt,
      }, `Grundriss ${fp.name ?? ""}`.trim());
      if (res !== "ok") continue;
      await setBlobPath(db, "floor_plan", fp.id, "image", path, img.blob);
      const nb = await db.get("sync-base", bkey("floor_plan", fp.id));
      if (nb) await db.put("sync-base", { ...nb, images: { image: path } });
    } else {
      await pushFields(db, "floor_plan", fp.id, projectId, projectId, null, `Grundriss ${fp.name ?? ""}`.trim());
      // Grundrissbilder aendern sich nicht – einen neu geschriebenen Blob
      // einfach wieder der Serverfassung zuordnen.
      const img = await getBlobRec(db, "floor_plan", fp.id, "image");
      if (isDirtyBlob(img) && fBase.images?.image) await setBlobPath(db, "floor_plan", fp.id, "image", fBase.images.image, img!.blob);
    }
  }

  // Hier geloescht → online loeschen (Detailbilder zuerst, dann Standorte).
  const localDetailIds = new Set<string>();
  for (const loc of locations) for (const d of await db.getAllFromIndex("detail-images", "by-location", loc.id)) localDetailIds.add(d.id);
  const localFpIds = new Set(floorPlans.map((f) => f.id));
  for (const b of bases.filter((x) => x.kind === "detail")) {
    if (!localDetailIds.has(b.id) && localLocIds.has(b.parentId || "")) await pushDelete(db, b);
    else if (!localDetailIds.has(b.id)) await db.delete("sync-base", b.key); // geht mit dem Standort
  }
  for (const b of bases.filter((x) => x.kind === "location")) {
    if (!localLocIds.has(b.id)) await pushDelete(db, b);
  }
  for (const b of bases.filter((x) => x.kind === "floor_plan")) {
    if (!localFpIds.has(b.id)) await pushDelete(db, b);
  }
  clearLegacyTombstones(bases.map((b) => b.id));
}

function withCustom(fields: FieldMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k.startsWith("cf.")) { if (v !== null) custom[k.slice(3)] = v; }
    else out[k] = v;
  }
  out.custom_fields = custom;
  return out;
}

async function markGone(db: AufmassDB, kind: SyncKind, id: string, projectId: string, label: string) {
  await putConflict(db, { projectId, kind, id, field: "deleted", mine: "geändert", theirs: null, label });
  emitConflicts(projectId);
}

function clearLegacyTombstones(ids: string[]) {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_TOMBSTONE_KEY) || "{}");
    if (!raw.locations && !raw.details) return;
    const keep = (list: string[] = []) => list.filter((x) => !ids.includes(x));
    localStorage.setItem(LEGACY_TOMBSTONE_KEY, JSON.stringify({ locations: keep(raw.locations), details: keep(raw.details) }));
  } catch { /* egal */ }
}

// ─── Warteschlange / Ablauf ─────────────────────────────────────────────────

function loadDirty(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DIRTY_KEY) || "[]")); } catch { return new Set(); }
}
const dirty = loadDirty();
function saveDirty() {
  try { localStorage.setItem(DIRTY_KEY, JSON.stringify([...dirty])); } catch { /* egal */ }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let rerun = false;
let backoffMs = 0;

/** Lokale Aenderung an einem Projekt: im Hintergrund hochladen. */
export function requestPush(projectId: string, delayMs = 1500) {
  dirty.add(projectId);
  saveDirty();
  updatePendingState();
  schedule(delayMs);
}

function schedule(delayMs: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void run(); }, Math.max(delayMs, backoffMs));
}

export function hasPendingPush(projectId: string): boolean {
  return dirty.has(projectId) || running;
}

async function run(): Promise<void> {
  if (running) { rerun = true; return; }
  if (!getSession()) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) { updatePendingState(); return; }
  running = true;
  startSync();
  let failed: unknown = null;
  try {
    for (const projectId of [...dirty]) {
      await waitForQuiet();
      if (typeof navigator !== "undefined" && !navigator.onLine) { failed = new Error("offline"); break; }
      dirty.delete(projectId); // waehrend des Laufs neu Geaendertes setzt es wieder
      saveDirty();
      try {
        await pushProject(projectId);
      } catch (e) {
        dirty.add(projectId);
        saveDirty();
        failed = e;
        if (isNetworkError(e)) break;
        console.error("Sync fehlgeschlagen", projectId, e);
      }
    }
  } finally {
    running = false;
    if (failed) {
      backoffMs = Math.min(backoffMs ? backoffMs * 2 : 5000, 5 * 60_000);
      if (!(isNetworkError(failed) && !navigator.onLine)) finishSyncError(failed);
      else updateSyncState({ isSyncing: false, isOnline: false });
      schedule(backoffMs);
    } else {
      backoffMs = 0;
      finishSyncSuccess();
    }
    await updatePendingState();
    if (rerun) { rerun = false; schedule(500); }
    else if (dirty.size > 0 && !failed) schedule(1500);
  }
}

/** Alles Ausstehende sofort hochladen (z. B. "Jetzt synchronisieren"). */
export async function flushNow(): Promise<void> {
  backoffMs = 0;
  if (timer) { clearTimeout(timer); timer = null; }
  await run();
}

// ─── Status fuer die Anzeige ────────────────────────────────────────────────

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
export function updatePendingState(): Promise<void> {
  return new Promise((resolve) => {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(async () => {
      try {
        const db = await getSyncDB();
        const conflicts = await db.count("sync-conflicts");
        updateSyncState({
          pendingProjects: dirty.size,
          pendingDownloads: downloadQueue.length + downloadsRunning,
          conflicts,
        });
      } catch { /* egal */ }
      resolve();
    }, 150);
  });
}

/**
 * Hat dieses Projekt lokal noch etwas, das nicht auf dem Server ist?
 * (Archiv: lokale Kopie erst danach entfernen.)
 */
export async function hasLocalChanges(projectId: string): Promise<boolean> {
  if (dirty.has(projectId)) return true;
  const db = await getSyncDB();
  if (!(await db.get("sync-base", bkey("project", projectId)))) return true;
  if ((await db.countFromIndex("sync-conflicts", "by-project", projectId)) > 0) return true;
  const bases = await db.getAllFromIndex("sync-base", "by-project", projectId);
  const baseKeys = new Set(bases.map((b) => b.key));
  for (const b of bases) {
    if (b.kind === "project") continue;
    if (!(await db.get(STORE[b.kind] as any, b.id))) return true;
    if (await localDiffers(db, b)) return true;
  }
  for (const loc of await db.getAllFromIndex("locations", "by-project", projectId)) {
    if (!baseKeys.has(bkey("location", loc.id))) return true;
    for (const d of await db.getAllFromIndex("detail-images", "by-location", loc.id)) {
      if (!baseKeys.has(bkey("detail", d.id))) return true;
    }
  }
  for (const fp of await db.getAllFromIndex("floor-plans", "by-project", projectId)) {
    if (!baseKeys.has(bkey("floor_plan", fp.id))) return true;
  }
  return false;
}

/** Projekt wurde online geloescht: nichts mehr hochladen. */
export function forgetProject(projectId: string) {
  dirty.delete(projectId);
  saveDirty();
  void updatePendingState();
}

// ─── Konflikte ──────────────────────────────────────────────────────────────

export async function listConflicts(projectId: string): Promise<SyncConflictRecord[]> {
  const db = await getSyncDB();
  return (await db.getAllFromIndex("sync-conflicts", "by-project", projectId)).sort((a, b) => a.createdAt - b.createdAt);
}

/** Link zur Online-Fassung eines Bildkonflikts (zum Vergleichen). */
export async function conflictImageUrl(c: SyncConflictRecord): Promise<string | null> {
  return typeof c.theirs === "string" ? signedFileUrl(c.theirs) : null;
}

/**
 * Konflikt entscheiden.
 *  mine   = eigene Fassung behalten und hochladen
 *  theirs = andere Fassung uebernehmen (eigene verwerfen)
 */
export async function resolveConflict(c: SyncConflictRecord, choice: "mine" | "theirs"): Promise<void> {
  const db = await getSyncDB();
  const base = await db.get("sync-base", bkey(c.kind, c.id));

  if (c.field === "deleted") {
    if (choice === "mine") {
      // Wiederherstellen: ohne Basis legt der naechste Abgleich alles neu an.
      await db.delete("sync-base", bkey(c.kind, c.id));
      if (c.kind === "location") {
        for (const d of await db.getAllFromIndex("detail-images", "by-location", c.id)) {
          await db.delete("sync-base", bkey("detail", d.id));
          for (const slot of SLOTS) {
            const rec: any = await getBlobRec(db, "detail", d.id, slot);
            if (rec) await db.put("detail-image-blobs", { ...rec, path: undefined });
          }
        }
        for (const slot of SLOTS) {
          const rec: any = await getBlobRec(db, "location", c.id, slot);
          if (rec) await db.put("images", { ...rec, path: undefined });
        }
      }
    } else {
      if (c.kind === "location") await deleteLocalLocation(db, c.id);
      else if (c.kind === "detail") await deleteLocalDetail(db, c.id);
      else if (c.kind === "floor_plan") { await db.delete("floor-plans", c.id); await db.delete("floor-plan-images", c.id); await db.delete("sync-base", bkey(c.kind, c.id)); }
    }
  } else if (c.field.startsWith("image.")) {
    const slot = c.field.slice(6);
    if (choice === "mine") {
      // Basis = Online-Fassung → der naechste Upload ersetzt sie.
      if (base) await db.put("sync-base", { ...base, images: { ...(base.images || {}), [slot]: c.theirs ?? null } });
    } else if (typeof c.theirs === "string") {
      const rec: any = await getBlobRec(db, c.kind, c.id, slot);
      if (rec) await db.put(blobStoreFor(c.kind) as any, { ...rec, path: LEGACY_PATH });
      if (base) await db.put("sync-base", { ...base, images: { ...(base.images || {}), [slot]: c.theirs } });
      queueDownload({ kind: c.kind, id: c.id, slot, path: c.theirs, projectId: c.projectId, parentId: base?.parentId || c.projectId, priority: 0 });
    }
  } else if (choice === "theirs") {
    const local: any = await db.get(STORE[c.kind] as any, c.id);
    if (local) {
      const f = fieldsFromLocal[c.kind](local);
      if (c.theirs === null) delete f[c.field]; else f[c.field] = c.theirs;
      await writeLocalFields(db, c.kind, c.id, f);
    }
  } else if (base && !same(base.fields[c.field], c.theirs)) {
    // "mine": Basis auf die Online-Fassung setzen, dann gewinnt die eigene.
    await db.put("sync-base", { ...base, fields: { ...base.fields, [c.field]: c.theirs } });
  }

  await db.delete("sync-conflicts", c.key);
  emitConflicts(c.projectId);
  emitProject(c.projectId);
  requestPush(c.projectId, 200);
}

// ─── Live-Abgleich des offenen Projekts ─────────────────────────────────────

/**
 * Haelt ein geoeffnetes Projekt aktuell: sofortiger Abgleich, Realtime auf
 * Aenderungen anderer Geraete, erneuter Abgleich bei Netz/Rueckkehr in die
 * App. Rueckgabe: Abmelden.
 */
export function watchProject(projectId: string): () => void {
  let stopped = false;
  let t: ReturnType<typeof setTimeout> | null = null;
  const refresh = (delay = 600) => {
    if (t) clearTimeout(t);
    t = setTimeout(async () => {
      if (stopped || (typeof navigator !== "undefined" && !navigator.onLine)) return;
      try {
        // Erst eigene Aenderungen hoch, dann Online-Stand holen.
        if (dirty.has(projectId)) await flushNow();
        await pullProject(projectId);
      } catch { /* naechster Anlass */ }
    }, delay);
  };

  refresh(0);
  const channel = (supabase as any)
    .channel(`sync-${projectId}-${Math.random().toString(36).slice(2, 8)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "locations", filter: `project_id=eq.${projectId}` }, () => refresh())
    .on("postgres_changes", { event: "*", schema: "public", table: "floor_plans", filter: `project_id=eq.${projectId}` }, () => refresh())
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${projectId}` }, () => refresh())
    .subscribe();
  const onOnline = () => refresh(300);
  const onVisible = () => { if (document.visibilityState === "visible") refresh(800); };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  // Falls Realtime nicht verbunden ist: alle 60 s nachsehen.
  const interval = setInterval(() => { if (document.visibilityState === "visible") refresh(0); }, 60_000);

  return () => {
    stopped = true;
    if (t) clearTimeout(t);
    clearInterval(interval);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    try { (supabase as any).removeChannel(channel); } catch { /* egal */ }
  };
}

// ─── Start ──────────────────────────────────────────────────────────────────

let started = false;
/** Einmal beim App-Start: Netz-Ereignisse beobachten, Ausstehendes hochladen. */
export function startSyncEngine() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => { backoffMs = 0; schedule(500); });
  window.addEventListener("offline", () => updateSyncState({ isOnline: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && dirty.size > 0) schedule(1000);
  });
  setInterval(() => { if (dirty.size > 0 && !running) schedule(0); }, 60_000);
  if (dirty.size > 0) schedule(3000);
  void updatePendingState();
}

/**
 * Projekte fuer die Arbeit ohne Netz vorhalten: alle lokalen Projekte
 * hochladen und abgleichen, dazu die eigenen (zugewiesenen, nicht
 * archivierten) Projekte samt Bildern laden.
 */
export async function syncAll(extraProjectIds: string[] = []): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const db = await getSyncDB();
  const localIds = (await db.getAllKeys("projects")) as string[];
  for (const id of localIds) dirty.add(id);
  saveDirty();
  await flushNow();
  const ids = [...new Set([...localIds, ...extraProjectIds])];
  for (const id of ids) {
    await waitForQuiet();
    try {
      const exists = await pullProject(id);
      if (!exists && !(await db.get("sync-base", bkey("project", id)))) continue;
    } catch (e) {
      if (isNetworkError(e)) break;
    }
  }
}
