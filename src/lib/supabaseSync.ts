import { supabase } from "@/integrations/supabase/client";
import { indexedDBStorage } from "./indexedDBStorage";
import { getSession } from "./session";
import { Project, DetailImage, FloorPlan } from "@/types/project";
import { finishSyncError, finishSyncSuccess, startSync } from "./syncStatus";

function getLocationImagePath(locationId: string, imageType: "annotated" | "original") {
  return `images/${locationId}/${imageType}`;
}
function getDetailImagePath(locationId: string, detailImageId: string, imageType: "annotated" | "original") {
  return `detail-images/${locationId}/${detailImageId}/${imageType}`;
}
function getFloorPlanPath(projectId: string, floorPlanId: string) {
  return `floor-plans/${projectId}/${floorPlanId}`;
}

async function uploadImageToStorage(path: string, base64: string): Promise<string | null> {
  try {
    if (!base64 || !base64.includes(';base64,')) return null;
    const parts = base64.split(';base64,');
    const contentType = parts[0].split(':')[1] || 'image/jpeg';
    const raw = atob(parts[1]);
    const uInt8Array = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) uInt8Array[i] = raw.charCodeAt(i);
    const blob = new Blob([uInt8Array], { type: contentType });
    const { error } = await supabase.storage.from('project-files').upload(path, blob, { contentType, upsert: true });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

async function uploadBlobToStorage(path: string, blob: Blob): Promise<string | null> {
  try {
    const { error } = await supabase.storage.from('project-files').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
    if (error) return null;
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

async function syncImageVariant(locationId: string, imageType: "annotated" | "original", imageData: string): Promise<void> {
  if (!imageData) return;
  const path = getLocationImagePath(locationId, imageType);
  const uploaded = await uploadImageToStorage(path, imageData);
  if (!uploaded) return;
  await supabase.from("location_images").upsert({ location_id: locationId, image_type: imageType, storage_path: path }, { onConflict: "location_id,image_type" });
}

async function syncLocationImages(locationId: string, annotatedImage?: string, originalImage?: string): Promise<void> {
  const desiredTypes = new Set<string>();
  if (annotatedImage) { desiredTypes.add('annotated'); await syncImageVariant(locationId, "annotated", annotatedImage); }
  if (originalImage) { desiredTypes.add('original'); await syncImageVariant(locationId, "original", originalImage); }
  const { data: existingRows } = await supabase.from('location_images').select('image_type, storage_path').eq('location_id', locationId);
  const rowsToDelete = (existingRows || []).filter((row) => !desiredTypes.has(row.image_type));
  if (rowsToDelete.length) {
    await removeStoragePaths(rowsToDelete.map((row) => row.storage_path));
    await supabase.from('location_images').delete().eq('location_id', locationId).in('image_type', rowsToDelete.map((row) => row.image_type));
  }
}

async function syncDetailImage(detailImage: DetailImage, locationId: string): Promise<void> {
  const annotatedPath = getDetailImagePath(locationId, detailImage.id, 'annotated');
  const originalPath = getDetailImagePath(locationId, detailImage.id, 'original');
  const uploadedAnnotated = await uploadImageToStorage(annotatedPath, detailImage.imageData);
  const uploadedOriginal = await uploadImageToStorage(originalPath, detailImage.originalImageData || detailImage.imageData);
  if (!uploadedAnnotated || !uploadedOriginal) return;
  await supabase.from("detail_images").upsert({
    id: detailImage.id,
    location_id: locationId,
    caption: detailImage.caption || null,
    annotated_path: annotatedPath,
    original_path: originalPath,
    created_at: detailImage.createdAt instanceof Date ? detailImage.createdAt.toISOString() : new Date().toISOString(),
  }, { onConflict: "id" });
}

async function syncDetailImages(locationId: string, detailImages?: DetailImage[]): Promise<void> {
  const current = detailImages || [];
  const currentIds = new Set(current.map((d) => d.id));
  for (const detailImage of current) await syncDetailImage(detailImage, locationId);
  const { data: existingRows } = await supabase.from('detail_images').select('id, annotated_path, original_path').eq('location_id', locationId);
  const rowsToDelete = (existingRows || []).filter((row) => !currentIds.has(row.id));
  if (rowsToDelete.length) {
    await removeStoragePaths(rowsToDelete.flatMap((row) => [row.annotated_path, row.original_path]));
    await supabase.from('detail_images').delete().eq('location_id', locationId).in('id', rowsToDelete.map((row) => row.id));
  }
}

async function syncFloorPlan(projectId: string, floorPlan: FloorPlan): Promise<void> {
  const path = getFloorPlanPath(projectId, floorPlan.id);
  const uploaded = await uploadImageToStorage(path, floorPlan.imageData);
  if (!uploaded) return;
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
  for (const floorPlan of current) await syncFloorPlan(projectId, floorPlan);
  const { data: existingRows, error } = await (supabase as any).from('floor_plans').select('id, storage_path').eq('project_id', projectId);
  if (error) return;
  const rowsToDelete = (existingRows || []).filter((row) => !currentIds.has(row.id));
  if (rowsToDelete.length) {
    await removeStoragePaths(rowsToDelete.map((row) => row.storage_path));
    await (supabase as any).from('floor_plans').delete().eq('project_id', projectId).in('id', rowsToDelete.map((row: any) => row.id));
  }
}

async function pathToBase64(path: string): Promise<string | null> {
  try {
    const { data } = supabase.storage.from("project-files").getPublicUrl(path);
    const response = await fetch(data.publicUrl);
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

export async function getProjectRemoteTimestamp(projectId: string): Promise<Date | null> {
  const { data } = await supabase.from('projects').select('updated_at').eq('id', projectId).maybeSingle();
  return data?.updated_at ? new Date(data.updated_at) : null;
}

export async function hydrateProjectFromSupabase(projectId: string): Promise<Project | null> {
  const { data: projectRow, error: projectError } = await supabase.from("projects").select("id, project_number, project_type, employee_id, created_at, updated_at").eq("id", projectId).single();
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
    const { data: imageRows, error: imageError } = await supabase.from("location_images").select("location_id, image_type, storage_path").in("location_id", locationIds);
    if (imageError) throw imageError;
    for (const row of imageRows || []) {
      const entry = imageMap.get(row.location_id) || {};
      const base64 = await pathToBase64(row.storage_path);
      if (base64) {
        if (row.image_type === "annotated") entry.annotated = base64;
        if (row.image_type === "original") entry.original = base64;
      }
      imageMap.set(row.location_id, entry);
    }

    const { data: detailRows, error: detailError } = await supabase.from("detail_images").select("id, location_id, caption, annotated_path, original_path, created_at").in("location_id", locationIds).order("created_at");
    if (detailError) throw detailError;
    for (const row of detailRows || []) {
      const annotated = await pathToBase64(row.annotated_path);
      const original = await pathToBase64(row.original_path);
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
    }
  }

  const { data: assignmentRows } = await (supabase as any)
    .from('project_employee_assignments')
    .select('employee_id')
    .eq('project_id', projectId);

  const { data: floorPlanRows } = await (supabase as any).from("floor_plans").select("id, name, storage_path, markers, page_index, created_at").eq("project_id", projectId).order("page_index");
  const floorPlans: FloorPlan[] = [];
  for (const row of floorPlanRows || []) {
    const imageData = await pathToBase64(row.storage_path);
    floorPlans.push({
      id: row.id,
      name: row.name,
      imageData: imageData || "",
      markers: Array.isArray(row.markers) ? row.markers as any : [],
      pageIndex: row.page_index,
      createdAt: new Date(row.created_at),
    });
  }

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

  const hydratedProject: Project = {
    id: projectRow.id,
    projectNumber: projectRow.project_number,
    projectType: (projectRow as any).project_type === 'aufmass_mit_plan' ? 'aufmass_mit_plan' : 'aufmass',
    employeeId: (projectRow as any).employee_id || null,
    accessEmployeeIds: Array.from(new Set([((projectRow as any).employee_id || null), ...((assignmentRows || []).map((row: any) => row.employee_id))].filter(Boolean))),
    locations,
    floorPlans,
    createdAt: new Date(projectRow.created_at),
    updatedAt: new Date(projectRow.updated_at),
  };
  await indexedDBStorage.saveProject(hydratedProject);
  return hydratedProject;
}

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
  const { data: remoteLocationImages } = await supabase.from('location_images').select('storage_path').in('location_id', deletedLocationIds);
  const { data: remoteDetailImages } = await supabase.from('detail_images').select('annotated_path, original_path').in('location_id', deletedLocationIds);
  await removeStoragePaths([...(remoteLocationImages || []).map((row) => row.storage_path), ...(remoteDetailImages || []).flatMap((row) => [row.annotated_path, row.original_path])]);
  await (supabase as any).from('location_feedback').delete().in('location_id', deletedLocationIds);
  await supabase.from('location_approvals').delete().in('location_id', deletedLocationIds);
  await supabase.from('location_pdfs').delete().in('location_id', deletedLocationIds);
  await supabase.from('detail_images').delete().in('location_id', deletedLocationIds);
  await supabase.from('location_images').delete().in('location_id', deletedLocationIds);
  await supabase.from('locations').delete().eq('project_id', project.id).in('id', deletedLocationIds);
}

async function syncProjectInternal(projectId: string): Promise<'uploaded' | 'remote-won' | 'skipped'> {
  const session = getSession();
  // Use lightweight getProject — but we need locations for sync.
  // Instead of loading full project (with base64 images), read raw records directly.
  const project = await indexedDBStorage.getProject(projectId, session);
  if (!project) return 'skipped';
  const remoteUpdatedAt = await getProjectRemoteTimestamp(projectId);
  if (remoteUpdatedAt && remoteUpdatedAt.getTime() > project.updatedAt.getTime() + 1000) {
    await hydrateProjectFromSupabase(projectId);
    return 'remote-won';
  }
  const syncTimestamp = new Date().toISOString();
  // Check if project already exists remotely to preserve existing employee_id
  const { data: existingProject } = await supabase.from('projects').select('employee_id, user_id').eq('id', project.id).maybeSingle();
  const employeeId = existingProject?.employee_id ?? project.employeeId ?? (session?.role === 'employee' ? session.id : null);
  const userId = existingProject?.user_id ?? (project.employeeId || (session?.role === 'employee' ? session.id : project.id));
  await supabase.from('projects').upsert({
    id: project.id,
    project_number: project.projectNumber,
    project_type: project.projectType || 'aufmass',
    user_id: userId,
    employee_id: employeeId,
    created_at: project.createdAt instanceof Date ? project.createdAt.toISOString() : new Date().toISOString(),
    updated_at: syncTimestamp,
  } as any, { onConflict: 'id' });

  if (project.locations?.length) {
    await supabase.from('locations').upsert(buildLocationRows(project), { onConflict: 'id' });
    for (const loc of project.locations) {
      await syncLocationImages(loc.id, loc.imageData, loc.originalImageData);
      await syncDetailImages(loc.id, loc.detailImages);
    }
  }

  await removeDeletedLocationsFromSupabase(project);
  await syncFloorPlans(project.id, project.floorPlans);
  // Only update timestamp, don't re-save all images
  await indexedDBStorage.updateProjectTimestamp(project.id, syncTimestamp);
  return 'uploaded';
}

export async function syncAllToSupabase(): Promise<void> {
  startSync();
  try {
    const projectIds = await indexedDBStorage.getProjectIds(getSession());
    for (const id of projectIds) await syncProjectInternal(id);
    finishSyncSuccess();
  } catch (e) {
    finishSyncError(e);
    throw e;
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
}

export async function deleteDetailImageFromSupabase(detailImageId: string): Promise<void> {
  const { data } = await supabase.from('detail_images').select('annotated_path, original_path').eq('id', detailImageId).maybeSingle();
  await removeStoragePaths([data?.annotated_path, data?.original_path]);
  await supabase.from('detail_images').delete().eq('id', detailImageId);
}

export async function deleteProjectFromSupabase(projectId: string): Promise<void> {
  const { data: locations } = await supabase.from("locations").select("id").eq("project_id", projectId);
  const locationIds = (locations || []).map((l) => l.id);
  if (locationIds.length > 0) {
    const { data: locationImages } = await supabase.from('location_images').select('storage_path').in('location_id', locationIds);
    const { data: detailImages } = await supabase.from('detail_images').select('annotated_path, original_path').in('location_id', locationIds);
    await removeStoragePaths([...(locationImages || []).map((row) => row.storage_path), ...(detailImages || []).flatMap((row) => [row.annotated_path, row.original_path])]);
    await (supabase as any).from("location_feedback").delete().in("location_id", locationIds);
    await supabase.from("location_approvals").delete().in("location_id", locationIds);
    await supabase.from("location_images").delete().in("location_id", locationIds);
    await supabase.from("location_pdfs").delete().in("location_id", locationIds);
    await supabase.from("detail_images").delete().in("location_id", locationIds);
  }
  const { data: floorPlans } = await (supabase as any).from('floor_plans').select('storage_path').eq('project_id', projectId);
  await removeStoragePaths((floorPlans || []).map((row: any) => row.storage_path));
  await (supabase as any).from('floor_plans').delete().eq('project_id', projectId);
  await supabase.from("customer_project_assignments").delete().eq("project_id", projectId);
  await supabase.from("locations").delete().eq("project_id", projectId);
  const { error } = await supabase.from("projects").delete().eq('id', projectId);
  if (error) throw new Error("Projekt konnte nicht gelöscht werden: " + error.message);
}
