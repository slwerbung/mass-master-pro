import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { compare, hash } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { createSessionToken, getSessionSecret } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { password } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: hashConfig } = await supabase.from("app_config").select("value").eq("key", "admin_password_hash").maybeSingle();
    const { data: legacyConfig } = await supabase.from("app_config").select("value").eq("key", "admin_password").maybeSingle();
    const envPassword = Deno.env.get("ADMIN_PASSWORD");

    if (!hashConfig?.value && !legacyConfig?.value && !envPassword) {
      return response({ valid: false, error: "Admin password not configured" }, 500);
    }

    let valid = false;
    if (hashConfig?.value) {
      valid = await compare(password || "", hashConfig.value);
    } else if (legacyConfig?.value) {
      valid = password === legacyConfig.value;
      if (valid) {
        const newHash = await hash(password);
        await supabase.from("app_config").upsert({ key: "admin_password_hash", value: newHash });
        await supabase.from("app_config").delete().eq("key", "admin_password");
      }
    } else if (envPassword) {
      valid = password === envPassword;
    }

    if (!valid) return response({ valid: false });

    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
    const token = await createSessionToken({ role: "admin", userId: "admin", exp }, getSessionSecret());
    return response({ valid: true, token, expiresAt: new Date(exp * 1000).toISOString() });
  } catch {
    return response({ valid: false, error: "Server error" }, 500);
  }
});
