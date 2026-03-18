import { createSessionToken, getSessionSecret } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { password } = await req.json();
    const adminPassword = Deno.env.get("ADMIN_PASSWORD");
    if (!adminPassword) {
      return new Response(JSON.stringify({ valid: false, error: "Admin password not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const valid = password === adminPassword;
    if (!valid) {
      return new Response(JSON.stringify({ valid: false }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
    const token = await createSessionToken({ role: "admin", userId: "admin", exp }, getSessionSecret());

    return new Response(JSON.stringify({ valid: true, token, expiresAt: new Date(exp * 1000).toISOString() }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ valid: false, error: "Server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
