import { supabase } from "@/integrations/supabase/client";
import { indexedDBStorage } from "./indexedDBStorage";
import { getSession } from "./session";

// Convert base64 to Blob for upload
function base64ToBlob(base64: string): Blob {
  const parts = base64.split(';base64,');
  const contentType = parts[0].split(':')[1] || 'image/jpeg';
  const raw = atob(parts[1]);
  const uInt8Array = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) uInt8Array[i] = raw.charCodeAt(i);
  return new Blob([uInt8Array], { type: contentType });
}

// Upload image to Supabase Storage and register in location_images
async function syncLocationImage(locationId: string, imageData: string, imageType: 'annotated' | 'original'): Promise<void> {
  if (!imageData) return;
  try {
    const path = `images/${locationId}/${imageType}.jpg`;
    // Check if already uploaded
    const { data: existing } = await supabase.from("location_images")
      .select("id").eq("location_id", locationId).eq("image_type", imageType).maybeSingle();
    if (existing) return; // Already synced

    const blob = base64ToBlob(imageData);
    const { error: uploadError } = await supabase.storage.from("project-files").upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (uploadError) return;

    await supabase.from("location_images").upsert({
      location_id: locationId,
      image_type: imageType,
      storage_path: path,
    }, { onConflict: "location_id,image_type" });
  } catch (e) {
    console.warn(`Image sync failed for ${locationId}:`, e);
  }
}

// Automatically sync all projects and locations to Supabase
// Called silently in background - errors are non-fatal
export async function syncAllToSupabase(): Promise<void> {
  try {
    const session = getSession();
    const projects = await indexedDBStorage.getProjects();
    if (projects.length === 0) return;

    // 1. Sync projects
    const projectRows = projects.map(p => ({
      id: p.id,
      project_number: p.projectNumber,
      user_id: session?.id || "employee",
      employee_id: session?.role === "employee" ? session.id : null,
      created_at: p.createdAt instanceof Date ? p.createdAt.toISOString() : new Date().toISOString(),
      updated_at: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : new Date().toISOString(),
    }));
    await supabase.from("projects").upsert(projectRows, { onConflict: "id" });

    // 2. Sync locations for each project
    for (const project of projects) {
      if (!project.locations || project.locations.length === 0) continue;
      const locationRows = project.locations.map(l => ({
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
      await supabase.from("locations").upsert(locationRows, { onConflict: "id" });
      // Sync annotated images to Storage
      for (const loc of project.locations) {
        if (loc.imageData) await syncLocationImage(loc.id, loc.imageData, 'annotated');
      }
    }
  } catch (e) {
    // Silent fail - sync is best-effort
    console.warn("Background sync failed:", e);
  }
}

// Sync a single project and its locations
export async function syncProjectToSupabase(projectId: string): Promise<void> {
  try {
    const session = getSession();
    const project = await indexedDBStorage.getProject(projectId);
    if (!project) return;

    // Sync project
    await supabase.from("projects").upsert({
      id: project.id,
      project_number: project.projectNumber,
      user_id: session?.id || "employee",
      employee_id: session?.role === "employee" ? session.id : null,
      created_at: project.createdAt instanceof Date ? project.createdAt.toISOString() : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

    // Sync locations
    if (project.locations && project.locations.length > 0) {
      const locationRows = project.locations.map(l => ({
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
      await supabase.from("locations").upsert(locationRows, { onConflict: "id" });
      // Sync images
      for (const loc of project.locations) {
        if (loc.imageData) await syncLocationImage(loc.id, loc.imageData, 'annotated');
      }
    }
  } catch (e) {
    console.warn("Project sync failed:", e);
  }
}

// Sync a single location
export async function syncLocationToSupabase(projectId: string, locationId: string): Promise<void> {
  try {
    const project = await indexedDBStorage.getProject(projectId);
    if (!project) return;
    const location = project.locations.find(l => l.id === locationId);
    if (!location) return;

    await supabase.from("locations").upsert({
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
    }, { onConflict: "id" });
  } catch (e) {
    console.warn("Location sync failed:", e);
  }
}
