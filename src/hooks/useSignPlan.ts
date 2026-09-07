import { useCallback, useEffect, useState } from 'react';
import { SignPlanData, emptySignPlanData } from '@/types/signPlan';
import { loadSignPlan, mutateSignPlan } from '@/lib/signPlanStorage';
import { scheduleSyncProject } from '@/lib/supabaseSync';
import { syncSignPlanProject } from '@/lib/signPlanSync';

/**
 * Zugriff auf den Leitsystem-Bestand eines Projekts.
 *
 * Geschrieben wird immer zuerst nach IndexedDB, der Abgleich mit Supabase
 * laeuft danach ueber den bestehenden, entprellten Projekt-Sync. Damit
 * funktioniert die Erfassung vor Ort auch ohne Netz – genau wie bei den
 * Standorten.
 */
export function useSignPlan(projectId: string | undefined) {
  const [data, setData] = useState<SignPlanData>(emptySignPlanData());
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) return;
    const loaded = await loadSignPlan(projectId);
    setData(loaded);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) return;
    setIsLoading(true);
    loadSignPlan(projectId)
      .then((loaded) => { if (!cancelled) setData(loaded); })
      .catch((error) => console.error('Leitsystem-Daten konnten nicht geladen werden', error))
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  /**
   * Eine Aenderung anwenden. Der Mutator arbeitet auf dem frisch aus
   * IndexedDB gelesenen Stand, nicht auf dem React-State – sonst wuerden
   * zwei schnell aufeinanderfolgende Klicks sich gegenseitig ueberschreiben.
   */
  const update = useCallback(async (mutator: (draft: SignPlanData) => void) => {
    if (!projectId) return;
    const next = await mutateSignPlan(projectId, mutator);
    setData({ ...next });
    scheduleSyncProject(projectId);
  }, [projectId]);

  /** Sofortiger Abgleich mit Supabase, z.B. per "Neu laden"-Knopf. */
  const syncNow = useCallback(async () => {
    if (!projectId) return;
    setIsSyncing(true);
    try {
      await syncSignPlanProject(projectId);
      await reload();
    } finally {
      setIsSyncing(false);
    }
  }, [projectId, reload]);

  return { data, isLoading, isSyncing, update, reload, syncNow };
}
