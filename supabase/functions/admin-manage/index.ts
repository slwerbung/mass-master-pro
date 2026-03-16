import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { adminPassword, action, ...params } = body;

    // validate-admin actions don't need password for sync_projects_public
    const publicActions = ["sync_projects"];
    if (!publicActions.includes(action)) {
      const expectedPassword = Deno.env.get("ADMIN_PASSWORD");
      if (!expectedPassword || adminPassword !== expectedPassword) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    switch (action) {
      // ---- SYNC PROJECTS (called by employees, no admin pw needed) ----
      case "sync_projects": {
        const projects = params.projects as Array<{
          id: string;
          project_number: string;
          employee_id?: string;
          created_at: string;
          updated_at: string;
        }>;
        if (!projects || !Array.isArray(projects)) return json({ error: "Missing projects" }, 400);
        const rows = projects.map(p => ({
          id: p.id,
          project_number: p.project_number,
          user_id: p.employee_id || "employee",
          employee_id: p.employee_id || null,
          created_at: p.created_at,
          updated_at: p.updated_at,
        }));
        const { error } = await supabase.from("projects").upsert(rows, { onConflict: "id" });
        if (error) return json({ error: error.message }, 500);
        return json({ success: true, synced: rows.length });
      }

      // ---- EMPLOYEES ----
      case "list_employees": {
        const { data, error } = await supabase.from("employees").select("*").order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ employees: data });
      }
      case "create_employee": {
        const { data, error } = await supabase.from("employees").insert({ name: params.name }).select().single();
        if (error) return json({ error: error.message }, 400);
        return json({ employee: data });
      }
      case "delete_employee": {
        const { error } = await supabase.from("employees").delete().eq("id", params.employeeId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- CUSTOMERS ----
      case "list_customers": {
        const { data, error } = await supabase.from("customers").select("*").order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ customers: data });
      }
      case "create_customer": {
        const { data, error } = await supabase.from("customers").insert({ name: params.name }).select().single();
        if (error) return json({ error: error.message }, 400);
        return json({ customer: data });
      }
      case "delete_customer": {
        const { error } = await supabase.from("customers").delete().eq("id", params.customerId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- ASSIGNMENTS ----
      case "list_assignments": {
        const { data, error } = await supabase
          .from("customer_project_assignments")
          .select("*, customers(name), projects(project_number)")
          .order("created_at");
        if (error) return json({ error: error.message }, 500);
        return json({ assignments: data });
      }
      case "create_assignment": {
        const { data, error } = await supabase
          .from("customer_project_assignments")
          .insert({ customer_id: params.customerId, project_id: params.projectId })
          .select().single();
        if (error) return json({ error: error.message }, 400);
        return json({ assignment: data });
      }
      case "delete_assignment": {
        const { error } = await supabase.from("customer_project_assignments").delete().eq("id", params.assignmentId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- PERMISSIONS ----
      case "list_permissions": {
        const { data, error } = await supabase
          .from("customer_location_permissions")
          .select("*, locations(location_number, location_name)")
          .eq("assignment_id", params.assignmentId);
        if (error) return json({ error: error.message }, 500);
        return json({ permissions: data });
      }
      case "set_permissions": {
        const assignmentId = params.assignmentId;
        await supabase.from("customer_location_permissions").delete().eq("assignment_id", assignmentId);
        if (params.permissions && params.permissions.length > 0) {
          const rows = params.permissions.map((p: any) => ({
            assignment_id: assignmentId,
            location_id: p.locationId,
            can_edit_guest_info: p.canEditGuestInfo ?? true,
          }));
          const { error } = await supabase.from("customer_location_permissions").insert(rows);
          if (error) return json({ error: error.message }, 500);
        }
        return json({ success: true });
      }

      // ---- PROJECTS ----
      case "list_projects": {
        const { data, error } = await supabase
          .from("projects")
          .select("id, project_number, employee_id, created_at, updated_at, employees(name)")
          .order("updated_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json({ projects: data });
      }

      // ---- EMPLOYEE PASSWORD ----
      case "get_employee_password": {
        const { data } = await supabase
          .from("app_config")
          .select("value")
          .eq("key", "employee_password")
          .single();
        return json({ password: data?.value || null });
      }
      case "set_employee_password": {
        const { error } = await supabase.from("app_config").upsert(
          { key: "employee_password", value: params.password },
          { onConflict: "key" }
        );
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: "Server error" }, 500);
  }
});
