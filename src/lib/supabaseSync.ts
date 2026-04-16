import { supabase } from "@/integrations/supabase/client";
import { indexedDBStorage } from "./indexedDBStorage";
import { getSession } from "./session";
import { Project, DetailImage, FloorPlan } from "@/types/project";
import { finishSyncError, finishSyncSuccess, startSync } from "./syncStatus";
import { compressImage } from "./imageCompression";

// ─── Image hash cache ────────────────────────────────────────────────────────
// Persists to localStorage. Skips re-upload of unchanged images across sessions.
// Limited to MAX_HASH_ENTRIES to prevent unbounded localStorage growth.

const HASH_CACHE_KEY  = 'mmp_img_hashes_v2';
const MAX_HASH_ENTRIES = 500;
let _hashCache: Record<string, { fp: string; ts: number }> | null = null;

function getHashCache(): Record<string, { fp: string; ts: number }> {
  if (!_hashCache) {
    try { _hashCache = JSON.parse(localStorage.getItem(HASH_CACHE_KEY) || '{}'); }
    catch { _hashCache = {}; }
  }
  return _hashCache;
}

function persistHashCache() {
  const cache = getHashCache();
  // Prune oldest entries if over limit
  const keys = Object.keys(cache);
  if (keys.length > MAX_HASH_ENTRIES) {
    const sorted = keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
    sorted.slice(0, keys.length - MAX_HASH_ENTRIES).forEach(k => delete cache[k]);
  }
  try { localStorage.setItem(HASH_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

/** Fast fingerprint: length + first 32 chars + last 16 chars. */
function imageFingerprint(data: string): string {
  if (!data) return '';
  return `${data.length}|${data.slice(0, 32)}|${data.slice(-16)}`;
}

function isImageSynced(key: string, data: string): boolean {
  const entry = getHashCache()[key];
  return !!data && !!entry && entry.fp === imageFingerprint(data);
}

function markImageSynced(key: string, data: string) {
  getHashCache()[key] = { fp: imageFingerprint(data), ts: Date.now() };
  persistHashCache();
}

function invalidateImageCache(key: string) {
  delete getHashCache()[key];
  persistHashCache();
}

// ─── Storage URL helper ──────────────────────────────────────────────────────
// Bucket is public – getPublicUrl is synchronous, no auth required.

function getStorageUrl(path: string): string {
  const { data } = supabase.storage.from("project-files").getPublicUrl(path);
  return data.publicUrl;
}

// ─── Sync debounce ────────────────────────────────────────────────────────────
// Prevents rapid sequential changes from each triggering a full sync.
// Call scheduleSyncProject(id) anywhere – it will wait 2.5s after the last call.

const _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 2500;

export function scheduleSyncProject(projectId: string): void {
  const existing = _debounceTimers.get(projectId);
  if (existing) clearTimeout(existing);
  _debounceTimers.set(projectId, setTimeout(async () => {
    _debounceTimers.delete(projectId);
    await syncProjectToSupabase(projectId);
  }, DEBOUNCE_MS));
}

// ─── Batched async helper ─────────────────────────────────────────────────────

async function loadInBatches<T>(items: T[], fn: (item: T) => Promise<void>, batchSize = 6): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(fn));
  }
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function getLocationImagePath(locationId: string, imageType: "annotated" | "original") {
  return `images/${locationId}/${imageType}`;
}
function getDetailImagePath(locationId: string, detailImageId: string, imageType: "annotated" | "original") {
  return `detail-images/${locationId}/${detailImageId}/${imageType}`;
}
function getFloorPlanPath(projectId: string, floorPlanId: string) {
  return `floor-plans/${projectId}/${floorPlanId}`;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function uploadImageToStorage(path: string, base64: string): Promise<string | null> {
  try {
    if (!base64 || !base64.includes(';base64,')) return null;

    // Compress before upload if image is large (safety net – pages should compress too)
    let data = base64;
    const sizeKb = Math.round(base64.length * 0.75 / 1024);
    if (sizeKb > 400) {
      try { data = await compressImage(base64, 1600, 0.82); } catch { /* keep original */ }
    }

    const parts = data.split(';base64,');
    const contentType = parts[0].split(':')[1] || 'image/jpeg';
    const raw = atob(parts[1]);
    const uInt8Array = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) uInt8Array[i] = raw.charCodeAt(i);
    const blob = new Blob([uInt8Array], { type: contentType });
    const { error } = await supabase.storage.from('project-files').upload(path, blob, { contentType });
    if (error) {
      // File already exists → update instead
      if ((error as any).statusCode === '409' || error.message?.includes('already exists')) {
        const { error: updateError } = await supabase.storage.from('project-files').update(path, blob, { contentType });
        if (updateError) return null;
      } else {
        return null;
      }
    }
    return path;
  } catch {
    return null;
  }
}

async function removeStoragePaths(paths: (string | null | undefined)[]) {
  const uniquePaths = [...new Set(paths.filter(Boolean) as string[])];
  if (uniquePaths.length === 0) return;
  await supabase.storage.from('project-files').remove(uniquePaths);
}

// ─── Sync: location images ────────────────────────────────────────────────────

async function syncImageVariant(locationId: string, imageType: "annotated" | "original", imageData: string): Promise<void> {
  if (!imageData) return;
  const cacheKey = `loc_${locationId}_${imageType}`;
  if (isImageSynced(cacheKey, imageData)) return;
  const path = getLocationImagePath(locationId, imageType);
  const uploaded = await uploadImageToStorage(path, imageData);
  if (!uploaded) return;
  // Delete existing row first, then insert fresh (no unique constraint in DB)
  await supabase.from("location_images")
    .delete()
    .eq("location_id", locationId)
    .eq("image_type", imageType);
  const { error } = await supabase.from("location_images").insert(
    { location_id: locationId, image_type: imageType, storage_path: path }
  );
  if (error) return;
  markImageSynced(cacheKey, imageData);
}

async function syncLocationImages(locationId: string, annotatedImage?: string, originalImage?: string): Promise<void> {
  const desiredTypes = new Set<string>();
  if (annotatedImage) desiredTypes.add('annotated');
  if (originalImage)  desiredTypes.add('original');

  await Promise.all([
    annotatedImage ? syncImageVariant(locationId, "annotated", annotatedImage) : Promise.resolve(),
    originalImage  ? syncImageVariant(locationId, "original",  originalImage)  : Promise.resolve(),
  ]);

  const { data: existingRows } = await supabase.from('location_images').select('image_type, storage_path').eq('location_id', locationId);
  const rowsToDelete = (existingRows || []).filter((row) => !desiredTypes.has(row.image_type));
  if (rowsToDelete.length) {
    await removeStoragePaths(rowsToDelete.map((row) => row.storage_path));
    await supabase.from('location_images').delete().eq('location_id', locationId).in('image_type', rowsToDelete.map((row) => row.image_type));
    rowsToDelete.forEach(row => invalidateImageCache(`loc_${locationId}_${row.image_type}`));
  }
}

// ─── Sync: detail images ──────────────────────────────────────────────────────

async function syncDetailImage(detailImage: DetailImage, locationId: string): Promise<void> {
  const annotatedKey  = `detail_${detailImage.id}_annotated`;
  const originalKey   = `detail_${detailImage.id}_original`;
  const annotatedData = detailImage.imageData;
  const originalData  = detailImage.originalImageData || detailImage.imageData;

  const annotatedAlreadySynced = isImageSynced(annotatedKey, annotatedData);
  const originalAlreadySynced  = isImageSynced(originalKey,  originalData);

  const annotatedPath = getDetailImagePath(locationId, detailImage.id, 'annotated');
  const originalPath  = getDetailImagePath(locationId, detailImage.id, 'original');

  const [uploadedAnnotated, uploadedOriginal] = await Promise.all([
    annotatedAlreadySynced ? annotatedPath : uploadImageToStorage(annotatedPath, annotatedData),
    originalAlreadySynced  ? originalPath  : uploadImageToStorage(originalPath,  originalData),
  ]);

  if (!uploadedAnnotated || !uploadedOriginal) return;

  const { error: detailUpsertError } = await supabase.from("detail_images").upsert({
    id: detailImage.id,
    location_id: locationId,
    caption: detailImage.caption || null,
    annotated_path: annotatedPath,
    original_path: originalPath,
    created_at: detailImage.createdAt instanceof Date ? detailImage.createdAt.toISOString() : new Date().toISOString(),
  }, { onConflict: "id" });

  if (detailUpsertError) return; // Don't mark as synced if DB write failed
  if (!annotatedAlreadySynced) markImageSynced(annotatedKey, annotatedData);
  if (!originalAlreadySynced)  markImageSynced(originalKey,  originalData);
}

async function syncDetailImages(locationId: string, detailImages?: DetailImage[]): Promise<void> {
  const current = detailImages || [];
  const currentIds = new Set(current.map((d) => d.id));
  await Promise.all(current.map(d => syncDetailImage(d, locationId)));
  const { data: existingRows } = await supabase.from('detail_images').select('id, annotated_path, original_path').eq('location_id', locationId);
  const rowsToDelete = (existingRows || []).filter((row) => !currentIds.has(row.id));
  if (rowsToDelete.length) {
    await removeStoragePaths(rowsToDelete.flatMap((row) => [row.annotated_path, row.original_path]));
    await supabase.from('detail_images').delete().eq('location_id', locationId).in('id', rowsToDelete.map((row) => row.id));
    rowsToDelete.forEach(row => {
      invalidateImageCache(`detail_${row.id}_annotated`);
      invalidateImageCache(`detail_${row.id}_original`);
    });
  }
}

// ─── Sync: floor plans ────────────────────────────────────────────────────────

async function syncFloorPlan(projectId: string, floorPlan: FloorPlan): Promise<void> {
  const cacheKey = `floor_${floorPlan.id}`;
  const path = getFloorPlanPath(projectId, floorPlan.id);

  if (!isImageSynced(cacheKey, floorPlan.imageData)) {
    const uploaded = await uploadImageToStorage(path, floorPlan.imageData);
    if (!uploaded) return;
    markImageSynced(cacheKey, floorPlan.imageData);
  }

  await (supabase as any).from("floor_plans").upsert({
    id: floorPlan.id,
    project_id: projectId,
    name: floorPlan.name,
    storage_path: path,
    markers: floorPlan.markers as any,
    page_index: floorPlan.pageIndex,
    created_at: floorPlan.createdAt instanceof Date ? floorPlan.createdAt.toISOString() : new Date().toISOString(),
  }, { onConflict: "id" });
}

async function syncFloorPlans(projectId: string, floorPlans?: FloorPlan[]): Promise<void> {
  const current = floorPlans || [];
  const currentIds = new Set(current.map((fp) => fp.id));
  await Promise.all(current.map(fp => syncFloorPlan(projectId, fp)));
  const { data: existingRows, error } = await (supabase as any).from('floor_plans').select('id, storage_path').eq('project_id', projectId);
  if (error) return;
  const rowsToDelete = (existingRows || []).filter((row: any) => !currentIds.has(row.id));
  if (rowsToDelete.length) {
    await removeStoragePaths(rowsToDelete.map((row: any) => row.storage_path));
    await (supabase as any).from('floor_plans').delete().eq('project_id', projectId).in('id', rowsToDelete.map((row: any) => row.id));
    rowsToDelete.forEach((row: any) => invalidateImageCache(`floor_${row.id}`));
  }
}

// ─── Download: path → base64 ──────────────────────────────────────────────────

async function pathToBase64(path: string): Promise<string | null> {
  try {
    const url = getStorageUrl(path);
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ─── Hydrate project from Supabase ───────────────────────────────────────────

export async function getProjectRemoteTimestamp(projectId: string): Promise<Date | null> {
  const { data } = await supabase.from('projects').select('updated_at').eq('id', projectId).maybeSingle();
  return data?.updated_at ? new Date(data.updated_at) : null;
}

export async function hydrateProjectFromSupabase(projectId: string): Promise<Project | null> {
  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("id, project_number, project_type, employee_id, customer_name, custom_fields, created_at, updated_at")
    .eq("id", projectId)
    .single();
  if (projectError || !projectRow) return null;

  const { data: locationRows, error: locationError } = await supabase
    .from("locations")
    .select("id, location_number, location_name, comment, system, label, location_type, custom_fields, guest_info, created_at")
    .eq("project_id", projectId)
    .order("created_at");
  if (locationError) throw locationError;

  const locationIds = (locationRows || []).map((row) => row.id);
  const imageMap = new Map<string, { annotated?: string; original?: string }>();
  const detailImageMap = new Map<string, DetailImage[]>();

  if (locationIds.length > 0) {
    // Load location images directly from known storage paths.
    // We don't query location_images table to avoid dependency on that DB row existing.
    // Path pattern: images/{locationId}/annotated and images/{locationId}/original
    await loadInBatches(locationIds, async (locationId) => {
      const [annotated, original] = await Promise.all([
        pathToBase64(getLocationImagePath(locationId, "annotated")),
        pathToBase64(getLocationImagePath(locationId, "original")),
      ]);
      if (annotated || original) {
        imageMap.set(locationId, { annotated: annotated || undefined, original: original || undefined });
      }
    });

    const { data: detailRows, error: detailError } = await supabase
      .from("detail_images")
      .select("id, location_id, caption, annotated_path, original_path, created_at")
      .in("location_id", locationIds)
      .order("created_at");
    if (detailError) throw detailError;

    await loadInBatches(detailRows || [], async (row) => {
      const [annotated, original] = await Promise.all([
        pathToBase64(row.annotated_path),
        pathToBase64(row.original_path),
      ]);
      const detailImage: DetailImage = {
        id: row.id,
        imageData: annotated || original || "",
        originalImageData: original || annotated || "",
        caption: row.caption || undefined,
        createdAt: new Date(row.created_at),
      };
      const existing = detailImageMap.get(row.location_id) || [];
      existing.push(detailImage);
      detailImageMap.set(row.location_id, existing);
    });
  }

  const { data: assignmentRows } = await (supabase as any)
    .from('project_employee_assignments')
    .select('employee_id')
    .eq('project_id', projectId);

  const { data: floorPlanRows } = await (supabase as any)
    .from("floor_plans")
    .select("id, name, storage_path, markers, page_index, created_at")
    .eq("project_id", projectId)
    .order("page_index");

  const floorPlans: FloorPlan[] = [];
  await loadInBatches(floorPlanRows || [], async (row: any) => {
    const imageData = await pathToBase64(row.storage_path);
    floorPlans.push({
      id: row.id,
      name: row.name,
      imageData: imageData || "",
      markers: Array.isArray(row.markers) ? row.markers as any : [],
      pageIndex: row.page_index,
      createdAt: new Date(row.created_at),
    });
  });

  const locations = (locationRows || []).map((row) => {
    const images = imageMap.get(row.id) || {};
    const rawCustom = row.custom_fields && typeof row.custom_fields === 'object' ? row.custom_fields as Record<string, any> : {};
    const areaMeasurements = Array.isArray(rawCustom.__areaMeasurements) ? rawCustom.__areaMeasurements : undefined;
    const cleanCustom = { ...rawCustom };
    delete cleanCustom.__areaMeasurements;
    return {
      id: row.id,
      locationNumber: row.location_number,
      locationName: row.location_name || undefined,
      comment: row.comment || undefined,
      system: row.system || undefined,
      label: row.label || undefined,
      locationType: row.location_type || undefined,
      customFields: Object.keys(cleanCustom).length > 0 ? cleanCustom as Record<string, string> : undefined,
      guestInfo: row.guest_info || undefined,
      imageData: images.annotated || images.original || "",
      originalImageData: images.original || images.annotated || "",
      createdAt: new Date(row.created_at),
      detailImages: detailImageMap.get(row.id) || [],
      areaMeasurements,
    };
  });

  // Note: saveProject only writes image blobs for NEW locations.
  // Existing location blobs are preserved in IndexedDB regardless of imageData value here.
  const hydratedProject: Project = {
    id: projectRow.id,
    projectNumber: projectRow.project_number,
    projectType: (['aufmass', 'aufmass_mit_plan', 'fahrzeugbeschriftung'].includes((projectRow as any).project_type) ? (projectRow as any).project_type : 'aufmass') as 'aufmass' | 'aufmass_mit_plan' | 'fahrzeugbeschriftung',
    customerName: (projectRow as any).customer_name || undefined,
    customFields: (projectRow as any).custom_fields && typeof (projectRow as any).custom_fields === 'object' ? (projectRow as any).custom_fields : undefined,
    employeeId: (projectRow as any).employee_id || null,
    accessEmployeeIds: Array.from(new Set([
      ((projectRow as any).employee_id || null),
      ...((assignmentRows || []).map((row: any) => row.employee_id)),
    ].filter(Boolean))),
    locations,
    floorPlans,
    createdAt: new Date(projectRow.created_at),
    updatedAt: new Date(projectRow.updated_at),
  };
  await indexedDBStorage.saveProject(hydratedProject);
  return hydratedProject;
}

// ─── Build DB rows helper ─────────────────────────────────────────────────────

function buildLocationRows(project: Project) {
  return project.locations.map((l) => {
    const customFields: Record<string, any> = { ...(l.customFields || {}) };
    if (l.areaMeasurements && l.areaMeasurements.length > 0) {
      customFields.__areaMeasurements = l.areaMeasurements;
    }
    return {
      id: l.id,
      project_id: project.id,
      location_number: l.locationNumber,
      location_name: l.locationName || null,
      comment: l.comment || null,
      system: l.system || null,
      label: l.label || null,
      location_type: l.locationType || null,
      custom_fields: customFields,
      created_at: l.createdAt instanceof Date ? l.createdAt.toISOString() : new Date().toISOString(),
    };
  });
}

async function removeDeletedLocationsFromSupabase(project: Project) {
  const { data: remoteLocations } = await supabase.from('locations').select('id').eq('project_id', project.id);
  const localLocationIds = new Set(project.locations.map((location) => location.id));
  const deletedLocationIds = (remoteLocations || []).map((row) => row.id).filter((id) => !localLocationIds.has(id));
  if (deletedLocationIds.length === 0) return;
  const locationStoragePathsToDelete = deletedLocationIds.flatMap(id => [
    getLocationImagePath(id, "annotated"),
    getLocationImagePath(id, "original"),
  ]);
  const { data: remoteDetailImages } = await supabase.from('detail_images').select('annotated_path, original_path').in('location_id', deletedLocationIds);
  await removeStoragePaths([
    ...locationStoragePathsToDelete,
    ...(remoteDetailImages || []).flatMap((row) => [row.annotated_path, row.original_path]),
  ]);
  await (supabase as any).from('location_feedback').delete().in('location_id', deletedLocationIds);
  await supabase.from('location_approvals').delete().in('location_id', deletedLocationIds);
  await supabase.from('location_pdfs').delete().in('location_id', deletedLocationIds);
  await supabase.from('detail_images').delete().in('location_id', deletedLocationIds);
  await supabase.from('location_images').delete().in('location_id', deletedLocationIds);
  await supabase.from('locations').delete().eq('project_id', project.id).in('id', deletedLocationIds);
  deletedLocationIds.forEach(id => {
    invalidateImageCache(`loc_${id}_annotated`);
    invalidateImageCache(`loc_${id}_original`);
  });
}

// ─── Core sync ────────────────────────────────────────────────────────────────

async function syncProjectInternal(projectId: string): Promise<'uploaded' | 'remote-won' | 'skipped'> {
  const session = getSession();
  const project = await indexedDBStorage.getProject(projectId, session);
  if (!project) return 'skipped';

  const remoteUpdatedAt = await getProjectRemoteTimestamp(projectId);
  if (remoteUpdatedAt && remoteUpdatedAt.getTime() > project.updatedAt.getTime() + 1000) {
    await hydrateProjectFromSupabase(projectId);
    return 'remote-won';
  }

  const syncTimestamp = new Date().toISOString();
  const { data: existingProject } = await supabase.from('projects').select('employee_id, user_id').eq('id', project.id).maybeSingle();
  const employeeId = existingProject?.employee_id ?? project.employeeId ?? (session?.role === 'employee' ? session.id : null);
  const userId = existingProject?.user_id ?? (project.employeeId || (session?.role === 'employee' ? session.id : project.id));

  await supabase.from('projects').upsert({
    id: project.id,
    project_number: project.projectNumber,
    project_type: project.projectType || (existingProject as any)?.project_type || 'aufmass',
    customer_name: (project as any).customerName || null,
    custom_fields: (project as any).customFields || null,
    user_id: userId,
    employee_id: employeeId,
    created_at: project.createdAt instanceof Date ? project.createdAt.toISOString() : new Date().toISOString(),
    updated_at: syncTimestamp,
  } as any, { onConflict: 'id' });

  if (project.locations?.length) {
    await supabase.from('locations').upsert(buildLocationRows(project), { onConflict: 'id' });
    await Promise.all(project.locations.map(async (loc) => {
      await syncLocationImages(loc.id, loc.imageData, loc.originalImageData);
      await syncDetailImages(loc.id, loc.detailImages);
    }));
  }

  await removeDeletedLocationsFromSupabase(project);
  await syncFloorPlans(project.id, project.floorPlans);
  await indexedDBStorage.updateProjectTimestamp(project.id, syncTimestamp);
  return 'uploaded';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function syncAllToSupabase(): Promise<void> {
  startSync();
  const projectIds = await indexedDBStorage.getProjectIds(getSession());
  const errors: string[] = [];
  // Each project syncs independently – one failure doesn't abort the others
  for (const id of projectIds) {
    try {
      await syncProjectInternal(id);
    } catch (e) {
      errors.push(id);
      console.error(`Sync failed for project ${id}:`, e);
    }
  }
  if (errors.length > 0) {
    finishSyncError(new Error(`${errors.length} Projekt(e) konnten nicht synchronisiert werden`));
  } else {
    finishSyncSuccess();
  }
}

export async function syncProjectToSupabase(projectId: string): Promise<'uploaded' | 'remote-won' | 'skipped'> {
  startSync();
  try {
    const result = await syncProjectInternal(projectId);
    finishSyncSuccess();
    return result;
  } catch (e) {
    finishSyncError(e);
    throw e;
  }
}

export async function syncLocationToSupabase(projectId: string, _locationId: string): Promise<void> {
  await syncProjectToSupabase(projectId);
}

export async function deleteFloorPlanFromSupabase(projectId: string, floorPlanId: string): Promise<void> {
  const { data } = await (supabase as any).from('floor_plans').select('storage_path').eq('project_id', projectId).eq('id', floorPlanId).maybeSingle();
  await removeStoragePaths([data?.storage_path]);
  await (supabase as any).from('floor_plans').delete().eq('project_id', projectId).eq('id', floorPlanId);
  invalidateImageCache(`floor_${floorPlanId}`);
}

export async function deleteDetailImageFromSupabase(detailImageId: string): Promise<void> {
  const { data } = await supabase.from('detail_images').select('annotated_path, original_path').eq('id', detailImageId).maybeSingle();
  await removeStoragePaths([data?.annotated_path, data?.original_path]);
  await supabase.from('detail_images').delete().eq('id', detailImageId);
  invalidateImageCache(`detail_${detailImageId}_annotated`);
  invalidateImageCache(`detail_${detailImageId}_original`);
}

export async function deleteProjectFromSupabase(projectId: string): Promise<void> {
  const { data: locations } = await supabase.from("locations").select("id").eq("project_id", projectId);
  const locationIds = (locations || []).map((l) => l.id);
  if (locationIds.length > 0) {
    // Build storage paths directly (don't rely on location_images table having rows)
    const locationStoragePaths = locationIds.flatMap(id => [
      getLocationImagePath(id, "annotated"),
      getLocationImagePath(id, "original"),
    ]);
    const { data: detailImages } = await supabase.from('detail_images').select('annotated_path, original_path').in('location_id', locationIds);
    await removeStoragePaths([
      ...locationStoragePaths,
      ...(detailImages || []).flatMap((row) => [row.annotated_path, row.original_path]),
    ]);
    await (supabase as any).from("location_feedback").delete().in("location_id", locationIds);
    await supabase.from("location_approvals").delete().in("location_id", locationIds);
    await supabase.from("location_images").delete().in("location_id", locationIds);
    await supabase.from("location_pdfs").delete().in("location_id", locationIds);
    await supabase.from("detail_images").delete().in("location_id", locationIds);
    locationIds.forEach(id => {
      invalidateImageCache(`loc_${id}_annotated`);
      invalidateImageCache(`loc_${id}_original`);
    });
  }
  const { data: floorPlans } = await (supabase as any).from('floor_plans').select('id, storage_path').eq('project_id', projectId);
  await removeStoragePaths((floorPlans || []).map((row: any) => row.storage_path));
  await (supabase as any).from('floor_plans').delete().eq('project_id', projectId);
  (floorPlans || []).forEach((row: any) => invalidateImageCache(`floor_${row.id}`));
  await supabase.from("customer_project_assignments").delete().eq("project_id", projectId);
  await supabase.from("locations").delete().eq("project_id", projectId);
  const { error } = await supabase.from("projects").delete().eq('id', projectId);
  if (error) throw new Error("Projekt konnte nicht gelöscht werden: " + error.message);
}
