import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { compare } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { createSessionToken, getSessionSecret } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { employeeId, password } = await req.json();
    if (!employeeId) return json({ valid: false, error: "Missing employeeId" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: employee } = await supabase.from("employees").select("id, name, password_hash").eq("id", employeeId).maybeSingle();
    if (!employee) return json({ valid: false }, 200);

    const passwordHash = (employee as any)?.password_hash || null;

    if (!passwordHash) {
      const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
      const token = await createSessionToken({ role: "employee", userId: employee.id, exp }, getSessionSecret());
      return json({ valid: true, token, expiresAt: new Date(exp * 1000).toISOString() });
    }

    if (!password) return json({ valid: false, requiresPassword: true });

    const valid = await compare(password, passwordHash);

    if (!valid) return json({ valid: false });

    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
    const token = await createSessionToken({ role: "employee", userId: employee.id, exp }, getSessionSecret());
    return json({ valid: true, token, expiresAt: new Date(exp * 1000).toISOString() });
  } catch {
    return json({ valid: false, error: "Server error" }, 500);
  }
});
