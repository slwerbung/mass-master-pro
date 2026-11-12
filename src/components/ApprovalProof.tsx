// Spec D1: Freigabe-Nachweis – „v2 freigegeben von Herrn Müller am 12.10.2026, 14:03“ + Verlauf.
// Quelle ist approval_events (schreibt nur der Datenbank-Trigger); Mitarbeiter und Kunde lesen per RLS.
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { activeApprovals, type ApprovalEvent } from "@/lib/approvalEvents";

const fmt = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const label = (e: ApprovalEvent) => {
  if (e.action === "approve") return `${e.version ? `v${e.version} ` : ""}freigegeben${e.actor_name ? ` von ${e.actor_name}` : ""}`;
  if (e.action === "revoke") return `Freigabe zurückgenommen${e.actor_name ? ` von ${e.actor_name}` : ""}`;
  return `Freigabe zurückgesetzt – neue Version${e.version ? ` v${e.version}` : ""}${e.actor_name ? ` (${e.actor_name})` : ""}`;
};

export function ApprovalProof({ kind, projectId, locationId, currentVersion, refreshKey, className = "" }: {
  kind: "location" | "vehicle";
  projectId: string;
  locationId?: string;
  currentVersion?: number | null;
  /** neu laden, wenn sich das aendert (z. B. nach Freigabe/Upload) */
  refreshKey?: unknown;
  className?: string;
}) {
  const [events, setEvents] = useState<ApprovalEvent[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let alive = true;
    let q = (supabase as any).from("approval_events")
      .select("id, action, version, storage_paths, actor_name, assignment_id, created_at")
      .eq("project_id", projectId).eq("kind", kind).order("created_at", { ascending: false }).limit(50);
    if (kind === "location" && locationId) q = q.eq("location_id", locationId);
    q.then(({ data }: any) => { if (alive) setEvents((data || []) as ApprovalEvent[]); }, () => null);
    return () => { alive = false; };
  }, [kind, projectId, locationId, refreshKey]);

  if (!events.length) return null;
  const active = activeApprovals(events);
  const latest = active[0];
  const outdated = latest?.version && currentVersion && latest.version < currentVersion;

  return (
    <div className={`text-xs ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {latest ? (
          <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> {label(latest)} am {fmt(latest.created_at)}
          </span>
        ) : (
          <span className="text-muted-foreground">Aktuell nicht freigegeben</span>
        )}
        <button type="button" className="inline-flex items-center gap-0.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setShowHistory((v) => !v)}>
          <History className="h-3 w-3" /> Verlauf
        </button>
      </div>
      {outdated && (
        <p className="mt-1 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" /> Freigabe gilt für v{latest!.version}, aktuell ist v{currentVersion}
        </p>
      )}
      {showHistory && (
        <ul className="mt-1.5 space-y-0.5 border-l-2 pl-2 text-muted-foreground">
          {events.map((e) => <li key={e.id}>{fmt(e.created_at)} · {label(e)}</li>)}
        </ul>
      )}
    </div>
  );
}
