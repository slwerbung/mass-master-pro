// Edge function: poll HERO for NEW projects/customers and fire the
// corresponding automation triggers (hero_project_created /
// hero_customer_created). The Dropbox folder creation itself is an
// automation ACTION (dropbox_create_project_folder etc.) so admins control
// the behaviour in the familiar Automationen tab and every run is logged in
// automation_runs.
//
// Was zählt als "neu": ein harter ID-Wasserstand (app_config
// dropbox_watermark_project_id / _customer_id). HERO vergibt fortlaufende,
// aufsteigende IDs; beim ersten Lauf wird der aktuelle Höchststand gemerkt.
// Danach gelten NUR IDs oberhalb dieser Grenze als Kandidaten -> alles, was
// beim Einrichten schon existierte, kann nie auslösen. dropbox_synced dient
// nur noch als zweite Sicherung gegen doppelte Ordner desselben Neueintrags.
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
      .in("key", ["hero_api_key", "hero_enabled", "dropbox_enabled", "dropbox_poll_baseline_done",
        "dropbox_watermark_project_id", "dropbox_watermark_customer_id"]);
    const cfg = new Map((cfgRows || []).map((r: any) => [r.key, r.value]));
    const apiKey = cfg.get("hero_api_key") as string | undefined;
    if (cfg.get("hero_enabled") !== "true" || !apiKey) return json({ skipped: true, reason: "HERO nicht aktiv" });
    if (cfg.get("dropbox_enabled") !== "true") return json({ skipped: true, reason: "Dropbox-Integration nicht aktiv" });

    // Harter Wasserstand: höchste bekannte HERO-ID. Leer/NULL = noch nicht
    // gesetzt. Nur IDs OBERHALB gelten als Kandidaten -> Bestand kann nie feuern.
    const parseWm = (v: unknown) => {
      const n = Number(v);
      return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
    };
    const wmProject = parseWm(cfg.get("dropbox_watermark_project_id"));
    const wmCustomer = parseWm(cfg.get("dropbox_watermark_customer_id"));

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

    // Höchststände der aktuellen HERO-Daten (für Wasserstand-Init/Vergleich).
    const projIds = projects.map((p: any) => Number(p?.id)).filter((n: number) => Number.isFinite(n) && n > 0);
    const custIds = [...customers.keys()];
    const maxProjectId = projIds.length ? Math.max(...projIds) : 0;
    const maxCustomerId = custIds.length ? Math.max(...custIds) : 0;

    // ── Wasserstand initialisieren (Baseline) ──────────────────────────
    // Kein Wasserstand gesetzt = Erst-Einrichtung ODER Upgrade von der alten
    // Logik. In beiden Fällen: aktuellen Höchststand als Grenze merken und
    // NICHTS auslösen. Alle jetzt vorhandenen Kunden/Projekte gelten damit
    // dauerhaft als Bestand und können nie wieder feuern.
    if (wmProject === null || wmCustomer === null) {
      await supabase.from("app_config").upsert([
        { key: "dropbox_watermark_project_id",  value: String(maxProjectId) },
        { key: "dropbox_watermark_customer_id", value: String(maxCustomerId) },
        { key: "dropbox_poll_baseline_done",    value: "true" },
      ], { onConflict: "key" });
      return json({
        baseline: true,
        watermarkProjectId: maxProjectId,
        watermarkCustomerId: maxCustomerId,
        note: "Bestand als Grenze gemerkt. Ab jetzt lösen nur Neuanlagen oberhalb dieser IDs aus.",
      });
    }

    // ── Bereits verarbeitete IDs laden (zweite Sicherung gegen Doppel-
    // anlage). WICHTIG paginiert lesen: ein einfaches select() liefert nur die
    // ersten 1000 Zeilen. ────────────────────────────────────────────────
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

    // Kandidaten = NUR IDs oberhalb des Wasserstands, aufsteigend sortiert.
    const newCustomers = [...customers.entries()]
      .filter(([id]) => id > wmCustomer).sort((a, b) => a[0] - b[0]);
    const newProjects = projects
      .filter((p: any) => Number.isFinite(Number(p?.id)) && Number(p.id) > wmProject)
      .sort((a: any, b: any) => Number(a.id) - Number(b.id));

    // ── Neue Kunden: markieren + Automation feuern ─────────────────────
    // Wasserstand wird lückenlos-aufsteigend nachgezogen: advanceCustomer
    // wandert nur so weit, wie alles darunter erledigt ist (fired ODER bereits
    // in dropbox_synced). Beim Cap bleibt der Rest oberhalb -> nächster Lauf.
    let fired = 0;
    let customersHandled = 0;
    let advanceCustomer = wmCustomer;
    for (const [id, name] of newCustomers) {
      if (seenCustomers.has(id)) { advanceCustomer = id; continue; }
      if (fired >= MAX_EVENTS_PER_RUN) break;
      await supabase.from("dropbox_synced").upsert({ kind: "customer", hero_id: id }, { onConflict: "kind,hero_id" });
      await dispatchAutomations(supabase, "hero_customer_created", {
        heroCustomerId: id,
        customerName: name,
      });
      advanceCustomer = id;
      fired++; customersHandled++;
    }

    let projectsHandled = 0;
    let advanceProject = wmProject;
    for (const p of newProjects) {
      const pid = Number(p.id);
      if (seenProjects.has(pid)) { advanceProject = pid; continue; }
      if (fired >= MAX_EVENTS_PER_RUN) break;
      await supabase.from("dropbox_synced").upsert({ kind: "project", hero_id: pid }, { onConflict: "kind,hero_id" });
      await dispatchAutomations(supabase, "hero_project_created", {
        heroProjectId: pid,
        projectNr: String(p.project_nr || ""),
        projectName: String(p.name || ""),
        heroCustomerId: Number(p?.customer?.id) || null,
        customerName: customerDisplayName(p.customer),
      });
      advanceProject = pid;
      fired++; projectsHandled++;
    }

    // Wasserstand nachziehen (nur vorwärts).
    const wmUpdates: { key: string; value: string }[] = [];
    if (advanceCustomer > wmCustomer) wmUpdates.push({ key: "dropbox_watermark_customer_id", value: String(advanceCustomer) });
    if (advanceProject > wmProject) wmUpdates.push({ key: "dropbox_watermark_project_id", value: String(advanceProject) });
    if (wmUpdates.length) await supabase.from("app_config").upsert(wmUpdates, { onConflict: "key" });

    return json({
      ok: true,
      newCustomers: customersHandled,
      newProjects: projectsHandled,
      pendingNextRun: Math.max(0, newCustomers.length + newProjects.length - customersHandled - projectsHandled),
      watermarkProjectId: advanceProject,
      watermarkCustomerId: advanceCustomer,
      contactsQueryOk: !contactRes.error,
    });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
