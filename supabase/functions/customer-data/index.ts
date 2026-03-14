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
    const { action, customerId, ...params } = body;

    if (!customerId) return json({ error: "Missing customerId" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify customer exists
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .single();

    if (!customer) return json({ error: "Invalid customer" }, 401);

    switch (action) {
      case "get_projects": {
        const { data, error } = await supabase
          .from("customer_project_assignments")
          .select("id, project_id, projects(id, project_number)")
          .eq("customer_id", customerId);
        if (error) return json({ error: error.message }, 500);
        return json({ assignments: data });
      }

      case "get_locations": {
        // Verify this assignment belongs to this customer
        const { data: assignment } = await supabase
          .from("customer_project_assignments")
          .select("id, project_id")
          .eq("id", params.assignmentId)
          .eq("customer_id", customerId)
          .single();

        if (!assignment) return json({ error: "No access" }, 403);

        const { data: permissions } = await supabase
          .from("customer_location_permissions")
          .select("location_id, can_edit_guest_info")
          .eq("assignment_id", params.assignmentId);

        if (!permissions || permissions.length === 0) {
          // If no specific permissions, show all locations of the project (read-only)
          const { data: locations } = await supabase
            .from("locations")
            .select("id, location_number, location_name, comment, system, label, location_type, guest_info")
            .eq("project_id", assignment.project_id)
            .order("created_at");

          const locationIds = (locations || []).map(l => l.id);
        const { data: images } = await supabase
          .from("location_images")
          .select("location_id, image_type, storage_path")
          .in("location_id", locationIds.length > 0 ? locationIds : ['none']);

        const { data: pdfs } = await supabase
          .from("location_pdfs")
          .select("location_id, storage_path, file_name")
          .in("location_id", locationIds.length > 0 ? locationIds : ['none']);

        const pdfEntries = (pdfs || []).map((p: any) => ({
          location_id: p.location_id,
          image_type: "pdf",
          storage_path: p.storage_path,
          file_name: p.file_name,
        }));

        return json({
          locations: locations || [],
          permissions: [],
          images: [...(images || []), ...pdfEntries],
        });
        }

        const locationIds = permissions.map(p => p.location_id);
        const { data: locations } = await supabase
          .from("locations")
          .select("id, location_number, location_name, comment, system, label, location_type, guest_info")
          .in("id", locationIds)
          .order("created_at");

        const { data: images } = await supabase
          .from("location_images")
          .select("location_id, image_type, storage_path")
          .in("location_id", locationIds);

        const { data: pdfs2 } = await supabase
          .from("location_pdfs")
          .select("location_id, storage_path, file_name")
          .in("location_id", locationIds);

        const pdfEntries2 = (pdfs2 || []).map((p: any) => ({
          location_id: p.location_id,
          image_type: "pdf",
          storage_path: p.storage_path,
          file_name: p.file_name,
        }));

        return json({
          locations: locations || [],
          permissions,
          images: [...(images || []), ...pdfEntries2],
        });
      }

      case "update_guest_info": {
        const { data: perm } = await supabase
          .from("customer_location_permissions")
          .select("can_edit_guest_info")
          .eq("assignment_id", params.assignmentId)
          .eq("location_id", params.locationId)
          .single();

        // Also verify the assignment belongs to customer
        const { data: assignment } = await supabase
          .from("customer_project_assignments")
          .select("id")
          .eq("id", params.assignmentId)
          .eq("customer_id", customerId)
          .single();

        if (!assignment) return json({ error: "No access" }, 403);
        if (!perm || !perm.can_edit_guest_info) return json({ error: "No permission" }, 403);

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
  } catch {
    return json({ error: "Server error" }, 500);
  }
});
