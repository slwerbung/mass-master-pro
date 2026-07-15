// Edge function: poll HERO for NEW projects/customers and fire the
// corresponding automation triggers (hero_project_created /
// hero_customer_created). The Dropbox folder creation itself is an
// automation ACTION (dropbox_create_project_folder etc.) so admins control
// the behaviour in the familiar Automationen tab and every run is logged in
// automation_runs.
//
// Dedupe: dropbox_synced stores every HERO id we've already seen. The very
// first successful run only records the current state as baseline (no
// folders for historic projects); afterwards each poll handles what's new.
//
// Auth: called by pg_cron (header x-poll-secret == app_config
// dropbox_poll_secret) or manually from the admin UI (adminToken).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";
import { dispatchAutomations } from "../_shared/automations.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-poll-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const HERO_V7 = "https://login.hero-software.de/api/external/v7/graphql";
// Safety valve: never fire more than this many triggers per run (protects
// against a mis-reset baseline flooding Dropbox/HERO).
const MAX_EVENTS_PER_RUN = 25;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function heroPost(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<{ data?: any; error?: string }> {
  try {
    const resp = await fetch(HERO_V7, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    });
    const text = await resp.text();
    if (!resp.ok) return { error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
    const parsed = JSON.parse(text);
    if (parsed.errors?.length) return { error: parsed.errors[0]?.message || "GraphQL-Fehler" };
    return { data: parsed.data };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

function customerDisplayName(c: any): string {
  if (!c) return "";
  return String(c.company_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "").trim();
}

// Fetch all pages (50er offset) of a query returning an array under `field`.
async function fetchAll(apiKey: string, field: string, selection: string): Promise<{ rows: any[]; error?: string }> {
  const rows: any[] = [];
  for (let offset = 0; offset <= 5000; offset += 50) {
    const r = await heroPost(apiKey, `query($offset: Int!) { ${field}(offset: $offset) { ${selection} } }`, { offset });
    if (r.error) return { rows, error: r.error };
    const batch = r.data?.[field] || [];
    rows.push(...batch);
    if (batch.length < 50) break;
  }
  return { rows };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Auth: cron secret ODER Admin-Token ────────────────────────────
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const pollSecretHeader = req.headers.get("x-poll-secret") || String(body.pollSecret || "");
    const { data: secretRow } = await supabase.from("app_config").select("value").eq("key", "dropbox_poll_secret").maybeSingle();
    const secretOk = !!secretRow?.value && pollSecretHeader === secretRow.value;
    let adminOk = false;
    if (!secretOk && body.adminToken) {
      const payload = await verifySessionToken(body.adminToken, getSessionSecret());
      adminOk = !!payload && payload.role === "admin";
    }
    if (!secretOk && !adminOk) return json({ error: "Unauthorized" }, 401);

    // ── Config ─────────────────────────────────────────────────────────
    const { data: cfgRows } = await supabase.from("app_config").select("key, value")
      .in("key", ["hero_api_key", "hero_enabled", "dropbox_enabled", "dropbox_poll_baseline_done"]);
    const cfg = new Map((cfgRows || []).map((r: any) => [r.key, r.value]));
    const apiKey = cfg.get("hero_api_key") as string | undefined;
    if (cfg.get("hero_enabled") !== "true" || !apiKey) return json({ skipped: true, reason: "HERO nicht aktiv" });
    if (cfg.get("dropbox_enabled") !== "true") return json({ skipped: true, reason: "Dropbox-Integration nicht aktiv" });
    const baselineDone = cfg.get("dropbox_poll_baseline_done") === "true";

    // ── HERO abfragen ──────────────────────────────────────────────────
    const projRes = await fetchAll(apiKey, "project_matches",
      "id project_nr name customer { id first_name last_name company_name }");
    if (projRes.error && projRes.rows.length === 0) return json({ error: `HERO-Abfrage fehlgeschlagen: ${projRes.error}` }, 502);
    const projects = projRes.rows;

    // Eigenständige Kunden (auch ohne Projekt). Falls das contacts-Query im
    // Account nicht verfügbar ist, reichen die Kunden aus den Projekten.
    const contactRes = await fetchAll(apiKey, "contacts", "id first_name last_name company_name");
    const contacts = contactRes.error ? [] : contactRes.rows;

    // Kunden-Map: id -> Anzeigename (Projekte + Kontakte kombiniert)
    const customers = new Map<number, string>();
    for (const c of contacts) {
      const id = Number(c?.id);
      if (Number.isFinite(id) && id > 0) customers.set(id, customerDisplayName(c));
    }
    for (const p of projects) {
      const id = Number(p?.customer?.id);
      if (Number.isFinite(id) && id > 0 && !customers.has(id)) customers.set(id, customerDisplayName(p.customer));
    }

    // ── Bereits Gesehenes laden ────────────────────────────────────────
    // WICHTIG: paginiert lesen. Ein einfaches select() liefert nur die ersten
    // 1000 Zeilen; sobald dropbox_synced größer ist, wären die restlichen
    // Einträge nicht im "gesehen"-Set und würden bei jedem Lauf erneut als neu
    // gelten (Endlos-Wiederholung derselben Kunden/Projekte).
    const seenProjects = new Set<number>();
    const seenCustomers = new Set<number>();
    for (let from = 0; ; from += 1000) {
      const { data: chunk, error: chunkErr } = await supabase
        .from("dropbox_synced").select("kind, hero_id").range(from, from + 999);
      if (chunkErr) break;
      for (const r of (chunk || []) as any[]) {
        if (r.kind === "project") seenProjects.add(Number(r.hero_id));
        else if (r.kind === "customer") seenCustomers.add(Number(r.hero_id));
      }
      if (!chunk || chunk.length < 1000) break;
    }

    const newCustomers = [...customers.entries()].filter(([id]) => !seenCustomers.has(id));
    const newProjects = projects.filter((p: any) => Number.isFinite(Number(p?.id)) && !seenProjects.has(Number(p.id)));

    // ── Baseline: aktuellen Stand nur markieren, nichts anlegen ────────
    if (!baselineDone) {
      const rows = [
        ...newCustomers.map(([id]) => ({ kind: "customer", hero_id: id })),
        ...newProjects.map((p: any) => ({ kind: "project", hero_id: Number(p.id) })),
      ];
      for (let i = 0; i < rows.length; i += 500) {
        await supabase.from("dropbox_synced").upsert(rows.slice(i, i + 500), { onConflict: "kind,hero_id" });
      }
      await supabase.from("app_config").upsert({ key: "dropbox_poll_baseline_done", value: "true" }, { onConflict: "key" });
      return json({ baseline: true, markedProjects: newProjects.length, markedCustomers: newCustomers.length });
    }

    // ── Neue Einträge: markieren + Automationen feuern ─────────────────
    let fired = 0;
    let customersHandled = 0;
    for (const [id, name] of newCustomers) {
      if (fired >= MAX_EVENTS_PER_RUN) break;
      await supabase.from("dropbox_synced").upsert({ kind: "customer", hero_id: id }, { onConflict: "kind,hero_id" });
      await dispatchAutomations(supabase, "hero_customer_created", {
        heroCustomerId: id,
        customerName: name,
      });
      fired++; customersHandled++;
    }

    let projectsHandled = 0;
    for (const p of newProjects) {
      if (fired >= MAX_EVENTS_PER_RUN) break;
      const pid = Number(p.id);
      await supabase.from("dropbox_synced").upsert({ kind: "project", hero_id: pid }, { onConflict: "kind,hero_id" });
      await dispatchAutomations(supabase, "hero_project_created", {
        heroProjectId: pid,
        projectNr: String(p.project_nr || ""),
        projectName: String(p.name || ""),
        heroCustomerId: Number(p?.customer?.id) || null,
        customerName: customerDisplayName(p.customer),
      });
      fired++; projectsHandled++;
    }

    return json({
      ok: true,
      newCustomers: customersHandled,
      newProjects: projectsHandled,
      pendingNextRun: Math.max(0, newCustomers.length + newProjects.length - fired),
      contactsQueryOk: !contactRes.error,
    });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
