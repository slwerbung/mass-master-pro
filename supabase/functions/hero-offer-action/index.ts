// Edge function: process a customer's click on an "Annehmen / Ablehnen /
// Rücksprache" button from a HERO offer e-mail (replaces the old Make webhook).
//
// The HERO mail template reliably fills {{ProjectMatch.id}} (internal id) and
// {{CustomerDocument.id}} (offer id), so we key off the internal project_match
// id — no fragile display-number resolution. A "lookup" mode resolves the
// friendly project number for the confirmation page (read-only, side-effect
// free); "execute" performs the logbook entry + status change.
//
// Flow (called by the /hero-aktion confirmation page):
//   - on load  -> POST { mode:"lookup", projectMatchId }  -> { projectNr }
//   - on click -> POST { mode:"execute", projectMatchId, action, documentId }
//
// Public endpoint (verify_jwt=false): it only writes a logbook entry and sets a
// project status; no data is read back beyond the project number. The
// confirmation page (action only on explicit click) prevents link-scanners
// from auto-triggering the accept/decline.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HERO_V7 = "https://login.hero-software.de/api/external/v7/graphql";
const HERO_V9 = "https://login.hero-software.de/api/external/v9/graphql";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action = "annehmen" | "ablehnen" | "ruecksprache";
const ALLOWED: Action[] = ["annehmen", "ablehnen", "ruecksprache"];

const LABELS: Record<Action, string> = {
  annehmen: "Angebot angenommen (Kunde)",
  ablehnen: "Angebot abgelehnt (Kunde)",
  ruecksprache: "Rücksprache angefragt (Kunde)",
};
const CONFIG_KEY: Record<Action, string> = {
  annehmen: "statusAnnehmen",
  ablehnen: "statusAblehnen",
  ruecksprache: "statusRuecksprache",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function heroPost(url: string, apiKey: string, query: string, variables?: Record<string, unknown>) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const text = await resp.text();
  if (!resp.ok) return { error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { return { error: `Kein JSON: ${text.slice(0, 300)}` }; }
  if (parsed.errors?.length) return { error: parsed.errors.map((e: any) => e.message).join("; ") };
  return { data: parsed.data };
}

// Resolve to { id, nr }: prefer the internal project_match id, fall back to an
// exact display-number search. Returns { error, status } on failure.
async function resolveMatch(
  apiKey: string, projectMatchId: number, displayId: string,
): Promise<{ id: number; nr: string } | { error: string; status: number }> {
  if (Number.isFinite(projectMatchId) && projectMatchId > 0) {
    const r = await heroPost(HERO_V7, apiKey, `query($ids: [Int]){ project_matches(ids: $ids){ id project_nr } }`, { ids: [projectMatchId] });
    if ((r as any).error) return { error: `HERO-Abfrage fehlgeschlagen: ${(r as any).error}`, status: 502 };
    const m = ((r as any).data?.project_matches || [])[0];
    if (!m?.id) return { error: `Kein HERO-Projekt mit ID ${projectMatchId} gefunden.`, status: 404 };
    return { id: Number(m.id), nr: String(m.project_nr || "") };
  }
  if (displayId) {
    const r = await heroPost(HERO_V7, apiKey, `query($s: String){ project_matches(search: $s){ id project_nr } }`, { s: displayId });
    if ((r as any).error) return { error: `HERO-Suche fehlgeschlagen: ${(r as any).error}`, status: 502 };
    const matches = ((r as any).data?.project_matches || []).filter(
      (m: any) => String(m.project_nr || "").trim().toLowerCase() === displayId.toLowerCase(),
    );
    if (matches.length === 0) return { error: `Kein HERO-Projekt zu „${displayId}“ gefunden.`, status: 404 };
    if (matches.length > 1) return { error: `Mehrere HERO-Projekte zu „${displayId}“ gefunden – bitte manuell prüfen.`, status: 409 };
    return { id: Number(matches[0].id), nr: String(matches[0].project_nr || displayId) };
  }
  return { error: "Projekt fehlt (weder ID noch Nummer übergeben).", status: 400 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "lookup" ? "lookup" : "execute";
    const action = String(body.action || "").trim() as Action;
    const projectMatchId = Number(body.projectMatchId);
    const displayId = String(body.displayId || "").trim();
    const documentId = String(body.documentId || "").trim();

    if (!ALLOWED.includes(action)) return json({ ok: false, error: "Ungültige Aktion" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // HERO config.
    const { data: cfgRows } = await supabase.from("app_config").select("key,value").in("key", ["hero_api_key", "hero_enabled"]);
    const cfg = new Map((cfgRows || []).map((r: any) => [r.key, r.value]));
    const apiKey = cfg.get("hero_api_key") as string | undefined;
    const heroEnabled = cfg.get("hero_enabled") === "true" || cfg.get("hero_enabled") === true;
    if (!heroEnabled || !apiKey) return json({ ok: false, error: "HERO-Integration ist nicht aktiv." }, 400);

    const resolved = await resolveMatch(apiKey, projectMatchId, displayId);
    if ("error" in resolved) return json({ ok: false, error: resolved.error }, resolved.status);

    // Read-only lookup for the confirmation page: no side effects.
    if (mode === "lookup") {
      return json({ ok: true, projectMatchId: resolved.id, projectNr: resolved.nr });
    }

    // Active status mapping from the configured automation (first enabled row).
    const { data: rule } = await supabase
      .from("automations")
      .select("id, name, action_config")
      .eq("trigger_type", "hero_offer_response")
      .eq("enabled", true)
      .order("sort_order")
      .limit(1)
      .maybeSingle();
    const stepRaw = rule?.action_config?.[CONFIG_KEY[action]];
    const stepId = stepRaw != null && String(stepRaw).trim() !== "" ? Number(stepRaw) : NaN;

    const projLabel = resolved.nr || `#${resolved.id}`;

    // Logbook entry (HERO v9 LogbookEntryInput; title folded into custom_text).
    const customText =
      `${LABELS[action]}\n\n` +
      `Der Kunde hat über die Angebotsmail für Projekt ${projLabel} die Aktion „${action}“ ausgelöst.` +
      (documentId ? `\nAngebot-Nr.: ${documentId}` : "");
    const logRes = await heroPost(
      HERO_V9, apiKey,
      `mutation($entry: LogbookEntryInput!) { add_logbook_entry(logbook_entry: $entry) { id } }`,
      { entry: { target: "project_match", target_id: resolved.id, custom_text: customText.slice(0, 5000) } },
    );
    if ((logRes as any).error) return json({ ok: false, error: `Logbucheintrag fehlgeschlagen: ${(logRes as any).error}` }, 502);

    // Status change (optional for ruecksprache / when unconfigured).
    let statusChanged = false;
    if (Number.isFinite(stepId) && stepId > 0) {
      const upd = await heroPost(
        HERO_V7, apiKey,
        `mutation($pm: ProjectMatchInput!){ update_project_match(project_match: $pm){ id } }`,
        { pm: { id: resolved.id, step_id: stepId } },
      );
      if ((upd as any).error) return json({ ok: false, error: `Statuswechsel fehlgeschlagen: ${(upd as any).error}` }, 502);
      statusChanged = !!(upd as any).data?.update_project_match?.id;
    }

    // Best-effort audit trail.
    try {
      await supabase.from("automation_runs").insert({
        automation_id: rule?.id ?? null,
        automation_name: rule?.name || "HERO Angebots-Rückmeldung",
        trigger_type: "hero_offer_response",
        action_type: "hero_offer_status",
        status: "success",
        message: `${LABELS[action]} · ${projLabel}${statusChanged ? ` · Status → ${stepId}` : " · nur Logbuch"}`,
        context: { projectMatchId: resolved.id, projectNr: resolved.nr, action, documentId: documentId || null, statusChanged },
      });
    } catch { /* audit is best-effort */ }

    return json({ ok: true, projectDisplayId: projLabel, action, statusChanged });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
});
