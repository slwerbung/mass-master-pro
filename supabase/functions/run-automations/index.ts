// HTTP entry point to fire automations for a trigger.
//
// Called by the client (e.g. when the first location is created) or by other
// edge functions. Uses the service role and reads HERO config itself, so the
// API key never leaves the server. Safe to expose: it only runs the
// automations that an admin has configured for the given trigger + context,
// and the context carries the project reference.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchAutomations } from "../_shared/automations.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { trigger_type, context } = await req.json();
    if (!trigger_type) return json({ ok: false, error: "trigger_type fehlt" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const result = await dispatchAutomations(supabase, String(trigger_type), context || {});
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
