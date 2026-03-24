import bcrypt from "https://esm.sh/bcryptjs@3.0.2";
import { createSessionToken, getSessionSecret } from "../_shared/session.ts";
import { createSessionToken, getSessionSecret } from "../_shared/session.ts";

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
    const { password } = await req.json();

    // Check for bcrypt hash in app_config first
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: hashConfig } = await supabase.from("app_config").select("value").eq("key", "admin_password_hash").maybeSingle();

    let valid = false;
    if (hashConfig?.value) {
      valid = await compare(password, hashConfig.value);
    } else {
      // Fallback to ADMIN_PASSWORD secret (plaintext comparison)
      const adminPassword = Deno.env.get("ADMIN_PASSWORD");
      if (!adminPassword) {
        return json({ valid: false, error: "Admin password not configured" }, 500);
      }
      valid = password === adminPassword;
    }

    if (!valid) return json({ valid: false });

    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
    const token = await createSessionToken({ role: "admin", userId: "admin", exp }, getSessionSecret());
    return json({ valid: true, token, expiresAt: new Date(exp * 1000).toISOString() });
  } catch {
    return json({ valid: false, error: "Server error" }, 500);
  }
});
