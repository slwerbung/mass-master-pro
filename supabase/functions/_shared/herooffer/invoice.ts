// hero-offer: Rechnungs-ENTWURF (171302) aus einem ABGESCHLOSSENEN Angebot anlegen (GraphQL create_document + add_positions_from_document).
// Live belegt 27.11.2026 (WER-1984, Angebot 22637283 mit Rabatt und eigenem Preis): aus einem Angebot im Entwurfsstatus lehnt HERO mit "Internal server error" ab,
// aus dem abgeschlossenen Angebot entsteht der Entwurf mit identischen Summen (Netto 663,06, MwSt 125,98). selectedPositions = uids der Leistungen des Angebots.
// Alle Leistungen = Schlussrechnung; service_uids = Teil-/Abschlagsrechnung. Nie abschließen, nie versenden, kein `publish`.
import { loadPage, type Ctx } from "../herocalc/service.ts";
import { findProject, type Gql } from "./offer.ts";

export const INVOICE_TYPE = 171302;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function logInvoice(sb: any, row: Record<string, unknown>) {
  try { await sb.from("hero_offer_log").insert(row); } catch { /* Protokoll darf nichts verdecken */ }
}

async function projectDocs(gql: Gql, projectMatchId: number): Promise<any[]> {
  const d = await gql(`query($i:[Int]){project_matches(ids:$i){customer_documents{id nr status_code status_name document_type{base_type}}}}`, { i: [projectMatchId] });
  return d.project_matches?.[0]?.customer_documents ?? [];
}

const invoiceDraftIds = (docs: any[]): number[] =>
  docs.filter((x) => x.document_type?.base_type === "invoice" && x.status_code === 0).map((x) => Number(x.id));

const servicesOf = (draft: any): any[] =>
  (draft?.data?.items ?? []).filter((t: any) => t.type === "table").flatMap((t: any) => t.items ?? []).filter((s: any) => s.type !== "title" && s.type !== "text");

/**
 * create_invoice_draft { project_nr, offer_document_id, service_uids?, dry_run? }
 * dry_run (Standard) zeigt nur, welche Leistungen übernommen würden und den Netto-Betrag des Angebots.
 */
export async function createInvoiceDraft(ctx: Ctx, gql: Gql, p: any) {
  const project = await findProject(gql, p.project_nr);
  const offerId = Number(p.offer_document_id);
  if (!Number.isInteger(offerId) || offerId <= 0) throw new Error("offer_document_id fehlt (Dokument-ID des Angebots, aus der HERO-URL)");
  const docs = await projectDocs(gql, Number(project.id));
  const offer = docs.find((x) => Number(x.id) === offerId);
  if (!offer) throw new Error(`Dokument ${offerId} gehört nicht zu Projekt ${project.project_nr}`);
  if (offer.document_type?.base_type !== "offer") throw new Error(`Dokument ${offerId} ist kein Angebot`);
  if (offer.status_code === 0) throw new Error("Das Angebot ist noch ein Entwurf. Rechnung geht erst aus einem abgeschlossenen Angebot: Angebot in HERO abschließen (nicht versenden), dann erneut.");

  const { draft: offerDraft } = await loadPage(ctx.apiKey, offerId);
  const all = servicesOf(offerDraft);
  if (all.length === 0) throw new Error("Das Angebot enthält keine Leistungen");
  let chosen = all;
  if (p.service_uids !== undefined) {
    if (!Array.isArray(p.service_uids) || p.service_uids.length === 0) throw new Error("service_uids muss eine nicht leere Liste sein");
    const want = p.service_uids.map(String);
    const have = new Set(all.map((s: any) => String(s.uid)));
    const unknown = want.filter((u: string) => !have.has(u));
    if (unknown.length) throw new Error(`service_uids nicht im Angebot: ${unknown.join(", ")}. Vorhanden: ${all.map((s: any) => `${s.uid} (${s.name})`).join(" | ")}`);
    chosen = all.filter((s: any) => want.includes(String(s.uid)));
  }
  const offerNet = Number(offerDraft?.data?.totals?.net ?? offerDraft?.data?.total_price);
  const preview = {
    project: { id: project.id, project_nr: project.project_nr, name: project.name },
    offer: { document_id: offerId, nr: offer.nr, status: offer.status_name, netto: offerNet },
    complete: chosen.length === all.length,
    services: chosen.map((s: any) => ({ uid: String(s.uid), name: s.name, quantity: s.quantity, sales: s.sales ?? 0, netto: s.net_price_per_unit })),
  };
  if (p.dry_run !== false) return { dry_run: true, wrote: false, ...preview };

  const before = invoiceDraftIds(docs);
  const log = (ok: boolean, documentId: number | null, result: Record<string, unknown>) =>
    logInvoice(ctx.supabase, { caller: ctx.caller, command: "create_invoice_draft", project_nr: project.project_nr, project_match_id: Number(project.id), document_id: documentId, ok, result });
  let docId: number;
  try {
    await gql(`mutation($input: Documents_CreateDocumentInput!, $actions: [Documents_DocumentBuilderActionInput!]!){create_document(input:$input, actions:$actions){id}}`,
      { input: { document_type_id: INVOICE_TYPE, project_match_id: Number(project.id) }, actions: [{ add_positions_from_document: { documentId: offerId, selectedPositions: chosen.map((s: any) => String(s.uid)) } }] });
    const fresh = invoiceDraftIds(await projectDocs(gql, Number(project.id))).filter((id) => !before.includes(id));
    if (fresh.length !== 1) throw new Error(`Neuer Rechnungsentwurf nicht eindeutig (${fresh.length} neue Entwürfe${fresh.length ? `: ${fresh.join(", ")}` : ""}) – bitte in HERO prüfen`);
    docId = fresh[0];
  } catch (e) {
    await log(false, null, { error: msg(e), offer_document_id: offerId });
    throw e;
  }

  // Kontrolle: Summen des Rechnungsentwurfs lesen (nur lesen) und mit dem Angebot vergleichen (bei Teilrechnung nur Info).
  let check: Record<string, unknown>;
  try {
    const { draft } = await loadPage(ctx.apiKey, docId);
    const net = Number(draft?.data?.totals?.net ?? draft?.data?.total_price);
    const vat = Number(draft?.data?.total_vat);
    check = { netto: net, mwst: vat, brutto: Math.round((net + vat) * 100) / 100, services: servicesOf(draft).length, equals_offer: preview.complete ? Math.abs(net - offerNet) < 0.005 : null };
  } catch (e) {
    check = { error: msg(e) };
  }
  await log(true, docId, { offer_document_id: offerId, services: chosen.length, check });
  return { dry_run: false, wrote: true, document_id: docId, url: `https://login.hero-software.de/partner/Documents/edit/${docId}`, ...preview, check };
}
