// Spec D1: Freigabe-Ereignisse (approval_events, schreibt nur der Datenbank-Trigger).

export interface ApprovalEvent {
  id: string;
  action: "approve" | "revoke" | "reset_new_version";
  version: number | null;
  storage_paths: string[] | null;
  actor_name: string | null;
  assignment_id: string | null;
  created_at: string;
}

/** Gueltige Freigaben: je Kunde (assignment) das letzte approve, sofern danach kein revoke/reset kam. Neueste zuerst. */
export function activeApprovals(events: ApprovalEvent[]): ApprovalEvent[] {
  const sorted = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const byAssignment = new Map<string, ApprovalEvent | null>();
  for (const e of sorted) {
    if (e.action === "approve") byAssignment.set(e.assignment_id ?? "", e);
    else if (e.action === "revoke") byAssignment.set(e.assignment_id ?? "", null);
    else for (const k of byAssignment.keys()) byAssignment.set(k, null); // neue Version mit Reset: alle Freigaben weg
  }
  return [...byAssignment.values()].filter((e): e is ApprovalEvent => !!e).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

