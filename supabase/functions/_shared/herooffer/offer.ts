// hero-offer: Angebots-ENTWURF per API anlegen (GraphQL create_document), gemeinsamer Code für hero-offer und die Testfunktion.
// Nur Angebots-Entwurf (171300), nie abschließen/versenden.
// Katalogleistungen: VERKNÜPFT per add_existing_service (Silas-Regel 06.10.). Danach Mengen (quantity_overrides) per hero-calc-Befehle setzen und recalc.
// Titel PROJEKTIERUNG / PRODUKTION / MONTAGE (ohne Nummer) kommen automatisch, titles:false schaltet ab (z. B. OEB).
// Freie, unverknüpfte Leistungen (create_supply_service im Entwurf) nur mit allow_unlinked:true.
// Neue Katalogleistung (create_catalog_service): Silas-Entscheidung 26.11.: ohne Freigabe anlegen, wenn keine passt.
import { runCommand, loadDraft, type Ctx } from "../herocalc/service.ts";

export const GQL_URL = "https://login.hero-software.de/api/external/v9/graphql";
export const OFFER_TYPE = 171300; // Angebot. Nie Dateiordner-IDs als document_type_id (siehe CLAUDE.md).
export const MAX_SERVICES = 20;
export const SECTIONS = ["PROJEKTIERUNG", "PRODUKTION", "MONTAGE"] as const;

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

/** Leistungen der Anfrage: `services: [...]` oder (rückwärtskompatibel) das Einzelformat. */
export function serviceInputs(p: any): any[] {
  if (p.services !== undefined) {
    if (!Array.isArray(p.services) || p.services.length === 0) throw new Error("services muss eine nicht leere Liste sein");
    if (p.services.length > MAX_SERVICES) throw new Error(`Höchstens ${MAX_SERVICES} Leistungen je Angebot`);
    return p.services;
  }
  return [{
    section: p.section, name: p.name, nr: p.nr, unit_type: p.unit_type, description: p.description, quantity: p.quantity,
    catalog_service_id: p.catalog_service_id, products: p.products, wages: p.wages, quantity_overrides: p.quantity_overrides, allow_unlinked: p.allow_unlinked,
  }];
}

export interface Built {
  section: string;
  linked: boolean;
  catalog_service_id?: number;
  name: string;
  quantity: number;
  overrides: Record<string, number>;
  positions?: { id: string; name: string; quantity: number; kind: string }[];
  payload?: any; // nur freie Leistung
}

/** Eine Leistung bauen: Katalog (verknüpft) oder frei (nur mit allow_unlinked). */
export async function buildService(gql: Gql, input: any, index: number, defaultSection = "PRODUKTION"): Promise<Built> {
  const at = (m: string) => new Error(`Leistung ${index + 1}: ${m}`);
  if (!input || typeof input !== "object") throw at("ungültig");
  const section = String(input.section ?? defaultSection).toUpperCase();
  if (!(SECTIONS as readonly string[]).includes(section)) throw at(`section muss ${SECTIONS.join(", ")} sein`);
  const quantity = Number(input.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0) throw at("quantity muss größer als 0 sein");
  const ov: Record<string, number> = input.quantity_overrides ?? {};

  if (input.catalog_service_id !== undefined) {
    const s = await getCatalogService(gql, Number(input.catalog_service_id));
    const ids = new Set(s.positions.map((x: any) => String(x.id)));
    for (const [k, v] of Object.entries(ov)) {
      if (!ids.has(String(k))) throw at(`quantity_overrides: Position ${k} gehört nicht zur Leistung ${s.nr}`);
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw at(`quantity_overrides ${k}: Menge ungültig`);
    }
    return {
      section, linked: true, catalog_service_id: Number(s.id), name: s.name, quantity, overrides: ov,
      positions: s.positions.map((x: any) => ({ id: String(x.id), name: x.name, kind: x.__typename === "WageGroup" ? "Lohn(min)" : "Material", quantity: Number(ov[String(x.id)] ?? x.quantity) })),
    };
  }

  if (input.allow_unlinked !== true) {
    throw at("Freie Leistung ohne Katalogverknüpfung ist nicht erlaubt (catalog_service_id angeben). Fehlt eine passende Katalogleistung: erst Aktion create_catalog_service ausführen (ohne Freigabe erlaubt), dann deren id als catalog_service_id verwenden.");
  }
  const products = (input.products ?? []).map((x: any) => ({ id: x.id, quantity: Number(x.quantity) }));
  const wages = (input.wages ?? []).map((x: any) => ({ id: Number(x.id), timeMinutes: Number(x.minutes) }));
  const name = input.name as string | undefined;
  if (!name || typeof name !== "string") throw at("name fehlt");
  if (products.length + wages.length === 0) throw at("keine Positionen");
  if (wages.some((w: any) => !Number.isInteger(w.id))) throw at("Lohngruppen-ID ungültig");
  if ([...products.map((x: any) => x.quantity), ...wages.map((x: any) => x.timeMinutes)].some((q: number) => !Number.isFinite(q) || q < 0)) throw at("Menge ungültig");
  return {
    section, linked: false, name, quantity, overrides: {},
    payload: { name, nr: input.nr, unit_type: input.unit_type ?? "Stk", vat_percent: 19, quantity, description: input.description ?? "", productPositions: products, wagePositions: wages },
  };
}

/** Reihenfolge wie im Dokument: je Abschnitt (Titel) die zugehörigen Leistungen. */
export function orderBySection(services: Built[], withTitles: boolean): Built[] {
  if (!withTitles) return services;
  return SECTIONS.flatMap((sec) => services.filter((s) => s.section === sec));
}

export function buildActions(ordered: Built[], withTitles: boolean): any[] {
  const act = (s: Built) => (s.linked
    ? { add_existing_service: { supplyServiceId: s.catalog_service_id, quantity: s.quantity } }
    : { create_supply_service: s.payload });
  if (!withTitles) return ordered.map(act);
  const out: any[] = [];
  for (const sec of SECTIONS) {
    out.push({ add_title: { text: sec } });
    for (const s of ordered.filter((x) => x.section === sec)) out.push(act(s));
  }
  return out;
}

/** Alle Angebots-Entwürfe (status_code 0) eines Projekts als Dokument-IDs. */
export async function listOfferDraftIds(gql: Gql, projectMatchId: number): Promise<number[]> {
  const d = await gql(`query($i:[Int]){project_matches(ids:$i){customer_documents{id status_code document_type{base_type}}}}`, { i: [projectMatchId] });
  return (d.project_matches?.[0]?.customer_documents ?? [])
    .filter((x: any) => x.document_type?.base_type === "offer" && x.status_code === 0).map((x: any) => Number(x.id));
}

/** Entwurf anlegen und die neue Dokument-ID sicher bestimmen (Entwürfe vor/nach vergleichen). Genau ein neuer Entwurf, sonst Abbruch. */
export async function createDraft(gql: Gql, projectMatchId: number, actions: any[]) {
  const before = await listOfferDraftIds(gql, projectMatchId);
  const res = await gql(`mutation($input: Documents_CreateDocumentInput!, $actions: [Documents_DocumentBuilderActionInput!]!){create_document(input:$input, actions:$actions){id}}`,
    { input: { document_type_id: OFFER_TYPE, project_match_id: projectMatchId }, actions });
  const after = await listOfferDraftIds(gql, projectMatchId);
  const fresh = after.filter((id) => !before.includes(id));
  if (fresh.length !== 1) {
    throw new Error(`Neuer Entwurf nicht eindeutig (${fresh.length} neue Entwürfe${fresh.length ? `: ${fresh.join(", ")}` : ""}) – bitte in HERO prüfen`);
  }
  return { documentId: fresh[0], returnedId: Number(res?.create_document?.id) };
}

async function logOffer(sb: any, row: Record<string, unknown>) {
  try { await sb.from("hero_offer_log").insert(row); } catch { /* Protokoll darf nichts verdecken */ }
}

export interface OfferOptions {
  projectGuard?: (project: any) => void;
  logCommand?: string;
}

/** Mengen der Katalogleistungen im angelegten Entwurf setzen (quantity_overrides), dann recalc. */
async function applyOverrides(ctx: Ctx, docId: number, ordered: Built[]) {
  const wanted = ordered.map((s, i) => ({ s, i })).filter((x) => x.s.linked && Object.keys(x.s.overrides).length > 0);
  const draft = await loadDraft(ctx.apiKey, docId);
  const services: any[] = (draft.data?.items ?? []).filter((t: any) => t.type === "table").flatMap((t: any) => t.items ?? []).filter((x: any) => x.atType === "SupplyService");
  if (services.length !== ordered.length) throw new Error(`Entwurf enthält ${services.length} Leistungen, erwartet ${ordered.length} – Mengen nicht gesetzt`);
  let n = 0;
  for (const { s, i } of wanted) {
    const svc = services[i];
    for (const [pid, q] of Object.entries(s.overrides)) {
      const pos = (svc.positions ?? []).find((p: any) => String(p.id) === String(pid));
      if (!pos) throw new Error(`Position ${pid} fehlt in Leistung ${s.name}`);
      const cmd = pos.atType === "WageGroup"
        ? { cmd: "set_wage_minutes" as const, position_uid: String(svc.uid), wage_group_id: pid, minutes: q }
        : { cmd: "set_material" as const, position_uid: String(svc.uid), product_id: pid, quantity: q };
      await runCommand(ctx, docId, cmd, false);
      n++;
    }
  }
  return n;
}

/** create_offer: Vorschau (dry_run, Standard) oder echtes Anlegen als Entwurf. */
export async function createOffer(ctx: Ctx, gql: Gql, p: any, opts: OfferOptions = {}) {
  const project = await findProject(gql, p.project_nr);
  const inputs = serviceInputs(p);
  const withTitles = p.titles !== false;
  const built: Built[] = [];
  for (let i = 0; i < inputs.length; i++) built.push(await buildService(gql, inputs[i], i));
  const ordered = orderBySection(built, withTitles);
  const actions = buildActions(ordered, withTitles);
  const preview = {
    project: { id: project.id, project_nr: project.project_nr, name: project.name, kunde: project.customer?.company_name || project.customer?.full_name, status: project.current_project_match_status?.step?.name },
    titles: withTitles ? [...SECTIONS] : [],
    services: ordered.map((s) => ({ section: s.section, linked: s.linked, catalog_service_id: s.catalog_service_id ?? null, name: s.name, quantity: s.quantity, positions: s.positions })),
  };
  if (p.dry_run !== false) return { dry_run: true, wrote: false, ...preview };

  opts.projectGuard?.(project);
  const log = (ok: boolean, documentId: number | null, result: Record<string, unknown>) =>
    logOffer(ctx.supabase, { caller: ctx.caller, command: opts.logCommand ?? "create_offer", project_nr: project.project_nr, project_match_id: Number(project.id), document_id: documentId, ok, result });

  let created: { documentId: number; returnedId: number };
  try {
    created = await createDraft(gql, Number(project.id), actions);
  } catch (e) {
    await log(false, null, { error: msg(e), services: ordered.length });
    throw e;
  }
  const docId = created.documentId;

  const out: Record<string, unknown> = {};
  let recalc: any;
  try {
    out.overrides_applied = await applyOverrides(ctx, docId, ordered);
    const r = await runCommand(ctx, docId, { cmd: "recalc" }, false);
    recalc = r.after;
  } catch (e) {
    recalc = { error: msg(e) };
  }
  await log(true, docId, { services: ordered.length, linked: ordered.filter((s) => s.linked).length, titles: withTitles, recalc: recalc?.error ? { error: recalc.error } : recalc });
  return {
    dry_run: false, wrote: true, document_id: docId, url: `https://login.hero-software.de/partner/Documents/edit/${docId}`,
    ...preview, ...out, recalc, create_document_id: Number.isFinite(created.returnedId) ? created.returnedId : null,
  };
}

/**
 * Neue Katalogleistung im HERO-Katalog anlegen (Mutation create_supply_service). Silas-Entscheidung 26.11.: ohne Freigabe.
 * Schutz: Dublettenprüfung per Name (gleicher Name = vorhandene Leistung zurückgeben, nichts anlegen).
 * dry_run:true gibt nur die Vorschau zurück. Jedes Anlegen steht in hero_offer_log.
 */
export async function createCatalogService(ctx: Ctx, gql: Gql, p: any) {
  const name = typeof p.name === "string" ? p.name.trim() : "";
  if (name.length < 3) throw new Error("name fehlt (mind. 3 Zeichen)");
  const products = (p.products ?? []).map((x: any) => ({ id: String(x.id), quantity: Number(x.quantity) }));
  const wages = (p.wages ?? []).map((x: any) => ({ id: Number(x.id), quantity: Number(x.minutes) }));
  if (products.length + wages.length === 0) throw new Error("keine Positionen (products und/oder wages angeben)");
  if (products.some((x: any) => !x.id || x.id === "undefined")) throw new Error("Artikel-ID fehlt");
  if (wages.some((w: any) => !Number.isInteger(w.id))) throw new Error("Lohngruppen-ID ungültig");
  if ([...products.map((x: any) => x.quantity), ...wages.map((x: any) => x.quantity)].some((q: number) => !Number.isFinite(q) || q < 0)) throw new Error("Menge ungültig");

  const found = await gql(`query($s:String){supply_services(search:$s){id nr name unit_type}}`, { s: name });
  const same = (found.supply_services ?? []).find((x: any) => String(x.name).trim().toLowerCase() === name.toLowerCase());
  if (same) return { created: false, duplicate: true, wrote: false, service: same };

  const input: Record<string, unknown> = {
    name, unit_type: p.unit_type ?? "Stk", vat_percent: 19, description: p.description ?? "",
    product_positions: products, wage_positions: wages,
  };
  if (p.nr !== undefined) input.nr = String(p.nr);
  const preview = { name, unit_type: input.unit_type, products, wages_minutes: wages };
  if (p.dry_run === true) return { created: false, dry_run: true, wrote: false, ...preview };

  let id: number;
  try {
    const res = await gql(`mutation($s: Documents_SupplyServiceInput!){create_supply_service(supply_service:$s){id}}`, { s: input });
    id = Number(res?.create_supply_service?.id);
    if (!Number.isFinite(id)) throw new Error("HERO lieferte keine ID der neuen Leistung");
  } catch (e) {
    await logOffer(ctx.supabase, { caller: ctx.caller, command: "create_catalog_service", project_nr: null, project_match_id: null, document_id: null, ok: false, result: { error: msg(e), ...preview } });
    throw e;
  }
  await logOffer(ctx.supabase, { caller: ctx.caller, command: "create_catalog_service", project_nr: null, project_match_id: null, document_id: null, ok: true, result: { service_id: id, ...preview } });
  return { created: true, wrote: true, service_id: id, ...preview, hint: "Mit catalog_service_id=service_id in create_offer verwenden." };
}
