import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserCheck, UserX } from "lucide-react";
import { api } from "@/lib/api";
import { Button, ErrorBox, Select, Spinner } from "@/components/ui";
import { errorText } from "@/lib/utils";

interface Candidates { assignedUserId: string | null; candidates: { id: string; name: string }[] }

/**
 * Thema (die Mail mit ihrem ganzen Verlauf, auch künftigen Antworten) einem Mitarbeiter zuordnen. Danach sieht es nur
 * noch er – unter „Zu entscheiden“, „Laufend“ und in der Wiedervorlage. Offene Mails entscheidet dann er.
 */
export function AssignUser({ threadId, onDone }: { threadId: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["assign_candidates", threadId], queryFn: () => api<Candidates>("assign_candidates", { threadId }) });
  const [pick, setPick] = useState<string>("");
  const assign = useMutation({
    mutationFn: (userId: string | null) => api<{ assignedUserId: string | null; assignedTo?: string | null }>("assign_topic", { threadId, userId }),
    onSuccess: (r) => {
      toast.success(r.assignedUserId ? `${r.assignedTo ?? "Mitarbeiter"} zugeordnet – nur er sieht das Thema jetzt.` : "Zuordnung aufgehoben – wieder für alle sichtbar.");
      onDone?.();
    },
    onError: (e) => toast.error(errorText(e)),
    onSettled: () => ["topics", "overview", "message", "messages", "suggestions", "assign_candidates"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
  if (q.isLoading) return <div className="text-sm text-muted-foreground"><Spinner /> Mitarbeiter laden …</div>;
  if (q.error) return <ErrorBox error={q.error} />;
  const current = q.data?.assignedUserId ?? null;
  const list = q.data?.candidates ?? [];
  const value = pick || current || "";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Select className="h-8 min-w-48 flex-1" value={value} onChange={(e) => setPick(e.target.value)}>
          <option value="">– Mitarbeiter wählen –</option>
          {list.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Button size="sm" disabled={assign.isPending || !value || value === current} onClick={() => assign.mutate(value)}>
          {assign.isPending ? <Spinner /> : <UserCheck className="h-3.5 w-3.5" />} Zuordnen
        </Button>
        {current && (
          <Button size="sm" variant="outline" disabled={assign.isPending} onClick={() => assign.mutate(null)}>
            <UserX className="h-3.5 w-3.5" /> Zuordnung aufheben
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Das Thema mit allen Mails (auch späteren Antworten) sieht dann nur noch dieser Mitarbeiter – auch in der Wiedervorlage.
        Andere Mitarbeiter sehen es nicht mehr; Admins finden die Mails weiter unter „Mails“.
      </p>
    </div>
  );
}
