// Projektteam (Spec A): Zugriff nur ueber die Edge Function `project-team` (HMAC-Session-Token).
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";

export interface TeamMember { assignmentId: string; employeeId: string; name: string }
export interface ProjectTeamData { ownerId: string | null; ownerName: string | null; members: TeamMember[]; canEdit: boolean }

export async function projectTeam(action: "get" | "set_owner" | "add_member" | "remove_member", projectId: string, employeeId?: string | null): Promise<ProjectTeamData> {
  const { data, error } = await supabase.functions.invoke("project-team", {
    body: { token: getSession()?.authToken, action, projectId, employeeId },
  });
  if (error) {
    // supabase-js liefert bei HTTP-Fehlern die Antwort im context – die deutsche Meldung des Servers zeigen.
    const msg = await (error as any)?.context?.json?.().then((b: any) => b?.error).catch(() => null);
    throw new Error(msg || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as ProjectTeamData;
}

/** Initialen fuer die Badges („Jonas Lang“ → „JL“). */
export function initials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Alle Mitarbeiter (oeffentliche Login-Liste), sortiert. */
export async function loadEmployees(): Promise<{ id: string; name: string }[]> {
  const { data } = await (supabase as any).from("employees_public").select("id, name").order("name");
  return ((data || []) as any[]).filter((e) => e.id && e.name).map((e) => ({ id: String(e.id), name: String(e.name) }));
}
