import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invokeFn } from "@/lib/api";
import { ProjectSearch } from "@/components/ProjectSearch";
import { errorText } from "@/lib/utils";

/** Mail einem HERO-Projekt zuordnen (Suche → Klick → Logbuch). Gleicher Weg wie in der Mail-Ansicht (email-action „assign“). */
export function useAssignProject(messageId: string, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: number) => invokeFn("email-action", { action: "assign", messageId, projectId }),
    onSuccess: () => {
      toast.success("Zugeordnet und ins Logbuch geschrieben.");
      ["message", "messages", "overview", "topics", "suggestions", "project-status"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onDone?.();
    },
    onError: (e) => toast.error(errorText(e)),
  });
}

export function AssignProject({ messageId, selectedId, onDone, autoFocus }: { messageId: string; selectedId?: number | null; onDone?: () => void; autoFocus?: boolean }) {
  const assign = useAssignProject(messageId, onDone);
  return (
    <div className="space-y-1">
      <ProjectSearch selectedId={selectedId} autoFocus={autoFocus}
        onPick={(p) => { if (!assign.isPending && confirm(`Mail dem Projekt ${p.nr} zuordnen und ins HERO-Logbuch schreiben?`)) assign.mutate(p.id); }} />
      {assign.isPending && <p className="text-xs text-muted-foreground">Wird zugeordnet …</p>}
    </div>
  );
}
