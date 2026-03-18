import { supabase } from "@/integrations/supabase/client";
import { indexedDBStorage } from "./indexedDBStorage";
import { getSession } from "./session";
import { Project, Location, DetailImage, FloorPlan } from "@/types/project";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Upload image blob directly to Supabase Storage
async function uploadImageToStorage(path: string, base64: string): Promise<string | null> {
  try {
    if (!base64 || !base64.includes(';base64,')) return null;
    
    const parts = base64.split(';base64,');
    const contentType = parts[0].split(':')[1] || 'image/jpeg';
    const raw = atob(parts[1]);
    const uInt8Array = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) uInt8Array[i] = raw.charCodeAt(i);
    const blob = new Blob([uInt8Array], { type: contentType });

    const { error } = await supabase.storage
      .from('project-files')
      .upload(path, blob, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.warn('Storage upload failed:', error.message);
      return null;
    }

    return path;
  } catch (e) {
    console.warn('Image upload error:', e);
    return null;
  }
}

async function syncImageVariant(locationId: string, imageType: "annotated" | "original", imageData: string): Promise<void> {
  if (!imageData) return;

  try {
    const extension = imageData.includes("image/png") ? "png" : "jpg";
    const path = `images/${locationId}/${imageType}.${extension}`;
    const uploaded = await uploadImageToStorage(path, imageData);
    if (!uploaded) return;

    await supabase
      .from("location_images")
      .upsert({
        location_id: locationId,
        image_type: imageType,
        storage_path: path,
      }, { onConflict: "location_id,image_type" });
  } catch (e) {
    console.warn(`Image sync failed for ${locationId}/${imageType}:`, e);
  }
}

async function syncLocationImages(locationId: string, annotatedImage?: string, originalImage?: string): Promise<void> {
  if (annotatedImage) await syncImageVariant(locationId, "annotated", annotatedImage);
  if (originalImage) await syncImageVariant(locationId, "original", originalImage);
}



async function syncDetailImage(detailImage: DetailImage, locationId: string): Promise<void> {
  try {
    const annotatedExtension = detailImage.imageData.includes("image/png") ? "png" : "jpg";
    const originalExtension = detailImage.originalImageData?.includes("image/png") ? "png" : annotatedExtension;

    const annotatedPath = `detail-images/${locationId}/${detailImage.id}/annotated.${annotatedExtension}`;
    const originalPath = `detail-images/${locationId}/${detailImage.id}/original.${originalExtension}`;

    const uploadedAnnotated = await uploadImageToStorage(annotatedPath, detailImage.imageData);
    const uploadedOriginal = await uploadImageToStorage(originalPath, detailImage.originalImageData || detailImage.imageData);

    if (!uploadedAnnotated || !uploadedOriginal) return;

    await supabase
      .from("detail_images")
      .upsert({
        id: detailImage.id,
        location_id: locationId,
        caption: detailImage.caption || null,
        annotated_path: annotatedPath,
        original_path: originalPath,
        created_at: detailImage.createdAt instanceof Date ? detailImage.createdAt.toISOString() : new Date().toISOString(),
      }, { onConflict: "id" });
  } catch (e) {
    console.warn(`Detail image sync failed for ${detailImage.id}:`, e);
  }
}

async function syncDetailImages(locationId: string, detailImages?: DetailImage[]): Promise<void> {
  if (!detailImages || detailImages.length === 0) return;
  for (const detailImage of detailImages) {
    await syncDetailImage(detailImage, locationId);
  }
}

async function syncFloorPlan(projectId: string, floorPlan: FloorPlan): Promise<void> {
  try {
    const extension = floorPlan.imageData.includes("image/jpeg") ? "jpg" : "png";
    const path = `floor-plans/${projectId}/${floorPlan.id}.${extension}`;
    const uploaded = await uploadImageToStorage(path, floorPlan.imageData);
    if (!uploaded) return;

    await supabase
      .from("floor_plans")
      .upsert({
        id: floorPlan.id,
        project_id: projectId,
        name: floorPlan.name,
        storage_path: path,
        markers: floorPlan.markers as any,
        page_index: floorPlan.pageIndex,
        created_at: floorPlan.createdAt instanceof Date ? floorPlan.createdAt.toISOString() : new Date().toISOString(),
      }, { onConflict: "id" });
  } catch (e) {
    console.warn(`Floor plan sync failed for ${floorPlan.id}:`, e);
  }
}

async function syncFloorPlans(projectId: string, floorPlans?: FloorPlan[]): Promise<void> {
  if (!floorPlans || floorPlans.length === 0) return;
  for (const floorPlan of floorPlans) {
    await syncFloorPlan(projectId, floorPlan);
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
  } catch (e) {
    console.warn(`Image download failed for ${path}:`, e);
    return null;
  }
}

export async function hydrateProjectFromSupabase(projectId: string): Promise<Project | null> {
  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("id, project_number, created_at, updated_at")
    .eq("id", projectId)
    .single();

  if (projectError || !projectRow) return null;

  const { data: locationRows, error: locationError } = await supabase
    .from("locations")
    .select("id, location_number, location_name, comment, system, label, location_type, created_at")
    .eq("project_id", projectId)
    .order("created_at");

  if (locationError) throw locationError;

  const locationIds = (locationRows || []).map((row) => row.id);
  const imageMap = new Map<string, { annotated?: string; original?: string }>();
  const detailImageMap = new Map<string, DetailImage[]>();

  if (locationIds.length > 0) {
    const { data: imageRows, error: imageError } = await supabase
      .from("location_images")
      .select("location_id, image_type, storage_path")
      .in("location_id", locationIds);

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

    const { data: detailRows, error: detailError } = await supabase
      .from("detail_images")
      .select("id, location_id, caption, annotated_path, original_path, created_at")
      .in("location_id", locationIds)
      .order("created_at");

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

  const { data: floorPlanRows, error: floorPlanError } = await supabase
    .from("floor_plans")
    .select("id, name, storage_path, markers, page_index, created_at")
    .eq("project_id", projectId)
    .order("page_index");

  if (floorPlanError) {
    const message = String(floorPlanError.message || "");
    if (!message.toLowerCase().includes("floor_plans")) throw floorPlanError;
  }

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

  const locations: Location[] = (locationRows || []).map((row) => {
    const images = imageMap.get(row.id) || {};
    const annotated = images.annotated || images.original || "";
    const original = images.original || images.annotated || "";

    return {
      id: row.id,
      locationNumber: row.location_number,
      locationName: row.location_name || undefined,
      comment: row.comment || undefined,
      system: row.system || undefined,
      label: row.label || undefined,
      locationType: row.location_type || undefined,
      imageData: annotated,
      originalImageData: original,
      createdAt: new Date(row.created_at),
      detailImages: detailImageMap.get(row.id) || [],
    };
  });

  const hydratedProject: Project = {
    id: projectRow.id,
    projectNumber: projectRow.project_number,
    locations,
    floorPlans,
    createdAt: new Date(projectRow.created_at),
    updatedAt: new Date(projectRow.updated_at),
  };

  await indexedDBStorage.saveProject(hydratedProject);
  return hydratedProject;
}

function buildLocationRows(project: any) {
  return project.locations.map((l: any) => ({
    id: l.id,
    project_id: project.id,
    location_number: l.locationNumber,
    location_name: l.locationName || null,
    comment: l.comment || null,
    system: l.system || null,
    label: l.label || null,
    location_type: l.locationType || null,
    guest_info: null,
    created_at: l.createdAt instanceof Date ? l.createdAt.toISOString() : new Date().toISOString(),
  }));
}

export async function syncAllToSupabase(): Promise<void> {
  try {
    const session = getSession();
    const projects = await indexedDBStorage.getProjects();
    if (projects.length === 0) return;

    const projectRows = projects.map((p) => ({
      id: p.id,
      project_number: p.projectNumber,
      user_id: session?.id || "employee",
      employee_id: session?.role === "employee" ? session.id : null,
      created_at: p.createdAt instanceof Date ? p.createdAt.toISOString() : new Date().toISOString(),
      updated_at: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : new Date().toISOString(),
    }));

    await supabase.from("projects").upsert(projectRows, { onConflict: "id" });

    for (const project of projects) {
      if (!project.locations || project.locations.length === 0) continue;
      await supabase.from("locations").upsert(buildLocationRows(project), { onConflict: "id" });

      for (const loc of project.locations) {
        await syncLocationImages(loc.id, loc.imageData, loc.originalImageData);
        await syncDetailImages(loc.id, loc.detailImages);
      }

      await syncFloorPlans(project.id, project.floorPlans);
    }
  } catch (e) {
    console.warn("Background sync failed:", e);
  }
}

export async function syncProjectToSupabase(projectId: string): Promise<void> {
  try {
    const session = getSession();
    const project = await indexedDBStorage.getProject(projectId);
    if (!project) return;

    await supabase.from("projects").upsert(
      {
        id: project.id,
        project_number: project.projectNumber,
        user_id: session?.id || "employee",
        employee_id: session?.role === "employee" ? session.id : null,
        created_at: project.createdAt instanceof Date ? project.createdAt.toISOString() : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (project.locations && project.locations.length > 0) {
      await supabase.from("locations").upsert(buildLocationRows(project), { onConflict: "id" });

      for (const loc of project.locations) {
        await syncLocationImages(loc.id, loc.imageData, loc.originalImageData);
        await syncDetailImages(loc.id, loc.detailImages);
      }

      await syncFloorPlans(project.id, project.floorPlans);
    }
  } catch (e) {
    console.warn("Project sync failed:", e);
  }
}

export async function syncLocationToSupabase(projectId: string, locationId: string): Promise<void> {
  try {
    const project = await indexedDBStorage.getProject(projectId);
    if (!project) return;
    const location = project.locations.find((l) => l.id === locationId);
    if (!location) return;

    await supabase.from("locations").upsert(
      {
        id: location.id,
        project_id: projectId,
        location_number: location.locationNumber,
        location_name: location.locationName || null,
        comment: location.comment || null,
        system: location.system || null,
        label: location.label || null,
        location_type: location.locationType || null,
        guest_info: null,
        created_at: location.createdAt instanceof Date ? location.createdAt.toISOString() : new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    await syncLocationImages(location.id, location.imageData, location.originalImageData);
    await syncDetailImages(location.id, location.detailImages);
    await syncFloorPlans(projectId, project.floorPlans);
  } catch (e) {
    console.warn("Location sync failed:", e);
  }
}

export async function deleteProjectFromSupabase(projectId: string): Promise<void> {
  // Get location IDs first
  const { data: locations } = await supabase
    .from("locations")
    .select("id")
    .eq("project_id", projectId);

  const locationIds = (locations || []).map((l) => l.id);

  if (locationIds.length > 0) {
    // Delete child records - ignore errors (tables may not exist)
    await supabase.from("location_approvals").delete().in("location_id", locationIds);
    await supabase.from("location_images").delete().in("location_id", locationIds);
    await supabase.from("location_pdfs").delete().in("location_id", locationIds);
  }

  // Delete customer assignments
  await supabase.from("customer_project_assignments").delete().eq("project_id", projectId);

  // Delete locations
  await supabase.from("locations").delete().eq("project_id", projectId);

  // Delete project - this is the critical one
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw new Error("Projekt konnte nicht gelöscht werden: " + error.message);
}
