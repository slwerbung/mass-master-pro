import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSessionToken, getSessionSecret } from "../_shared/session.ts";
import { verifyPassword } from "../_shared/passwords.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { password } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: adminHashConfig } = await supabase.from("app_config").select("value").eq("key", "admin_password_hash").maybeSingle();
    const storedHash = adminHashConfig?.value || null;
    const envPassword = Deno.env.get("ADMIN_PASSWORD");

    let valid = false;
    if (storedHash) {
      valid = !!password && await verifyPassword(password, storedHash);
    } else if (envPassword) {
      valid = password === envPassword;
    } else {
      return new Response(JSON.stringify({ valid: false, error: "Admin password not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
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
