import { useQuery } from "@tanstack/react-query";
import { papi, tageText, type FlowData, type FlowStep } from "@/lib/projects";
import { ErrorBox, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const DOT: Record<FlowStep["signal"], string> = {
  none: "bg-muted-foreground/30", green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500",
};
const DOT_TEXT: Record<FlowStep["signal"], string> = {
  none: "kein WIP-Limit", green: "im Limit", amber: "bis 25 % über dem Limit", red: "über dem Limit",
};

/**
 * Fluss-Ansicht (Phase 5): je Status Anzahl der Projekte, durchschnittliche Verweildauer und Ampel gegen das WIP-Limit.
 * Ein Klick auf einen Status filtert den Stapel.
 */
export function FlowView({ onPick }: { onPick: (step: FlowStep) => void }) {
  const q = useQuery({ queryKey: ["projects", "flow"], queryFn: () => papi<FlowData>("flow"), refetchInterval: 120_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const steps = q.data?.steps ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {q.data?.total ?? 0} offene Projekte. Klick auf einen Status zeigt dessen Karten im Stapel. Das WIP-Limit pflegt der Admin unter Einstellungen → Projekte.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Projekte</th><th className="px-3 py-2 text-right">Limit</th>
              <th className="px-3 py-2 text-right">Ø Dauer</th><th className="px-3 py-2 text-right">Längste</th><th className="px-3 py-2 text-right">Außerhalb Sollzeit</th><th className="px-3 py-2 text-right">Karten</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((r) => (
              <tr key={r.stepId} className={cn("cursor-pointer border-t hover:bg-accent", r.excluded && "text-muted-foreground")} onClick={() => onPick(r)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") onPick(r); }}>
                <td className="px-3 py-2 font-medium">{r.name}{r.excluded && <span className="ml-2 text-xs font-normal">(ausgeschlossen)</span>}</td>
                <td className="px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-2">
                    <span className={cn("inline-block h-2.5 w-2.5 rounded-full", DOT[r.signal])} title={DOT_TEXT[r.signal]} aria-label={DOT_TEXT[r.signal]} />
                    <b>{r.count}</b>
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">{r.wipLimit ?? "–"}</td>
                <td className="px-3 py-2 text-right">{tageText(Math.round(r.avgDays))}</td>
                <td className="px-3 py-2 text-right">{tageText(r.maxDays)}</td>
                <td className="px-3 py-2 text-right">{r.overdue ? <span className="text-rose-700 dark:text-rose-300">{r.overdue}</span> : "0"} <span className="text-xs text-muted-foreground">(&gt; {r.targetDays} T)</span></td>
                <td className="px-3 py-2 text-right">{r.cards}</td>
              </tr>
            ))}
            {!steps.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Noch keine Projekte geladen.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
