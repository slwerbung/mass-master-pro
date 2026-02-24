import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function validateToken(token: string, projectId: string): boolean {
  try {
    const payload = JSON.parse(atob(token));
    if (payload.projectId !== projectId) return false;
    if (Date.now() - payload.ts > 24 * 60 * 60 * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { projectId, token, locationId, guestInfo } = await req.json();

    if (!projectId || !token || !locationId || !validateToken(token, projectId)) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sanitize input - limit length
    const sanitizedInfo = typeof guestInfo === "string" ? guestInfo.slice(0, 5000) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify location belongs to the project
    const { data: loc } = await supabase
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("project_id", projectId)
      .single();

    if (!loc) {
      return new Response(
        JSON.stringify({ error: "Location not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error } = await supabase
      .from("locations")
      .update({ guest_info: sanitizedInfo })
      .eq("id", locationId);

    if (error) {
      return new Response(
        JSON.stringify({ error: "Update failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
