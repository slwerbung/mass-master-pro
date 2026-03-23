import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSessionToken, getSessionSecret } from "../_shared/session.ts";

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
    const { name } = await req.json();
    if (!name || typeof name !== "string" || !name.trim()) {
      return json({ valid: false, error: "Missing name" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: customer, error } = await supabase
      .from("customers")
      .select("id, name")
      .ilike("name", name.trim())
      .maybeSingle();

    if (error || !customer) {
      return json({ valid: false, error: "Name nicht gefunden" });
    }

    // Issue signed session token (12h expiry)
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
    const token = await createSessionToken(
      { role: "customer", userId: customer.id, exp },
      getSessionSecret()
    );

    return json({
      valid: true,
      customer: { id: customer.id, name: customer.name },
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  } catch {
    return json({ valid: false, error: "Server error" }, 500);
  }
});
