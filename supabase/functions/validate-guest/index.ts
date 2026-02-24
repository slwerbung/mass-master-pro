import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { projectId, password } = await req.json();

    if (!projectId || typeof projectId !== "string") {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid project ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("projects")
      .select("id, project_number, guest_password")
      .eq("id", projectId)
      .single();

    if (error || !data) {
      return new Response(
        JSON.stringify({ valid: false, error: "Project not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const needsPassword = !!data.guest_password;

    if (needsPassword && data.guest_password !== password) {
      return new Response(
        JSON.stringify({ valid: false, needsPassword: true, error: "Invalid password" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a simple token: base64 of projectId + timestamp + random
    const tokenPayload = JSON.stringify({
      projectId: data.id,
      ts: Date.now(),
      r: crypto.randomUUID(),
    });
    const token = btoa(tokenPayload);

    return new Response(
      JSON.stringify({
        valid: true,
        needsPassword,
        token,
        projectNumber: data.project_number,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ valid: false, error: "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
