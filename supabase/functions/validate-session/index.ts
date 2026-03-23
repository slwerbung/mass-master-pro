import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { token, role, userId } = await req.json();
    if (!token || !role || !userId) return json({ valid: false }, 400);
    const payload = await verifySessionToken(token, getSessionSecret());
    const valid = !!payload && payload.role === role && payload.userId === userId;
    return json({ valid });
  } catch {
    return json({ valid: false }, 500);
  }
});
