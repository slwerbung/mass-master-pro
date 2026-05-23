// Mirrors the area measurements of all locations in a project into the
// HERO project's notes field, so the field guys see the same data in
// HERO that they see in Captfix. Runs after every location save when
// the project has a hero_project_match_id set.
//
// Strategy: completely rewrite the notes field on every save. HERO has
// a single notes textarea per project, no history/append API. To keep
// it always current we read all locations from the local store, build
// the markdown-ish text, and call update_project_match via the
// hero-integration edge function.
//
// The mutation is best-effort: if HERO is down or the field name
// differs, we log a warning but don't block the user's save flow.

import { supabase } from "@/integrations/supabase/client";
import { indexedDBStorage } from "./indexedDBStorage";
import { getHeroProjectMatchId } from "./heroSyncHelpers";
import type { Project, Location, AreaMeasurement } from "@/types/project";

function formatArea(m: AreaMeasurement): string {
  const sqm = (m.widthMm * m.heightMm) / 1_000_000;
  // Prefix with the area index (F1, F2, ...) so the HERO notes match
  // exactly what's shown on the location detail screen.
  return `F${m.index}: ${m.widthMm} × ${m.heightMm} mm = ${sqm.toFixed(2).replace(".", ",")} m²`;
}

export function buildHeroNotes(project: Project): string {
  // Sort locations by their locationNumber, falling back to creation
  // order. Mirrors how the customer view orders them, so the HERO
  // notes match what people see on screen.
  const locations = [...project.locations].sort((a, b) => {
    const na = parseInt(a.locationNumber || "0", 10) || 0;
    const nb = parseInt(b.locationNumber || "0", 10) || 0;
    return na - nb;
  });

  const blocks: string[] = [];
  let totalSqm = 0;

  for (const loc of locations) {
    const areas: AreaMeasurement[] = loc.areaMeasurements || [];
    if (areas.length === 0) continue;

    const locNum = loc.locationNumber || "?";
    const locName = loc.locationName ? ` · ${loc.locationName}` : "";
    const header = `Standort ${locNum}${locName}`;
    const lines = areas.map(formatArea);
    const locTotal = areas.reduce((s, a) => s + (a.widthMm * a.heightMm) / 1_000_000, 0);
    totalSqm += locTotal;
    blocks.push([header, ...lines].join("\n"));
  }

  if (blocks.length === 0) return "";

  const body = blocks.join("\n\n");
  const footer = `\n\nGesamt: ${totalSqm.toFixed(2).replace(".", ",")} m²`;
  return body + footer;
}

export async function updateHeroNotesIfLinked(projectId: string): Promise<void> {
  try {
    const project = await indexedDBStorage.getProject(projectId);
    if (!project) {
      console.log("HERO notes sync: project not found in IndexedDB", projectId);
      return;
    }

    // HERO project match id lives in customFields.__hero_project_id
    // (the existing helper unpacks it consistently with the rest of
    // the HERO sync code).
    const heroId = getHeroProjectMatchId(project as any);
    if (!heroId) {
      console.log("HERO notes sync: project not linked to HERO, skipping", projectId);
      return;
    }

    const notes = buildHeroNotes(project);
    console.log("HERO notes sync: pushing to project", heroId, "length:", notes.length);

    // Dedicated server-side function (service role, reads HERO key from
    // app_config). Mirrors the vehicle-inquiry flow that writes
    // partner_notes reliably. We await this in the callers BEFORE any
    // navigate(), so the request always completes.
    const { data, error } = await supabase.functions.invoke("update-hero-notes", {
      body: {
        heroProjectId: heroId,
        notes,
      },
    });

    if (error) {
      console.warn("HERO notes sync failed:", error.message || error);
    } else {
      console.log("HERO notes sync result:", data);
    }
  } catch (e) {
    // Never let a HERO sync failure prevent local save success
    console.warn("HERO notes sync threw:", e);
  }
}
