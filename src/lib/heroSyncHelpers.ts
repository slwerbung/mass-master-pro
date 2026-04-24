// Helpers around queuing HERO uploads. Handles:
//   - Checking if HERO integration is active (fire-and-forget)
//   - Extracting the HERO project_match id from a project's customFields
//   - Converting a data-URL or base64 image to a Blob
//
// Callers in the UI (LocationDetails, Export) use these so they don't
// have to know about the queue schema or config lookups.

import { indexedDBStorage } from "./indexedDBStorage";
import { pokeHeroUploadWorker } from "./heroUploadWorker";
import { supabase } from "@/integrations/supabase/client";

interface ProjectLike {
  id: string;
  customFields?: Record<string, string>;
}

// Cached because it's read on every enqueue; refreshed once per 60s.
let cachedConfig: { enabled: boolean; checkedAt: number } | null = null;
const CONFIG_CACHE_MS = 60_000;

export async function isHeroSyncActive(): Promise<boolean> {
  if (cachedConfig && Date.now() - cachedConfig.checkedAt < CONFIG_CACHE_MS) {
    return cachedConfig.enabled;
  }
  try {
    const { data } = await supabase
      .from("app_config")
      .select("key, value")
      .in("key", ["hero_api_key", "hero_enabled"]);
    const cfg = new Map((data || []).map((r: any) => [r.key, r.value]));
    const enabled = cfg.get("hero_enabled") === "true" && !!cfg.get("hero_api_key");
    cachedConfig = { enabled, checkedAt: Date.now() };
    return enabled;
  } catch (e) {
    console.warn("isHeroSyncActive: config read failed", e);
    return false;
  }
}

export function getHeroProjectMatchId(project: ProjectLike | null | undefined): number | null {
  const raw = project?.customFields?.__hero_project_id;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Convert a data URL (as stored in IndexedDB for images) to a Blob.
// Data URLs look like "data:image/jpeg;base64,<...>". If the input isn't
// a data URL we pass it through as a text blob, though this shouldn't
// normally happen for images.
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) {
    return new Blob([dataUrl], { type: "application/octet-stream" });
  }
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Central enqueue helper. Skips silently if HERO isn't configured or the
// project isn't linked. This is intentional - callers shouldn't have to
// branch on sync state.
export async function enqueueHeroUploadIfLinked(params: {
  project: ProjectLike;
  uploadType: "location_image" | "location_image_original" | "detail_image" | "detail_image_original" | "aufmass_pdf";
  blob: Blob;
  filename: string;
  locationId?: string;
  detailImageId?: string;
}): Promise<void> {
  if (!(await isHeroSyncActive())) return;
  const heroProjectMatchId = getHeroProjectMatchId(params.project);
  if (!heroProjectMatchId) return; // Project not linked to HERO - nothing to do

  await indexedDBStorage.enqueueHeroUpload({
    id: crypto.randomUUID(),
    projectId: params.project.id,
    heroProjectMatchId,
    uploadType: params.uploadType,
    locationId: params.locationId,
    detailImageId: params.detailImageId,
    blob: params.blob,
    filename: params.filename,
  });
  pokeHeroUploadWorker();
}
