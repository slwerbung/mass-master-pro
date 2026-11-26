// Live-Test für hero-offer: legt Test-Entwürfe NUR im Testprojekt WER-1984 an und liest sie zurück.
// Die Entwürfe bleiben stehen (nichts wird gelöscht) und dienen auch als Referenz für die neuen Rechenfälle
// (mehrere Leistungen, Lohn-EK bei ungeraden Minuten, Menge > 1, Festpreis): in HERO öffnen/speichern, dann lesen und vergleichen.
import type { Step } from "../herocalc/contract.ts";
import { overview } from "../herocalc/overview.ts";
import { loadPage, type Ctx } from "../herocalc/service.ts";
import { createDraft, createOffer, findProject, type Gql } from "./offer.ts";

export const TEST_PROJECT_NR = "WER-1984";
export const TEST_PROJECT_MATCH_ID = 12886720;
const PRODUCT = "FVD77tFAAAA"; // Bannermaterial (Stammartikel 1010), VK 30 / EK 15 je m²
const WAGE = 6824; // Monteur, 22,40 / 72,00 EUR je Stunde
const TOTAL_KEYS = ["base", "net", "time", "wage", "wage_base", "material", "material_base", "sales", "byVat", "vat"];

const check = (name: string, ok: boolean, detail = ""): Step => ({ name, ok, detail });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const guard = (project: any) => {
  if (Number(project.id) !== TEST_PROJECT_MATCH_ID) throw new Error(`Projekt ${project.project_nr} ist nicht das Testprojekt WER-1984 – abgebrochen`);
};

export interface TestDraft { label: string; document_id: number; url: string }
const url = (id: number) => `https://login.hero-software.de/partner/Documents/edit/${id}`;

async function readBack(ctx: Ctx, docId: number) {
  const { draft, document } = await loadPage(ctx.apiKey, docId);
  const services = draft.data.items.filter((t: any) => t.type === "table").flatMap((t: any) => t.items ?? []);
  return { draft, document, services };
}

const tableTotalsDiff = (draft: any) => {
  const tables = draft.data.items.filter((t: any) => t.type === "table");
  return tables.length === 1 ? TOTAL_KEYS.filter((k) => JSON.stringify(tables[0].totals?.[k]) !== JSON.stringify(draft.data.totals[k])) : ["(mehrere Tabellen)"];
};

export async function runOfferTest(ctx: Ctx, gql: Gql): Promise<{ steps: Step[]; drafts: TestDraft[] }> {
  const steps: Step[] = [];
  const drafts: TestDraft[] = [];
  const opts = { projectGuard: guard, logCommand: "test" };
  const base = { project_nr: TEST_PROJECT_NR, dry_run: false };
  const banner = (extra: Record<string, unknown> = {}) => ({ products: [{ id: PRODUCT, quantity: 2 }], wages: [{ id: WAGE, minutes: 90 }], ...extra });

  // 1) eine Leistung (Einzelformat von früher bleibt gültig, hier mit services)
  try {
    const descr = "Beschreibungstest äöü – erste Zeile";
    const a: any = await createOffer(ctx, gql, { ...base, services: [banner({ name: "API-Test hero-offer 1 Leistung", description: descr })] }, opts);
    drafts.push({ label: "1 Leistung", document_id: a.document_id, url: a.url });
    steps.push(check("1 Leistung: Entwurf angelegt", Number.isFinite(a.document_id), `Dokument ${a.document_id}`));
    const r = a.recalc ?? {};
    steps.push(check("1 Leistung: recalc = EK 63,60 / Netto 168 / MwSt 31,92 / Brutto 199,92",
      r.ek === 63.6 && r.netto === 168 && r.mwst === 31.92 && r.brutto === 199.92, JSON.stringify(r)));
    const { draft, document, services } = await readBack(ctx, a.document_id);
    steps.push(check("1 Leistung: Testprojekt und Entwurf", Number(document?.project_match_id) === TEST_PROJECT_MATCH_ID && draft.status_code === 0));
    steps.push(check("1 Leistung: Beschreibung kommt im Dokument an", String(services[0]?.description ?? "").includes("Beschreibungstest"), `Feld: ${JSON.stringify(services[0]?.description)}`));
    const diff = tableTotalsDiff(draft);
    steps.push(check("1 Leistung: table.totals == data.totals", diff.length === 0, diff.join(", ")));
  } catch (e) { steps.push(check("1 Leistung", false, msg(e))); }

  // 2) zwei Leistungen: recalc wird übersprungen und das gemeldet
  try {
    const b: any = await createOffer(ctx, gql, { ...base, services: [
      banner({ name: "API-Test hero-offer 2 Leistungen A" }),
      { name: "API-Test hero-offer 2 Leistungen B", products: [{ id: PRODUCT, quantity: 1.5 }], wages: [{ id: WAGE, minutes: 50 }] },
    ] }, opts);
    drafts.push({ label: "2 Leistungen", document_id: b.document_id, url: b.url });
    steps.push(check("2 Leistungen: Entwurf angelegt", Number.isFinite(b.document_id), `Dokument ${b.document_id}`));
    steps.push(check("2 Leistungen: recalc_skipped mit Grund gemeldet", b.recalc_skipped === true && /Mehrere Leistungen/.test(String(b.recalc_skip_reason ?? ""))));
    const { draft, services } = await readBack(ctx, b.document_id);
    steps.push(check("2 Leistungen: beide Leistungen in Reihenfolge", services.map((s: any) => s.name).join(" | ") === "API-Test hero-offer 2 Leistungen A | API-Test hero-offer 2 Leistungen B",
      services.map((s: any) => s.name).join(" | ")));
    steps.push(check("2 Leistungen: uid je Leistung eindeutig, je 2 Positionen",
      new Set(services.map((s: any) => s.uid)).size === 2 && services.every((s: any) => s.positions?.length === 2),
      services.map((s: any) => `${s.uid}:${s.positions?.length}`).join(", ")));
    const t = draft.data.totals;
    steps.push(check("2 Leistungen: von HERO gespeicherte Summen (nur Info, ungerechnet)", true,
      `Tabellen ${draft.data.items.filter((x: any) => x.type === "table").length}, net ${t.net}, base ${t.base}, time ${t.time}`));
  } catch (e) { steps.push(check("2 Leistungen", false, msg(e))); }

  // 3) Referenzentwürfe für die neuen Rechenfälle (nur Info; Vergleich erst nach dem Öffnen in HERO)
  const ours = async (label: string, services: any[]) => {
    try {
      const c: any = await createOffer(ctx, gql, { ...base, services }, opts);
      drafts.push({ label, document_id: c.document_id, url: c.url });
      steps.push(check(`${label}: angelegt (Referenz)`, Number.isFinite(c.document_id), `Dokument ${c.document_id}, hero-calc: ${JSON.stringify(c.recalc)}`));
    } catch (e) { steps.push(check(label, false, msg(e))); }
  };
  await ours("Lohn 50 min (ungerade Minuten)", [{ name: "API-Test Lohn 50 min", wages: [{ id: WAGE, minutes: 50 }] }]);
  await ours("Menge 2 (Rabatt bei Menge > 1 von Hand setzen)", [banner({ name: "API-Test Menge 2", quantity: 2 })]);

  // 4) Festpreis: nur roh angelegt, hero-calc rechnet das nicht (abgelehnt)
  try {
    const project = await findProject(gql, TEST_PROJECT_NR);
    guard(project);
    const fixed = { name: "API-Test Festpreis", unit_type: "Stk", vat_percent: 19, quantity: 1, description: "", is_fixed_net_price: true, net_price_per_unit: 100,
      productPositions: [{ id: PRODUCT, quantity: 2 }], wagePositions: [{ id: WAGE, timeMinutes: 90 }] };
    const { documentId } = await createDraft(gql, Number(project.id), [fixed]);
    try { await ctx.supabase.from("hero_offer_log").insert({ caller: ctx.caller, command: "test", project_nr: project.project_nr, project_match_id: Number(project.id), document_id: documentId, ok: true, result: { festpreis: true } }); } catch { /* egal */ }
    drafts.push({ label: "Festpreis", document_id: documentId, url: url(documentId) });
    const { draft, services } = await readBack(ctx, documentId);
    const s = services[0] ?? {};
    steps.push(check("Festpreis: angelegt (Referenz)", true,
      `Dokument ${documentId}, is_fixed_net_price=${JSON.stringify(s.is_fixed_net_price)}, net_price_per_unit=${s.net_price_per_unit}, net=${draft.data.totals.net}, base=${draft.data.totals.base}`));
  } catch (e) { steps.push(check("Festpreis", false, msg(e))); }

  void overview;
  return { steps, drafts };
}
