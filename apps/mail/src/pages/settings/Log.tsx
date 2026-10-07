import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Overview, Run } from "@/lib/types";
import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorBox, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export default function Log() {
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<Run[]>("list_runs", { limit: 100 }), refetchInterval: 30_000 });
  const ov = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("overview") });
  return (
    <div className="space-y-4">
      {ov.data && (
        <Card>
          <CardHeader><CardTitle>KI-Verbrauch</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-6 text-sm">
            <div>Neurons heute (UTC): <b>{Math.round(ov.data.neuronsToday).toLocaleString("de-DE")}</b> von 10.000 kostenlos</div>
            <div>Kosten diesen Monat: <b>{ov.data.costMonthUsd.toFixed(2)} $</b>{ov.data.budgetUsd != null && <> von {ov.data.budgetUsd} $ Budget</>}</div>
            <div className="flex flex-wrap gap-1">{Object.entries(ov.data.statusCounts).map(([k, v]) => <Badge key={k} variant="secondary">{k}: {v}</Badge>)}</div>
          </CardContent>
        </Card>
      )}
      <ErrorBox error={runs.error} />
      {runs.isLoading ? <Spinner /> : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="p-2">Zeit</th><th>Art</th><th>Geholt</th><th>Verarbeitet</th><th>Fehler</th><th>Token ein/aus</th><th>Neurons</th><th>Hinweis</th></tr>
            </thead>
            <tbody className="divide-y">
              {runs.data?.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="p-2 whitespace-nowrap">{formatDateTime(r.started_at)}</td><td>{r.kind}</td><td>{r.fetched}</td><td>{r.processed}</td>
                  <td>{r.errors > 0 ? <Badge variant="danger">{r.errors}</Badge> : 0}</td>
                  <td>{r.tokens_in}/{r.tokens_out}</td><td>{Math.round(Number(r.neurons))}</td><td className="max-w-md text-xs text-muted-foreground">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
