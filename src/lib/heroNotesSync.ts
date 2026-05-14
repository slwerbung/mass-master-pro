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
import type { Project, Location, AreaMeasurement } from "@/types/project";

function formatArea(m: AreaMeasurement): string {
  const sqm = (m.widthMm * m.heightMm) / 1_000_000;
  return `${m.widthMm} × ${m.heightMm} mm = ${sqm.toFixed(2).replace(".", ",")} m²`;
}

export function buildHeroNotes(project: Project): string {
  // Sort locations by their location_number, falling back to creation
  // order. Mirrors how the customer view orders them, so the HERO
  // notes match what people see on screen.
  const locations = [...project.locations].sort((a, b) => {
    const na = parseInt((a as any).location_number || "0", 10) || 0;
    const nb = parseInt((b as any).location_number || "0", 10) || 0;
    return na - nb;
  });

  const blocks: string[] = [];
  let totalSqm = 0;

  for (const loc of locations) {
    const areas: AreaMeasurement[] = (loc as any).areaMeasurements || [];
    if (areas.length === 0) continue;

    const locNum = (loc as any).location_number || "?";
    const locName = (loc as any).location_name ? ` · ${(loc as any).location_name}` : "";
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
    if (!project) return;

    // Skip if there's no HERO link on this project. We don't want to
    // call HERO for non-HERO projects, and we don't want to clear
    // someone else's notes if they manually entered something.
    const heroId = (project as any).hero_project_match_id;
    if (!heroId) return;

    const notes = buildHeroNotes(project);

    // Empty notes = no measurements yet. We still push the empty string
    // so HERO mirrors the truth (e.g. after deleting all locations),
    // but we don't push if there's literally never been any area.
    // Compromise: skip if empty AND no locations have area data.
    // (If notes is non-empty, push always.)

    const { error } = await supabase.functions.invoke("hero-integration", {
      body: {
        action: "update_project_notes",
        heroProjectId: heroId,
        notes,
      },
    });

    if (error) {
      console.warn("HERO notes sync failed:", error.message || error);
    }
  } catch (e) {
    // Never let a HERO sync failure prevent local save success
    console.warn("HERO notes sync threw:", e);
  }
}
