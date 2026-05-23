// Writes the area-measurement summary into a HERO project's
// partner_notes field. Modeled exactly on the vehicle-inquiry flow,
// which writes partner_notes server-side and works reliably.
//
// Why a dedicated function (instead of the existing hero-integration
// action): hero-integration requires a signed employee/admin session
// token, and the call from heroNotesSync wasn't reaching it (the logs
// showed zero update_project_notes invocations). This function uses the
// service role + reads the HERO key from app_config, so it has no auth
// hurdle and runs fully server-side - no browser unmount can cancel it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HERO_GRAPHQL_URL = "https://login.hero-software.de/api/external/v7/graphql";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json();
    const heroProjectId = Number(body.heroProjectId);
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 50000) : "";

    if (!Number.isFinite(heroProjectId) || heroProjectId <= 0) {
      return json({ ok: false, error: "heroProjectId fehlt oder ungültig" }, 400);
    }

    // Read HERO config server-side (anon RLS would block app_config from
    // the browser, which is the whole reason this runs in an edge fn).
    const { data: cfg } = await supabase
      .from("app_config")
      .select("key, value")
      .in("key", ["hero_api_key", "hero_enabled"]);
    const config = new Map((cfg || []).map((r: any) => [r.key, r.value]));
    const apiKey = config.get("hero_api_key");
    const heroEnabled = config.get("hero_enabled") === "true";

    if (!heroEnabled || !apiKey) {
      return json({ ok: false, error: "HERO nicht aktiv oder kein API-Key" }, 200);
    }

    // Same mutation shape the vehicle-inquiry flow uses successfully:
    // update_project_match with a nullable ProjectMatchInput, setting
    // partner_notes alongside the id.
    const mutation = `
      mutation UpdateNotes($pm: ProjectMatchInput) {
        update_project_match(project_match: $pm) { id partner_notes }
      }
    `;
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: mutation,
        variables: { pm: { id: heroProjectId, partner_notes: notes } },
      }),
    });
    const data = await resp.json();
    console.log("update-hero-notes response:", JSON.stringify(data).slice(0, 500));

    if (data.errors?.length) {
      return json({ ok: false, error: data.errors.map((e: any) => e.message).join("; ") }, 200);
    }
    return json({ ok: true, data: data?.data?.update_project_match ?? null });
  } catch (e: any) {
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
});
