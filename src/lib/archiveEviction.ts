// Spec E: Archivierte Projekte verschwinden aus dem lokalen Speicher der Geräte (nur lokal – nie auf dem Server löschen).
// Projekte mit noch nicht synchronisierten Änderungen bleiben, bis der Sync durch ist.
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { hasPendingSync } from "@/lib/supabaseSync";

/** Lokal entfernen? archiviert, kein Sync offen, lokaler Stand nicht neuer als der Server (1 s Toleranz). */
export function shouldEvict(o: { archived: boolean; pending: boolean; localUpdatedAt: Date | null; serverUpdatedAt: Date | null }): boolean {
  if (!o.archived || o.pending) return false;
  if (o.localUpdatedAt && o.serverUpdatedAt && o.localUpdatedAt.getTime() > o.serverUpdatedAt.getTime() + 1000) return false;
  return true;
}

/** Alle lokal liegenden Projekte prüfen, die laut Server archiviert sind. Gibt die Zahl der entfernten zurück. */
export async function evictArchivedProjects(server: { id: string; archived_at: string | null; updated_at?: string | null }[]): Promise<number> {
  const byId = new Map(server.map((p) => [p.id, p]));
  let n = 0;
  try {
    for (const local of await indexedDBStorage.listLocalProjectStamps()) {
      const sp = byId.get(local.id);
      if (!sp?.archived_at) continue;
      const evict = shouldEvict({
        archived: true, pending: hasPendingSync(local.id), localUpdatedAt: local.updatedAt,
        serverUpdatedAt: sp.updated_at ? new Date(sp.updated_at) : null,
      });
      if (!evict) continue;
      await indexedDBStorage.deleteProject(local.id);
      n++;
    }
  } catch (e) {
    console.warn("archiveEviction:", e);
  }
  return n;
}
