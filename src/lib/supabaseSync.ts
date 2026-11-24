/**
 * Oeffentliche Sync-Schnittstelle der Seiten.
 *
 * Seit Sync v2 (Nov. 2026) steckt die Logik in `src/lib/sync/engine.ts`
 * (lokal zuerst, feldgenauer Abgleich, Konflikte, Live-Aktualisierung). Diese
 * Datei behaelt die bisherigen Funktionsnamen, damit die Seiten unveraendert
 * "nach jeder lokalen Aenderung scheduleSyncProject()" aufrufen koennen.
 *
 * Wichtig: Loeschungen brauchen keinen Vermerk mehr. Was lokal fehlt, aber
 * eine Basis (zuletzt bestaetigte Serverfassung) hat, wurde hier geloescht
 * und wird online geloescht.
 */
import { supabase } from "@/integrations/supabase/client";
import { indexedDBStorage } from "./indexedDBStorage";
import { Project } from "@/types/project";
import { downloadsIdle, forgetProject, flushNow, hasPendingPush, pullProject, requestPush, syncAll } from "./sync/engine";

/** Nach jeder lokalen Aenderung aufrufen: wird im Hintergrund hochgeladen. */
export function scheduleSyncProject(projectId: string): void {
  requestPush(projectId);
}

/** Steht fuer dieses Projekt noch ein Hochladen aus? */
export function hasPendingSync(projectId: string): boolean {
  return hasPendingPush(projectId);
}

/** Alles Lokale hochladen und die lokalen/eigenen Projekte abgleichen. */
export async function syncAllToSupabase(extraProjectIds: string[] = []): Promise<void> {
  await syncAll(extraProjectIds);
}

export async function syncProjectToSupabase(projectId: string): Promise<'uploaded' | 'skipped'> {
  requestPush(projectId, 0);
  await flushNow();
  const exists = await pullProject(projectId);
  return exists ? 'uploaded' : 'skipped';
}

export async function syncLocationToSupabase(projectId: string, _locationId: string): Promise<void> {
  requestPush(projectId, 0);
}

/**
 * Online-Fassung laden und mit dem lokalen Stand zusammenfuehren (nichts
 * Lokales geht verloren). Ergebnis ohne Originalfotos (Speicher).
 */
export async function hydrateProjectFromSupabase(projectId: string, opts: { waitForImages?: boolean } = {}): Promise<Project | null> {
  if (opts.waitForImages) {
    requestPush(projectId, 0);
    await flushNow();
  }
  const exists = await pullProject(projectId);
  if (!exists) return null;
  if (opts.waitForImages) {
    // Hoechstens 60 s auf die Bilder warten, dann mit dem vorhandenen Stand weiter.
    await Promise.race([downloadsIdle(), new Promise((r) => setTimeout(r, 60_000))]);
  }
  return indexedDBStorage.getProject(projectId, undefined, { withOriginals: false });
}

export async function getProjectRemoteTimestamp(projectId: string): Promise<Date | null> {
  const { data } = await supabase.from('projects').select('updated_at').eq('id', projectId).maybeSingle();
  return data?.updated_at ? new Date(data.updated_at) : null;
}

/** Nicht mehr noetig (Sync v2 erkennt Loeschungen selbst). Bleibt fuer alte Aufrufer. */
export function markLocationDeleted(_locationId: string): void { /* noop */ }
/** Nicht mehr noetig: lokal loeschen + scheduleSyncProject genuegt. */
export async function deleteDetailImageFromSupabase(_detailImageId: string): Promise<void> { /* noop */ }
/** Nicht mehr noetig: lokal loeschen + scheduleSyncProject genuegt. */
export async function deleteFloorPlanFromSupabase(_projectId: string, _floorPlanId: string): Promise<void> { /* noop */ }

async function removeStoragePaths(paths: (string | null | undefined)[]) {
  const uniquePaths = [...new Set(paths.filter(Boolean) as string[])];
  for (let i = 0; i < uniquePaths.length; i += 100) {
    await supabase.storage.from('project-files').remove(uniquePaths.slice(i, i + 100));
  }
}

/** Projekt online loeschen (nur mit Netz). */
export async function deleteProjectFromSupabase(projectId: string): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("Projekt löschen geht nur mit Internetverbindung.");
  }
  const { data: locations } = await supabase.from("locations").select("id").eq("project_id", projectId);
  const locationIds = (locations || []).map((l) => l.id);
  if (locationIds.length > 0) {
    const [{ data: images }, { data: detailImages }, { data: pdfRows }] = await Promise.all([
      supabase.from('location_images').select('storage_path').in('location_id', locationIds),
      supabase.from('detail_images').select('annotated_path, original_path').in('location_id', locationIds),
      // Druckdateien: alle Versionen (Spec D1), nicht nur die aktuelle.
      supabase.from('location_pdfs').select('storage_path').in('location_id', locationIds),
    ]);
    await removeStoragePaths([
      // Altbestand an festen Pfaden
      ...locationIds.flatMap((id) => [`images/${id}/annotated`, `images/${id}/original`]),
      ...(images || []).map((row: any) => row.storage_path),
      ...(detailImages || []).flatMap((row) => [row.annotated_path, row.original_path]),
      ...(pdfRows || []).map((row: any) => row.storage_path),
    ]);
    await (supabase as any).from("location_feedback").delete().in("location_id", locationIds);
    await supabase.from("location_approvals").delete().in("location_id", locationIds);
    await supabase.from("location_images").delete().in("location_id", locationIds);
    await supabase.from("location_pdfs").delete().in("location_id", locationIds);
    await supabase.from("detail_images").delete().in("location_id", locationIds);
  }
  const { data: floorPlans } = await (supabase as any).from('floor_plans').select('id, storage_path').eq('project_id', projectId);
  await removeStoragePaths((floorPlans || []).map((row: any) => row.storage_path));
  await (supabase as any).from('floor_plans').delete().eq('project_id', projectId);
  await supabase.from("customer_project_assignments").delete().eq("project_id", projectId);
  await supabase.from("locations").delete().eq("project_id", projectId);
  const { error } = await supabase.from("projects").delete().eq('id', projectId);
  if (error) throw new Error("Projekt konnte nicht gelöscht werden: " + error.message);
  forgetProject(projectId);
}
