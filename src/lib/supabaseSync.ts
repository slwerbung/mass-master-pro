import { supabase } from "@/integrations/supabase/client";
import { indexedDBStorage } from "./indexedDBStorage";
import { getSession } from "./session";

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

async function syncLocationImage(locationId: string, imageData: string): Promise<void> {
  if (!imageData) return;

  try {
    const path = `images/${locationId}/annotated.jpg`;
    const uploaded = await uploadImageToStorage(path, imageData);
    if (!uploaded) return;

    await supabase
      .from("location_images")
      .upsert({
        location_id: locationId,
        image_type: "annotated",
        storage_path: path,
      }, { onConflict: "location_id,image_type" });
  } catch (e) {
    console.warn(`Image sync failed for ${locationId}:`, e);
  }
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
        if (loc.imageData) await syncLocationImage(loc.id, loc.imageData);
      }
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
        if (loc.imageData) await syncLocationImage(loc.id, loc.imageData);
      }
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

    if (location.imageData) await syncLocationImage(location.id, location.imageData);
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
