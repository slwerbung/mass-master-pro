// hero-offer: Angebots-ENTWURF in HERO komplett per API anlegen (GraphQL create_document + hero-calc recalc) und Rechnungs-ENTWURF aus einem abgeschlossenen Angebot.
// POST { action, ... } -> immer HTTP 200 { ok, data } | { ok:false, error }.
// Auth: teamKey (Tabelle hero_team_keys, nur Hash) ODER adminToken/employeeToken/sessionToken (jeder Mitarbeiter-Login genügt).
// Actions: find_project { project_nr } | find_service { search } | get_service { service_id } |
//          create_catalog_service { name, unit_type?, description?, products:[{id,quantity}], wages:[{id,minutes}], dry_run? } |
//          create_offer { project_nr, services: [{ section?, catalog_service_id, quantity?, quantity_overrides? } | freie Leistung mit allow_unlinked], titles?, dry_run? } |
//          create_invoice_draft { project_nr, offer_document_id, service_uids?, dry_run? }  (Rechnungs-Entwurf aus abgeschlossenem Angebot, Standard dry_run)
// Katalogleistungen werden VERKNÜPFT eingefügt (add_existing_service). Titel PROJEKTIERUNG/PRODUKTION/MONTAGE kommen automatisch (titles:false schaltet ab, z. B. OEB).
// Nur Entwürfe (Angebot 171300, Rechnung 171302). dry_run ist Standard. Nie abschließen/versenden. Jedes Anlegen steht in hero_offer_log.
import { createClient } from "@supabase/supabase-js";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";
import { createCatalogService, createOffer, findProject, getCatalogService, makeGql } from "../_shared/herooffer/offer.ts";
import { createInvoiceDraft } from "../_shared/herooffer/invoice.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json();
    const { action, sessionToken, adminToken, employeeToken, teamKey, ...p } = body;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let caller: string;
    if (typeof teamKey === "string" && teamKey.length >= 20) {
      const { data: k } = await supabase.from("hero_team_keys").select("id,active").eq("key_hash", await sha256Hex(teamKey)).maybeSingle();
      if (!k || !k.active) return reply({ ok: false, error: "Unauthorized" });
      caller = `key:${k.id}`;
      await supabase.from("hero_team_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
    } else {
      const token = adminToken || employeeToken || sessionToken;
      if (!token || typeof token !== "string") return reply({ ok: false, error: "Unauthorized" });
      const payload = await verifySessionToken(token, getSessionSecret());
      if (!payload || (payload.role !== "admin" && payload.role !== "employee")) return reply({ ok: false, error: "Unauthorized" });
      caller = `${payload.role}:${String(payload.userId ?? "?")}`;
    }
    const { data: row } = await supabase.from("app_config").select("value").eq("key", "hero_api_key").maybeSingle();
    const apiKey = row?.value as string | undefined;
    if (!apiKey) return reply({ ok: false, error: "Kein HERO API Key konfiguriert" });
    const gql = makeGql(apiKey);

    if (action === "find_project") return reply({ ok: true, data: await findProject(gql, p.project_nr) });
    if (action === "find_service") {
      if (typeof p.search !== "string" || p.search.length < 2) throw new Error("search fehlt");
      const d = await gql(`query($s:String){supply_services(search:$s){id nr name unit_type}}`, { s: p.search });
      return reply({ ok: true, data: (d.supply_services ?? []).slice(0, 25) });
    }
    if (action === "get_service") return reply({ ok: true, data: await getCatalogService(gql, Number(p.service_id)) });
    if (action === "create_catalog_service") return reply({ ok: true, data: await createCatalogService({ supabase, apiKey, caller }, gql, p) });
    if (action === "create_invoice_draft") return reply({ ok: true, data: await createInvoiceDraft({ supabase, apiKey, caller }, gql, p) });
    if (action !== "create_offer") return reply({ ok: false, error: `Unbekannte action ${action}` });
    return reply({ ok: true, data: await createOffer({ supabase, apiKey, caller }, gql, p) });
  } catch (e) {
    return reply({ ok: false, error: e instanceof Error ? e.message : "Unbekannter Fehler" });
  }
});
