// Spec E: Archiv-Status im Projekt – Banner bei archivierten Projekten (+ Reaktivieren), Pin „Nicht automatisch
// archivieren“. Beim Verlassen eines archivierten Projekts wird die lokale Kopie entfernt (ohne offene Änderungen).
import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { evictArchivedProjects } from "@/lib/archiveEviction";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { projectArchiveAction } from "@/lib/projectArchive";

interface ArchiveState { archived_at: string | null; archive_pinned: boolean; compacted_at: string | null; updated_at: string | null }

export function useProjectArchive(projectId: string | undefined) {
  const [state, setState] = useState<ArchiveState | null>(null);
  const ref = useRef<ArchiveState | null>(null);
  const load = useCallback(async () => {
    if (!projectId) return;
    const { data } = await (supabase as any).from("projects").select("archived_at, archive_pinned, compacted_at, updated_at").eq("id", projectId).maybeSingle();
    setState(data ?? null);
    ref.current = data ?? null;
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  // Archiviertes Projekt nicht dauerhaft auf dem Gerät halten.
  useEffect(() => () => {
    const s = ref.current;
    if (projectId && s?.archived_at) evictArchivedProjects([{ id: projectId, archived_at: s.archived_at, updated_at: s.updated_at }]).catch(() => null);
  }, [projectId]);

  const togglePin = async () => {
    if (!projectId || !state) return;
    try {
      await projectArchiveAction("set_pinned", projectId, !state.archive_pinned);
      toast.success(state.archive_pinned ? "Wird wieder automatisch archiviert" : "Wird nicht mehr automatisch archiviert");
      load();
    } catch (e: any) { toast.error(e?.message || "Nicht geändert"); }
  };
  const reactivate = async () => {
    if (!projectId || !state) return;
    if (state.compacted_at && !confirm("Fotos wurden verkleinert, gelöschte Originale/alte Versionen kommen nicht zurück. Trotzdem reaktivieren?")) return;
    try {
      if (state.compacted_at) await indexedDBStorage.deleteProject(projectId).catch(() => null);
      await projectArchiveAction("unarchive", projectId);
      toast.success("Projekt reaktiviert");
      await load();
      if (state.compacted_at) window.location.reload(); // frisch vom Server laden
    } catch (e: any) { toast.error(e?.message || "Nicht reaktiviert"); }
  };
  return { state, togglePin, reactivate };
}

export function ArchivePinButton({ archive }: { archive: ReturnType<typeof useProjectArchive> }) {
  if (!archive.state || archive.state.archived_at) return null;
  const pinned = archive.state.archive_pinned;
  return (
    <Button variant="ghost" size="icon" className={`h-9 w-9 ${pinned ? "text-primary" : ""}`} onClick={archive.togglePin}
      title={pinned ? "Wird nicht automatisch archiviert – Klick hebt das auf" : "Nicht automatisch archivieren"}>
      {pinned ? <Pin className="h-4 w-4 fill-current" /> : <PinOff className="h-4 w-4" />}
    </Button>
  );
}

export function ArchivedBanner({ archive }: { archive: ReturnType<typeof useProjectArchive> }) {
  if (!archive.state?.archived_at) return null;
  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="container mx-auto flex max-w-4xl flex-wrap items-center gap-2">
        <Archive className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          Archiviertes Projekt – Änderungen reaktivieren das Projekt nicht automatisch.
          {archive.state.compacted_at && " Fotos wurden zum Platzsparen verkleinert."}
        </span>
        <Button size="sm" variant="outline" className="h-7" onClick={archive.reactivate}>
          <ArchiveRestore className="mr-1 h-3.5 w-3.5" /> Reaktivieren
        </Button>
      </div>
    </div>
  );
}
