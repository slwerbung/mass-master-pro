// hero-offer: Angebots-ENTWURF in HERO komplett per API anlegen (GraphQL create_document + hero-calc recalc).
// POST { action, ... } -> immer HTTP 200 { ok, data } | { ok:false, error }. Auth wie hero-calc (adminToken/employeeToken/sessionToken).
// Actions: find_project { project_nr } | find_service { search } | get_service { service_id } |
//          create_offer { project_nr, catalog_service_id | products+wages, name?, nr?, description?, unit_type?, quantity_overrides?, dry_run? }
// Nur Angebots-Entwurf (171300). dry_run ist Standard. Nie abschließen/versenden.
import { createClient } from "@supabase/supabase-js";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
const GQL = "https://login.hero-software.de/api/external/v9/graphql";
const OFFER_TYPE = 171300;

async function gql(apiKey: string, query: string, variables: Record<string, unknown> = {}) {
  const r = await fetch(GQL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error(`HERO GraphQL HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(`HERO GraphQL: ${j.errors.map((e: any) => e.message).join("; ").slice(0, 400)}`);
  return j.data;
}

async function findProject(apiKey: string, projectNr: unknown) {
  const m = String(projectNr ?? "").match(/(\d+)\s*$/);
  if (!m) throw new Error("project_nr ungültig (z. B. WER-1978)");
  const d = await gql(apiKey, `query($r:String){project_matches(relative_id:$r){id project_nr name customer{full_name company_name} current_project_match_status{step{name}}}}`, { r: String(Number(m[1])) });
  const want = String(projectNr).toUpperCase().replace(/\s/g, "");
  const list = (d.project_matches ?? []).filter((p: any) => !/^[A-Z]+-/.test(want) || String(p.project_nr).toUpperCase() === want);
  if (list.length === 0) throw new Error(`Projekt ${projectNr} nicht gefunden`);
  if (list.length > 1) throw new Error(`Projekt ${projectNr} nicht eindeutig: ${list.map((p: any) => p.project_nr).join(", ")}`);
  return list[0];
}

async function getService(apiKey: string, id: number) {
  const d = await gql(apiKey, `query($i:[Int]){supply_services(service_ids:$i){id nr name unit_type positions{__typename ... on Documents_SupplyProduct{id nr name quantity unit_type base_price net_price_per_unit} ... on WageGroup{id name quantity}}}}`, { i: [id] });
  const s = d.supply_services?.[0];
  if (!s) throw new Error(`Katalogleistung ${id} nicht gefunden`);
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json();
    const { action, sessionToken, adminToken, employeeToken, ...p } = body;
    const token = adminToken || employeeToken || sessionToken;
    if (!token || typeof token !== "string") return reply({ ok: false, error: "Unauthorized" });
    const payload = await verifySessionToken(token, getSessionSecret());
    if (!payload || (payload.role !== "admin" && payload.role !== "employee")) return reply({ ok: false, error: "Unauthorized" });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await supabase.from("app_config").select("value").eq("key", "hero_api_key").maybeSingle();
    const apiKey = row?.value as string | undefined;
    if (!apiKey) return reply({ ok: false, error: "Kein HERO API Key konfiguriert" });

    if (action === "find_project") return reply({ ok: true, data: await findProject(apiKey, p.project_nr) });
    if (action === "find_service") {
      if (typeof p.search !== "string" || p.search.length < 2) throw new Error("search fehlt");
      const d = await gql(apiKey, `query($s:String){supply_services(search:$s){id nr name unit_type}}`, { s: p.search });
      return reply({ ok: true, data: (d.supply_services ?? []).slice(0, 25) });
    }
    if (action === "get_service") return reply({ ok: true, data: await getService(apiKey, Number(p.service_id)) });
    if (action !== "create_offer") return reply({ ok: false, error: `Unbekannte action ${action}` });

    const project = await findProject(apiKey, p.project_nr);
    let products: { id: string; quantity: number }[] = [];
    let wages: { id: string | number; timeMinutes: number }[] = [];
    let name = p.name as string | undefined, unit = (p.unit_type as string) ?? "Stk", nr = p.nr as string | number | undefined;
    const ov: Record<string, number> = p.quantity_overrides ?? {};
    if (p.catalog_service_id !== undefined) {
      const s = await getService(apiKey, Number(p.catalog_service_id));
      name = name ?? s.name; nr = nr ?? s.nr; unit = p.unit_type ?? s.unit_type ?? unit;
      for (const pos of s.positions) {
        const q = Number(ov[String(pos.id)] ?? pos.quantity);
        if (pos.__typename === "WageGroup") wages.push({ id: pos.id, timeMinutes: q });
        else products.push({ id: pos.id, quantity: q });
      }
    } else {
      products = (p.products ?? []).map((x: any) => ({ id: x.id, quantity: Number(x.quantity) }));
      wages = (p.wages ?? []).map((x: any) => ({ id: x.id, timeMinutes: Number(x.minutes) }));
    }
    if (!name) throw new Error("name fehlt");
    if (products.length + wages.length === 0) throw new Error("keine Positionen");
    if ([...products.map((x) => x.quantity), ...wages.map((x) => x.timeMinutes)].some((q) => !Number.isFinite(q) || q < 0)) throw new Error("Menge ungültig");
    const service = { name, nr, unit_type: unit, vat_percent: 19, quantity: 1, description: p.description ?? "", productPositions: products, wagePositions: wages };
    const preview = { project: { id: project.id, project_nr: project.project_nr, name: project.name, kunde: project.customer?.company_name || project.customer?.full_name, status: project.current_project_match_status?.step?.name }, service };
    if (p.dry_run !== false) return reply({ ok: true, data: { dry_run: true, wrote: false, ...preview } });

    await gql(apiKey, `mutation($input: Documents_CreateDocumentInput!, $actions: [Documents_DocumentBuilderActionInput!]!){create_document(input:$input, actions:$actions){id}}`,
      { input: { document_type_id: OFFER_TYPE, project_match_id: Number(project.id) }, actions: [{ create_supply_service: service }] });
    const d = await gql(apiKey, `query($i:[Int]){project_matches(ids:$i){customer_documents{id status_code document_type{base_type}}}}`, { i: [Number(project.id)] });
    const docs = (d.project_matches?.[0]?.customer_documents ?? []).filter((x: any) => x.document_type?.base_type === "offer" && x.status_code === 0);
    const docId = Math.max(...docs.map((x: any) => Number(x.id)));
    if (!Number.isFinite(docId)) throw new Error("Neuer Entwurf nicht gefunden – bitte in HERO prüfen");
    // Summen neu rechnen über hero-calc (gleicher Token)
    const rr = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/hero-calc`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recalc", document_id: docId, dry_run: false, employeeToken: token }),
    }).then((r) => r.json());
    return reply({ ok: true, data: { dry_run: false, wrote: true, document_id: docId, url: `https://login.hero-software.de/partner/Documents/edit/${docId}`, ...preview, recalc: rr.ok ? rr.data.after : { error: rr.error } } });
  } catch (e) {
    return reply({ ok: false, error: e instanceof Error ? e.message : "Unbekannter Fehler" });
  }
});
