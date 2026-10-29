import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Topic, TopicView } from "@/lib/topics";
import { TOPIC_REASON_LABELS } from "@/lib/shared";
import { Badge, Card, CardContent, ErrorBox, Spinner } from "@/components/ui";
import { TopicActions } from "@/components/TopicActions";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

const VIEWS: { key: TopicView; label: string; hint: string }[] = [
  { key: "entscheiden", label: "Zu entscheiden", hint: "Neue Mails, fällige Wiedervorlagen und Themen, bei denen die Überwachung anschlägt." },
  { key: "laufend", label: "Laufend", hint: "Entschieden und in Arbeit. Bleibt eine Kundenmail unbeantwortet oder tut sich nichts, kommt das Thema von selbst wieder unter „Zu entscheiden“." },
  { key: "wiedervorlage", label: "Wiedervorlage", hint: "Ruht bis zum Datum. Schreibt der Kunde vorher, liegt das Thema sofort wieder vor." },
  { key: "erledigt", label: "Abgeschlossen", hint: "Wird nicht weiter verfolgt. Eine neue Mail im Thema legt es wieder vor." },
];

/** Alle Themen nach Zustand – damit nichts untergeht und man jederzeit nachsehen kann, was läuft. */
export default function Topics() {
  const [sp, setSp] = useSearchParams();
  const view = (VIEWS.find((v) => v.key === sp.get("view"))?.key ?? "laufend") as TopicView;
  const q = useQuery({ queryKey: ["topics", view], queryFn: () => api<Topic[]>("list_topics", { view }), refetchInterval: 120_000 });
  const cur = VIEWS.find((v) => v.key === view)!;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Themen</h1>
        {q.isFetching && <Spinner />}
      </div>
      <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
        {VIEWS.map((v) => (
          <button
            key={v.key} type="button" onClick={() => setSp(v.key === "laufend" ? {} : { view: v.key })}
            className={cn("rounded-md px-3 py-1.5 text-sm", v.key === view ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >{v.label}{v.key === view && q.data ? ` (${q.data.length})` : ""}</button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{cur.hint}</p>
      <ErrorBox error={q.error} />
      {q.data && !q.data.length && <Card><CardContent className="p-6 text-sm text-muted-foreground">Keine Themen.</CardContent></Card>}
      <div className="space-y-2">
        {(q.data ?? []).map((t) => <TopicRow key={t.id} t={t} view={view} />)}
      </div>
    </div>
  );
}

function TopicRow({ t, view }: { t: Topic; view: TopicView }) {
  const when = view === "wiedervorlage" ? `Wiedervorlage am ${formatDate(t.snoozedUntil)}`
    : view === "laufend" ? (t.nextCheck ? `nächste Prüfung ${formatDate(t.nextCheck)}` : "")
      : view === "erledigt" ? `abgeschlossen ${formatDate(t.closedAt)}` : t.reasonText;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/mails/${t.latestId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{t.subject}</Link>
        {view === "entscheiden" && t.reason && <Badge variant="warn">{TOPIC_REASON_LABELS[t.reason]}</Badge>}
        <span className="text-xs text-muted-foreground">{formatDateTime(t.lastActivity)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {t.from && <span>mit {t.from}</span>}
        <span>{t.messageCount} {t.messageCount === 1 ? "Mail" : "Mails"}</span>
        {when && <span>{when}</span>}
        {t.note && <span className="text-foreground">„{t.note}“</span>}
      </div>
      {view !== "entscheiden" && <TopicActions topic={t} showDecide={false} />}
    </div>
  );
}
