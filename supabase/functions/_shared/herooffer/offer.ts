// hero-offer: Angebots-ENTWURF per API anlegen (GraphQL create_document), gemeinsamer Code für hero-offer und die Testfunktion.
// Nur Angebots-Entwurf (171300), nie abschließen/versenden. Mehrere Leistungen sind erlaubt; solange hero-calc mehrere
// Leistungen nicht rechnet (SUPPORT.multipleServices), wird recalc übersprungen und das deutlich gemeldet.
import { SUPPORT } from "../herocalc/guard.ts";
import { runCommand, type Ctx } from "../herocalc/service.ts";

export const GQL_URL = "https://login.hero-software.de/api/external/v9/graphql";
export const OFFER_TYPE = 171300; // Angebot. Nie Dateiordner-IDs als document_type_id (siehe CLAUDE.md).
export const MAX_SERVICES = 20;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Gql = (query: string, variables?: Record<string, unknown>) => Promise<any>;

export function makeGql(apiKey: string, fetchFn: typeof fetch = fetch): Gql {
  return async (query, variables = {}) => {
    const r = await fetchFn(GQL_URL, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables }),
    });
    if (!r.ok) throw new Error(`HERO GraphQL HTTP ${r.status}`);
    const j = await r.json();
    if (j.errors?.length) throw new Error(`HERO GraphQL: ${j.errors.map((e: any) => e.message).join("; ").slice(0, 400)}`);
    return j.data;
  };
}

export async function findProject(gql: Gql, projectNr: unknown) {
  const m = String(projectNr ?? "").match(/(\d+)\s*$/);
  if (!m) throw new Error("project_nr ungültig (z. B. WER-1978)");
  const d = await gql(`query($r:String){project_matches(relative_id:$r){id project_nr name customer{full_name company_name} current_project_match_status{step{name}}}}`, { r: String(Number(m[1])) });
  const want = String(projectNr).toUpperCase().replace(/\s/g, "");
  const list = (d.project_matches ?? []).filter((p: any) => !/^[A-Z]+-/.test(want) || String(p.project_nr).toUpperCase() === want);
  if (list.length === 0) throw new Error(`Projekt ${projectNr} nicht gefunden`);
  if (list.length > 1) throw new Error(`Projekt ${projectNr} nicht eindeutig: ${list.map((p: any) => p.project_nr).join(", ")}`);
  return list[0];
}

export async function getCatalogService(gql: Gql, id: number) {
  const d = await gql(`query($i:[Int]){supply_services(service_ids:$i){id nr name unit_type positions{__typename ... on Documents_SupplyProduct{id nr name quantity unit_type base_price net_price_per_unit} ... on WageGroup{id name quantity}}}}`, { i: [id] });
  const s = d.supply_services?.[0];
  if (!s) throw new Error(`Katalogleistung ${id} nicht gefunden`);
  return s;
}

/**
 * Leistungen der Anfrage: `services: [...]` oder (rückwärtskompatibel) das Einzelformat mit
 * catalog_service_id | products+wages auf oberster Ebene.
 */
export function serviceInputs(p: any): any[] {
  if (p.services !== undefined) {
    if (!Array.isArray(p.services) || p.services.length === 0) throw new Error("services muss eine nicht leere Liste sein");
    if (p.services.length > MAX_SERVICES) throw new Error(`Höchstens ${MAX_SERVICES} Leistungen je Angebot`);
    return p.services;
  }
  return [{
    name: p.name, nr: p.nr, unit_type: p.unit_type, description: p.description, quantity: p.quantity,
    catalog_service_id: p.catalog_service_id, products: p.products, wages: p.wages, quantity_overrides: p.quantity_overrides,
  }];
}

/** Eine Leistung für create_supply_service bauen (Katalog oder freie Positionen). */
export async function buildService(gql: Gql, input: any, index: number) {
  const at = (m: string) => new Error(`Leistung ${index + 1}: ${m}`);
  if (!input || typeof input !== "object") throw at("ungültig");
  let products: { id: string; quantity: number }[] = [];
  let wages: { id: string | number; timeMinutes: number }[] = [];
  let name = input.name as string | undefined;
  let unit = (input.unit_type as string) ?? "Stk";
  let nr = input.nr as string | number | undefined;
  const ov: Record<string, number> = input.quantity_overrides ?? {};
  if (input.catalog_service_id !== undefined) {
    const s = await getCatalogService(gql, Number(input.catalog_service_id));
    name = name ?? s.name; nr = nr ?? s.nr; unit = input.unit_type ?? s.unit_type ?? unit;
    for (const pos of s.positions) {
      const q = Number(ov[String(pos.id)] ?? pos.quantity);
      if (pos.__typename === "WageGroup") wages.push({ id: pos.id, timeMinutes: q });
      else products.push({ id: pos.id, quantity: q });
    }
  } else {
    products = (input.products ?? []).map((x: any) => ({ id: x.id, quantity: Number(x.quantity) }));
    wages = (input.wages ?? []).map((x: any) => ({ id: x.id, timeMinutes: Number(x.minutes) }));
  }
  if (!name || typeof name !== "string") throw at("name fehlt");
  if (products.length + wages.length === 0) throw at("keine Positionen");
  if ([...products.map((x) => x.quantity), ...wages.map((x) => x.timeMinutes)].some((q) => !Number.isFinite(q) || q < 0)) throw at("Menge ungültig");
  const quantity = Number(input.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0) throw at("quantity muss größer als 0 sein");
  return { name, nr, unit_type: unit, vat_percent: 19, quantity, description: input.description ?? "", productPositions: products, wagePositions: wages };
}

/** Alle Angebots-Entwürfe (status_code 0) eines Projekts als Dokument-IDs. */
export async function listOfferDraftIds(gql: Gql, projectMatchId: number): Promise<number[]> {
  const d = await gql(`query($i:[Int]){project_matches(ids:$i){customer_documents{id status_code document_type{base_type}}}}`, { i: [projectMatchId] });
  return (d.project_matches?.[0]?.customer_documents ?? [])
    .filter((x: any) => x.document_type?.base_type === "offer" && x.status_code === 0).map((x: any) => Number(x.id));
}

/**
 * Entwurf anlegen und die neue Dokument-ID sicher bestimmen: Entwürfe VOR und NACH dem Anlegen vergleichen.
 * Genau ein neuer Entwurf, sonst Abbruch mit Meldung (nie "höchste ID raten").
 */
export async function createDraft(gql: Gql, projectMatchId: number, services: any[]) {
  const before = await listOfferDraftIds(gql, projectMatchId);
  const res = await gql(`mutation($input: Documents_CreateDocumentInput!, $actions: [Documents_DocumentBuilderActionInput!]!){create_document(input:$input, actions:$actions){id}}`,
    { input: { document_type_id: OFFER_TYPE, project_match_id: projectMatchId }, actions: services.map((s) => ({ create_supply_service: s })) });
  const after = await listOfferDraftIds(gql, projectMatchId);
  const fresh = after.filter((id) => !before.includes(id));
  if (fresh.length !== 1) {
    throw new Error(`Neuer Entwurf nicht eindeutig (${fresh.length} neue Entwürfe${fresh.length ? `: ${fresh.join(", ")}` : ""}) – bitte in HERO prüfen`);
  }
  return { documentId: fresh[0], returnedId: Number(res?.create_document?.id) };
}

/**
 * Protokoll in hero_offer_log. Die Tabelle hat den Aufbau (caller, project_nr, document_id, result text):
 * alles Weitere (command, ok, project_match_id, Ergebnis) steht als JSON in `result`.
 */
async function logOffer(sb: any, row: { caller: string; project_nr: string; document_id: number | null; result: Record<string, unknown> }) {
  try {
    await sb.from("hero_offer_log").insert({
      caller: row.caller, project_nr: row.project_nr, document_id: row.document_id, result: JSON.stringify(row.result),
    });
  } catch { /* Protokoll darf nichts verdecken */ }
}

export interface OfferOptions {
  /** Zusätzliche Prüfung vor dem Schreiben (z. B. Testfunktion nur WER-1984). */
  projectGuard?: (project: any) => void;
  /** Kennzeichnung im Protokoll */
  logCommand?: string;
}

/** create_offer: Vorschau (dry_run, Standard) oder echtes Anlegen als Entwurf. */
export async function createOffer(ctx: Ctx, gql: Gql, p: any, opts: OfferOptions = {}) {
  const project = await findProject(gql, p.project_nr);
  const inputs = serviceInputs(p);
  const services = [];
  for (let i = 0; i < inputs.length; i++) services.push(await buildService(gql, inputs[i], i));
  const preview = {
    project: { id: project.id, project_nr: project.project_nr, name: project.name, kunde: project.customer?.company_name || project.customer?.full_name, status: project.current_project_match_status?.step?.name },
    ...(services.length === 1 ? { service: services[0] } : {}),
    services,
  };
  const skipRecalc = services.length > 1 && !SUPPORT.multipleServices;
  if (p.dry_run !== false) return { dry_run: true, wrote: false, ...preview, recalc_will_be_skipped: skipRecalc };

  opts.projectGuard?.(project);
  const log = (ok: boolean, documentId: number | null, result: Record<string, unknown>) =>
    logOffer(ctx.supabase, {
      caller: ctx.caller, project_nr: project.project_nr, document_id: documentId,
      result: { command: opts.logCommand ?? "create_offer", ok, project_match_id: Number(project.id), ...result },
    });

  let created: { documentId: number; returnedId: number };
  try {
    created = await createDraft(gql, Number(project.id), services);
  } catch (e) {
    await log(false, null, { error: msg(e), services: services.length });
    throw e;
  }
  const docId = created.documentId;

  // Summen: hero-calc recalc direkt (gleicher Code, gleiche Sperre/Undo). Mehrere Leistungen noch nicht freigegeben -> überspringen.
  let recalc: any;
  const out: Record<string, unknown> = {};
  if (skipRecalc) {
    recalc = { skipped: true };
    out.recalc_skipped = true;
    out.recalc_skip_reason = "Mehrere Leistungen: hero-calc rechnet das noch nicht (nicht freigegeben). Summen in HERO können unvollständig sein (EK 0, VK ungerundet), bis jemand den Entwurf in HERO öffnet.";
  } else {
    out.recalc_skipped = false;
    try {
      const r = await runCommand(ctx, docId, { cmd: "recalc" }, false);
      recalc = r.after;
    } catch (e) {
      recalc = { error: msg(e) };
    }
  }
  await log(true, docId, { services: services.length, recalc_skipped: out.recalc_skipped, recalc: recalc?.error ? { error: recalc.error } : (recalc?.skipped ? { skipped: true } : recalc) });
  return {
    dry_run: false, wrote: true, document_id: docId, url: `https://login.hero-software.de/partner/Documents/edit/${docId}`,
    ...preview, ...out, recalc, create_document_id: Number.isFinite(created.returnedId) ? created.returnedId : null,
  };
}
