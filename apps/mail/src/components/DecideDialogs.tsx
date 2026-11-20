import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, invokeFn } from "@/lib/api";
import type { Topic } from "@/lib/topics";
import { Button, ErrorBox, Spinner, Switch } from "@/components/ui";
import { Modal } from "@/components/ProjectActions";
import { SnoozePanel, useTopicDecide } from "@/components/TopicActions";
import { InstructBox } from "@/components/InstructBox";
import { TeachBox } from "@/components/TeachBox";
import { cn, errorText, formatDate } from "@/lib/utils";

// Dialoge der Karte in „Zu entscheiden“ (alle über `Modal`: Escape/Klick daneben schließt, Handy = Blatt von unten).

const clean = (n: string) => n.replace(/^[^\p{L}\p{N}]+/u, "");

interface ProjectStatusData { projectId: number; nr: string; name: string; stepId: number | null; stepName: string | null; steps: { id: number; name: string }[] }
export const projectStatusKey = (projectId: number) => ["project-status", projectId];
export const useProjectStatus = (projectId: number | null) =>
  useQuery({ queryKey: projectStatusKey(projectId ?? 0), queryFn: () => api<ProjectStatusData>("project_status", { projectId }), enabled: !!projectId, staleTime: 60_000, retry: false });

/** Status in HERO ändern: Liste der Schritte (aktueller markiert, „Abgeschlossen“ = „Projekt beenden“). Speichern über `email-action` `set_step`. */
export function TopicStatusDialog({ projectId, messageId, onClose }: { projectId: number; messageId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useProjectStatus(projectId);
  const set = useMutation({
    mutationFn: (stepId: number) => invokeFn<{ projectNr: string; stepId: number; stepName: string; changed: boolean }>("email-action", { action: "set_step", messageId, projectId, stepId }),
    onSuccess: (r) => {
      toast.success(r.changed ? `${r.projectNr}: Status auf „${r.stepName}“ gesetzt` : `${r.projectNr} steht schon auf „${r.stepName}“`);
      qc.setQueryData<ProjectStatusData>(projectStatusKey(projectId), (old) => (old ? { ...old, stepId: r.stepId, stepName: r.stepName } : old));
      ["project-status", "suggestions", "topics"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const d = q.data;
  return (
    <Modal title={`Status ändern: ${d?.nr ?? `#${projectId}`} ${d?.name ?? ""}`.trim()} onClose={onClose}>
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} />
      <div className="grid gap-1">
        {d?.steps.map((s) => {
          const current = s.id === d.stepId;
          const done = /abgeschlossen/i.test(s.name);
          return (
            <button key={s.id} type="button" disabled={current || set.isPending} onClick={() => set.mutate(s.id)}
              className={cn("touch-manipulation rounded-md border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60 max-md:min-h-11", current && "border-primary bg-accent font-medium", done && "border-emerald-400 font-medium")}>
              {clean(s.name)}{current && <span className="ml-2 text-xs text-muted-foreground">aktuell</span>}{done && <span className="ml-2 text-xs text-emerald-700">Projekt beenden</span>}
            </button>
          );
        })}
      </div>
      <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Abbrechen</Button></div>
    </Modal>
  );
}

/** „Später“: nur beobachten – oder Wiedervorlage mit Datum und optionalem Grund. */
export function LaterDialog({ topic, onClose, onDone }: { topic: Topic; onClose: () => void; onDone: () => void }) {
  const decide = useTopicDecide(topic.id);
  const shownIds = topic.newMessages.map((m) => m.id);
  return (
    <Modal title="Später" onClose={onClose}>
      <div className="space-y-1">
        <Button variant="outline" className="w-full max-md:h-11" disabled={decide.isPending} onClick={() => decide.mutate({ decision: "weiter", messageIds: shownIds }, { onSuccess: onDone })}>
          {decide.isPending ? <Spinner /> : null} Nur beobachten
        </Button>
        <p className="text-xs text-muted-foreground">Kommt bei neuer Mail oder ohne Bewegung zurück.</p>
      </div>
      <div className="space-y-2 border-t pt-3">
        <h3 className="text-sm font-medium">Wiedervorlage</h3>
        <SnoozePanel bare title={null} busy={decide.isPending} submitLabel={(d) => `Wiedervorlage am ${formatDate(d)}`}
          onSnooze={(until, note) => decide.mutate({ decision: "wiedervorlage", until, note, messageIds: shownIds }, { onSuccess: onDone })} />
      </div>
    </Modal>
  );
}

/** „Anders …“: Anweisung – oder, mit dem Schalter, dem Assistenten erklären, was an seinem Vorschlag falsch war. */
export function ElseDialog({ messageId, fromAddr, onClose }: { messageId: string; fromAddr: string; onClose: () => void }) {
  const [teach, setTeach] = useState(false);
  return (
    <Modal title="Was soll stattdessen passieren?" onClose={onClose} wide>
      {teach ? (
        <TeachBox
          messageId={messageId} fromAddr={fromAddr} onCancel={onClose} onDone={onClose}
          title="Was ist falsch? (Der Assistent lernt daraus und verarbeitet die Mail neu)"
          placeholder="z. B. „Das ist eine Lieferantenrechnung, kein Kunde.“ – für Aufträge an HERO („Projekt anlegen …“) bitte den Schalter ausschalten."
          footnote="Die offenen Vorschläge werden verworfen und die Mail mit deinem Hinweis neu verarbeitet – danach liegt hier der neue Vorschlag."
        />
      ) : (
        <InstructBox messageId={messageId} onCancel={onClose} />
      )}
      <div className="border-t pt-3"><Switch checked={teach} onChange={setTeach} label="Vorschlag war falsch, daraus lernen" /></div>
    </Modal>
  );
}
