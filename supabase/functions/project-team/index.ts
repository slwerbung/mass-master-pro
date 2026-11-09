// Edge function: Projektteam direkt im Projekt pflegen (Spec A).
//
// Hauptverantwortlicher = projects.employee_id, Team = Hauptverantwortlicher + project_employee_assignments.
// Alle Teammitglieder duerfen das Projekt bearbeiten; das Team aendern duerfen Admin und Hauptverantwortlicher
// (bei einem Projekt ohne Hauptverantwortlichen jeder Mitarbeiter). Das Adminmenue (admin-manage) bleibt daneben.
//
// Aktionen (Body { token, action, projectId, ... }, Token = HMAC-Session admin/employee):
//   get           -> { ownerId, members: [{ assignmentId, employeeId, name }], canEdit }
//   set_owner     { employeeId | null } -> bisheriger Hauptverantwortlicher bleibt als Mitglied
//   add_member    { employeeId }
//   remove_member { employeeId }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";
import { canEditTeam, ownerChangePlan } from "./team.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { token, action } = body as Record<string, any>;
    const payload = token ? await verifySessionToken(String(token), getSessionSecret()) : null;
    if (!payload || (payload.role !== "employee" && payload.role !== "admin")) return json({ error: "Nicht angemeldet." }, 401);
    const isAdmin = payload.role === "admin";
    const selfId = isAdmin ? null : String(payload.userId || "");
    if (!isAdmin && !selfId) return json({ error: "Nicht angemeldet." }, 401);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const projectId = String(body.projectId || "").trim();
    if (!projectId) return json({ error: "Projekt fehlt." }, 400);
    const { data: project, error: pErr } = await sb.from("projects").select("id, employee_id").eq("id", projectId).maybeSingle();
    if (pErr) return json({ error: pErr.message }, 500);
    if (!project) return json({ error: "Projekt nicht gefunden." }, 404);
    const ownerId: string | null = project.employee_id ?? null;

    const loadTeam = async (owner: string | null) => {
      const { data: rows, error } = await sb.from("project_employee_assignments").select("id, employee_id").eq("project_id", projectId);
      if (error) throw new Error(error.message);
      const ids = [...new Set([owner, ...(rows || []).map((r: any) => r.employee_id)].filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: emps } = await sb.from("employees").select("id, name").in("id", ids);
        for (const e of emps || []) names.set(e.id, e.name);
      }
      return {
        ownerId: owner,
        ownerName: owner ? names.get(owner) ?? null : null,
        members: (rows || [])
          .filter((r: any) => r.employee_id !== owner)
          .map((r: any) => ({ assignmentId: r.id, employeeId: r.employee_id, name: names.get(r.employee_id) ?? "Mitarbeiter" })),
        canEdit: canEditTeam({ isAdmin, selfId, ownerId: owner }),
      };
    };
    const canEdit = canEditTeam({ isAdmin, selfId, ownerId });

    if (action === "get") return json(await loadTeam(ownerId));

    if (!["set_owner", "add_member", "remove_member"].includes(action)) return json({ error: `Unbekannte Aktion: ${action}` }, 400);
    if (!canEdit) return json({ error: "Nur der Hauptverantwortliche oder ein Admin kann das Team ändern." }, 403);

    const employeeId = body.employeeId == null || body.employeeId === "" ? null : String(body.employeeId);
    if (employeeId) {
      const { data: emp } = await sb.from("employees").select("id").eq("id", employeeId).maybeSingle();
      if (!emp) return json({ error: "Mitarbeiter nicht gefunden." }, 400);
    }

    if (action === "set_owner") {
      const plan = ownerChangePlan(ownerId, employeeId);
      const { error } = await sb.from("projects").update({ employee_id: employeeId }).eq("id", projectId);
      if (error) return json({ error: error.message }, 500);
      if (plan.removeMember) {
        await sb.from("project_employee_assignments").delete().eq("project_id", projectId).eq("employee_id", plan.removeMember);
      }
      if (plan.addMember) {
        const { error: insErr } = await sb.from("project_employee_assignments")
          .upsert({ project_id: projectId, employee_id: plan.addMember }, { onConflict: "project_id,employee_id", ignoreDuplicates: true });
        if (insErr) return json({ error: insErr.message }, 500);
      }
    } else if (action === "add_member") {
      if (!employeeId) return json({ error: "Mitarbeiter fehlt." }, 400);
      if (employeeId !== ownerId) {
        const { error } = await sb.from("project_employee_assignments")
          .upsert({ project_id: projectId, employee_id: employeeId }, { onConflict: "project_id,employee_id", ignoreDuplicates: true });
        if (error) return json({ error: error.message }, 500);
      }
    } else {
      if (!employeeId) return json({ error: "Mitarbeiter fehlt." }, 400);
      const { error } = await sb.from("project_employee_assignments").delete().eq("project_id", projectId).eq("employee_id", employeeId);
      if (error) return json({ error: error.message }, 500);
    }

    // Nach der Aenderung neu lesen (Hauptverantwortlicher kann sich geaendert haben).
    const { data: after } = await sb.from("projects").select("employee_id").eq("id", projectId).maybeSingle();
    return json(await loadTeam(after?.employee_id ?? null));
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
