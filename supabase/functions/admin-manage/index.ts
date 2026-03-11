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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { adminPassword, action, ...params } = body;

    // Validate admin password
    const expectedPassword = Deno.env.get("ADMIN_PASSWORD");
    if (!expectedPassword || adminPassword !== expectedPassword) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    switch (action) {
      // ---- EMPLOYEES ----
      case "list_employees": {
        const { data, error } = await supabase
          .from("employees")
          .select("*")
          .order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ employees: data });
      }

      case "create_employee": {
        const { data, error } = await supabase
          .from("employees")
          .insert({ name: params.name })
          .select()
          .single();
        if (error) return json({ error: error.message }, 400);
        return json({ employee: data });
      }

      case "delete_employee": {
        const { error } = await supabase
          .from("employees")
          .delete()
          .eq("id", params.employeeId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- CUSTOMERS ----
      case "list_customers": {
        const { data, error } = await supabase
          .from("customers")
          .select("*")
          .order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ customers: data });
      }

      case "create_customer": {
        const { data, error } = await supabase
          .from("customers")
          .insert({ name: params.name })
          .select()
          .single();
        if (error) return json({ error: error.message }, 400);
        return json({ customer: data });
      }

      case "delete_customer": {
        const { error } = await supabase
          .from("customers")
          .delete()
          .eq("id", params.customerId);
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
          .select()
          .single();
        if (error) return json({ error: error.message }, 400);
        return json({ assignment: data });
      }

      case "delete_assignment": {
        const { error } = await supabase
          .from("customer_project_assignments")
          .delete()
          .eq("id", params.assignmentId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- LOCATION PERMISSIONS ----
      case "list_permissions": {
        const { data, error } = await supabase
          .from("customer_location_permissions")
          .select("*, locations(location_number, location_name)")
          .eq("assignment_id", params.assignmentId);
        if (error) return json({ error: error.message }, 500);
        return json({ permissions: data });
      }

      case "set_permissions": {
        // params.permissions = [{ locationId, canEditGuestInfo }]
        const assignmentId = params.assignmentId;
        // Delete existing
        await supabase
          .from("customer_location_permissions")
          .delete()
          .eq("assignment_id", assignmentId);
        
        if (params.permissions && params.permissions.length > 0) {
          const rows = params.permissions.map((p: any) => ({
            assignment_id: assignmentId,
            location_id: p.locationId,
            can_edit_guest_info: p.canEditGuestInfo ?? true,
          }));
          const { error } = await supabase
            .from("customer_location_permissions")
            .insert(rows);
          if (error) return json({ error: error.message }, 500);
        }
        return json({ success: true });
      }

      // ---- PROJECTS (admin overview) ----
      case "list_projects": {
        const { data, error } = await supabase
          .from("projects")
          .select("id, project_number, employee_id, created_at, updated_at, employees(name)")
          .order("updated_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json({ projects: data });
      }

      // ---- CUSTOMER DATA (for customer login) ----
      case "get_customer_projects": {
        const { data, error } = await supabase
          .from("customer_project_assignments")
          .select("id, project_id, projects(id, project_number)")
          .eq("customer_id", params.customerId);
        if (error) return json({ error: error.message }, 500);
        return json({ assignments: data });
      }

      case "get_customer_locations": {
        // Get all locations for a project that the customer has permission to view
        const { data: permissions, error: permError } = await supabase
          .from("customer_location_permissions")
          .select("location_id, can_edit_guest_info")
          .eq("assignment_id", params.assignmentId);

        if (permError) return json({ error: permError.message }, 500);

        if (!permissions || permissions.length === 0) {
          return json({ locations: [], permissions: [] });
        }

        const locationIds = permissions.map((p) => p.location_id);
        const { data: locations, error: locError } = await supabase
          .from("locations")
          .select("id, location_number, location_name, comment, system, label, location_type, guest_info")
          .in("id", locationIds)
          .order("created_at");

        if (locError) return json({ error: locError.message }, 500);

        // Get images
        const { data: images } = await supabase
          .from("location_images")
          .select("location_id, image_type, storage_path")
          .in("location_id", locationIds);

        return json({ locations: locations || [], permissions, images: images || [] });
      }

      case "update_customer_guest_info": {
        // Verify customer has permission
        const { data: perm } = await supabase
          .from("customer_location_permissions")
          .select("can_edit_guest_info, assignment_id")
          .eq("assignment_id", params.assignmentId)
          .eq("location_id", params.locationId)
          .single();

        if (!perm || !perm.can_edit_guest_info) {
          return json({ error: "No permission" }, 403);
        }

        const { error } = await supabase
          .from("locations")
          .update({ guest_info: params.guestInfo })
          .eq("id", params.locationId);

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
