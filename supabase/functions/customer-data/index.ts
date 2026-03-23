import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionToken, getSessionSecret } from "../_shared/session.ts";

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
    const { action, customerId, customerToken, ...params } = body;

    if (!customerId) return json({ error: "Missing customerId" }, 400);

    // Validate customer session token
    let authorized = false;
    if (customerToken) {
      const payload = await verifySessionToken(customerToken, getSessionSecret());
      if (payload && payload.role === "customer" && payload.userId === customerId) {
        authorized = true;
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fallback: verify customer exists (for backward compat during migration)
    if (!authorized) {
      const { data: customer } = await supabase
        .from("customers")
        .select("id")
        .eq("id", customerId)
        .single();

      if (!customer) return json({ error: "Invalid customer" }, 401);
      // Allow but log warning — clients should migrate to token-based auth
    }

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
          const { data: locations } = await supabase
            .from("locations")
            .select("id, location_number, location_name, comment, system, label, location_type, guest_info, custom_fields")
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
          .select("id, location_number, location_name, comment, system, label, location_type, guest_info, custom_fields")
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

      case "create_feedback": {
        const { data: assignment } = await supabase
          .from("customer_project_assignments")
          .select("id")
          .eq("id", params.assignmentId)
          .eq("customer_id", customerId)
          .single();

        if (!assignment) return json({ error: "No access" }, 403);

        const sanitizedMessage = String(params.message || "").trim().slice(0, 5000);
        if (!sanitizedMessage) return json({ error: "Missing message" }, 400);

        const { data, error } = await supabase
          .from("location_feedback")
          .insert({
            location_id: params.locationId,
            author_name: String(params.authorName || customerId || "Kunde").trim().slice(0, 120),
            author_customer_id: customerId,
            message: sanitizedMessage,
            status: "open",
          })
          .select("*")
          .single();

        if (error) return json({ error: error.message }, 500);
        return json({ success: true, feedback: data });
      }

      case "update_feedback": {
        const { data: assignment } = await supabase
          .from("customer_project_assignments")
          .select("id")
          .eq("id", params.assignmentId)
          .eq("customer_id", customerId)
          .single();

        if (!assignment) return json({ error: "No access" }, 403);

        const sanitizedMessage = String(params.message || "").trim().slice(0, 5000);
        if (!sanitizedMessage) return json({ error: "Missing message" }, 400);

        const { data, error } = await supabase
          .from("location_feedback")
          .update({ message: sanitizedMessage })
          .eq("id", params.feedbackId)
          .eq("location_id", params.locationId)
          .eq("author_customer_id", customerId)
          .eq("status", "open")
          .select("*")
          .single();

        if (error) return json({ error: error.message }, 500);
        return json({ success: true, feedback: data });
      }

      case "update_guest_info": {
        const { data: perm } = await supabase
          .from("customer_location_permissions")
          .select("can_edit_guest_info")
          .eq("assignment_id", params.assignmentId)
          .eq("location_id", params.locationId)
          .single();

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
