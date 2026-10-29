import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, CheckCheck, Eye, Reply, RotateCcw, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { inDays, SNOOZE_PRESETS, type Topic } from "@/lib/topics";
import type { TopicDecision } from "@/lib/shared";
import { Button, Input, Spinner } from "@/components/ui";
import { InstructBox } from "@/components/InstructBox";
import { cn, errorText, formatDate } from "@/lib/utils";

const DONE_TEXT: Record<TopicDecision, string> = {
  weiter: "Gesehen – das Thema läuft weiter und wird überwacht.",
  wiedervorlage: "Auf Wiedervorlage gelegt.",
  erledigt: "Thema abgeschlossen.",
  oeffnen: "Thema wieder geöffnet.",
};

export function useTopicDecide(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { decision: TopicDecision; until?: string; note?: string; messageIds?: string[] }) =>
      api<{ state: string; snoozedUntil: string | null }>("topic_decide", { threadId: topicId, ...p }),
    onSuccess: (r, p) => toast.success(p.decision === "wiedervorlage" && r.snoozedUntil ? `Wiedervorlage am ${formatDate(r.snoozedUntil)}.` : DONE_TEXT[p.decision]),
    onError: (e) => toast.error(errorText(e)),
    onSettled: () => ["topics", "suggestions", "overview", "message", "messages"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
}

/** Wiedervorlage: Schnellwahl oder Datum, dazu optional, worauf zu achten ist. */
export function SnoozePanel({ onSnooze, busy, onCancel }: { onSnooze: (until: string, note: string) => void; busy: boolean; onCancel: () => void }) {
  const [date, setDate] = useState(inDays(7));
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <div className="text-sm font-medium">Wiedervorlage – das Thema ruht bis dahin und kommt dann wieder unter „Zu entscheiden“</div>
      <div className="flex flex-wrap gap-1.5">
        {SNOOZE_PRESETS.map((p) => (
          <button
            key={p.days} type="button" onClick={() => setDate(inDays(p.days))}
            className={cn("rounded-full border px-3 py-1 text-xs", date === inDays(p.days) ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}
          >{p.label}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input type="date" className="h-8 w-40" min={inDays(1)} value={date} onChange={(e) => setDate(e.target.value)} />
        <Input className="h-8 min-w-48 flex-1" maxLength={300} placeholder="Worauf achten? (optional, z. B. „Freigabe da?“)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSnooze(date, note)} disabled={busy || !date}>{busy && <Spinner />} Auf Wiedervorlage legen</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Abbrechen</Button>
      </div>
    </div>
  );
}

/**
 * Entscheidung zu einem Thema: antworten, Anweisung (HERO, Wiedervorlage, abschließen per Prompt),
 * weiter verfolgen, Wiedervorlage, abschließen – bzw. wieder öffnen.
 */
export function TopicActions({ topic, showDecide = true, withReply = true }: {
  topic: Topic; showDecide?: boolean;
  /** Antworten / Anweisung zeigen (in der Mail-Ansicht stehen sie schon oben) */
  withReply?: boolean;
}) {
  const decide = useTopicDecide(topic.id);
  const [panel, setPanel] = useState<null | "snooze" | "instruct">(null);
  const shownIds = topic.newMessages.map((m) => m.id);
  const target = topic.newMessages[topic.newMessages.length - 1]?.id ?? topic.latestId;
  const busy = decide.isPending;
  const toggle = (p: "snooze" | "instruct") => setPanel(panel === p ? null : p);

  if (topic.state === "erledigt" && !topic.due) {
    return (
      <Button size="sm" variant="outline" onClick={() => decide.mutate({ decision: "oeffnen" })} disabled={busy}>
        {busy ? <Spinner /> : <RotateCcw className="h-3.5 w-3.5" />} Wieder öffnen
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {withReply && target && (
          <Link to={`/verfassen?reply=${target}&mode=reply`}><Button size="sm"><Reply className="h-3.5 w-3.5" /> Antworten</Button></Link>
        )}
        {withReply && target && (
          <Button size="sm" variant="outline" onClick={() => toggle("instruct")} className={panel === "instruct" ? "bg-accent" : ""}>
            <Wand2 className="h-3.5 w-3.5" /> Anweisung …
          </Button>
        )}
        {showDecide && topic.due && (
          <Button size="sm" variant="outline" onClick={() => decide.mutate({ decision: "weiter", messageIds: shownIds })} disabled={busy}
            title="Gesehen, nichts weiter zu tun – das Thema läuft weiter und wird überwacht">
            <Eye className="h-3.5 w-3.5" /> Weiter verfolgen
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => toggle("snooze")} className={panel === "snooze" ? "bg-accent" : ""} disabled={busy}>
          <AlarmClock className="h-3.5 w-3.5" /> Wiedervorlage …
        </Button>
        <Button size="sm" variant="outline" className="border-emerald-200 text-emerald-800 hover:bg-emerald-50" disabled={busy}
          onClick={() => decide.mutate({ decision: "erledigt" })} title="Thema wird nicht weiter verfolgt – erst eine neue Mail legt es wieder vor">
          {busy ? <Spinner /> : <CheckCheck className="h-3.5 w-3.5" />} Abschließen
        </Button>
      </div>
      {panel === "snooze" && (
        <SnoozePanel busy={busy} onCancel={() => setPanel(null)}
          onSnooze={(until, note) => decide.mutate({ decision: "wiedervorlage", until, note, messageIds: shownIds }, { onSuccess: () => setPanel(null) })} />
      )}
      {panel === "instruct" && target && (
        <InstructBox messageId={target} title="Was soll passieren?" onCancel={() => setPanel(null)} />
      )}
    </div>
  );
}
