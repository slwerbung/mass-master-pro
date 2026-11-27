import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildActions, buildService, createCatalogService, createOffer, MAX_SERVICES, OFFER_TYPE, orderBySection, serviceInputs, type Gql } from "./offer.ts";
import { createInvoiceDraft, INVOICE_TYPE } from "./invoice.ts";
import { DOC, FakeDb, FakeHero, mkDraft } from "../herocalc/testkit.ts";

/** Simuliertes HERO-GraphQL: Projekt, Katalogleistung, Entwürfe vor/nach create_document. */
function fakeGql(opts: { newDocs?: number[][]; offerStatus?: number; catalogHit?: boolean } = {}) {
  const calls: { query: string; variables: any }[] = [];
  let offers: number[] = [111, 222];
  let invoices: number[] = [];
  const plan = opts.newDocs ?? [[DOC]];
  let n = 0;
  const gql: Gql = async (query, variables: any = {}) => {
    calls.push({ query, variables });
    if (query.includes("project_matches(relative_id")) {
      return { project_matches: [{ id: "12886720", project_nr: "WER-1984", name: "Fenster test", customer: { company_name: "Test" }, current_project_match_status: { step: { name: "Neu" } } }] };
    }
    if (query.includes("supply_services(service_ids")) {
      return { supply_services: [{ id: 5, nr: "K1", name: "Banner", unit_type: "Stk", positions: [
        { __typename: "Documents_SupplyProduct", id: "p1", name: "Folie", quantity: 2 }, { __typename: "WageGroup", id: 6824, name: "Montage", quantity: 90 },
      ] }] };
    }
    if (query.includes("supply_services(search")) return { supply_services: opts.catalogHit ? [{ id: 9, nr: "K9", name: "Banner neu", unit_type: "Stk" }] : [] };
    if (query.includes("create_supply_service(supply_service")) return { create_supply_service: { id: 4711 } };
    if (query.includes("create_document")) {
      if (variables.input?.document_type_id === INVOICE_TYPE) { invoices = [...invoices, 777]; return { create_document: { id: 777 } }; }
      offers = [...offers, ...(plan[n++] ?? [])];
      return { create_document: { id: 99999 } };
    }
    if (query.includes("customer_documents")) {
      return { project_matches: [{ customer_documents: [
        ...offers.map((id) => ({ id, nr: `AN-${id}`, status_code: 0, status_name: "Entwurf", document_type: { base_type: "offer" } })),
        { id: 5, nr: "AN-5", status_code: opts.offerStatus ?? 1, status_name: "Abgeschlossen", document_type: { base_type: "offer" } },
        ...invoices.map((id) => ({ id, nr: `RE-${id}`, status_code: 0, status_name: "Entwurf", document_type: { base_type: "invoice" } })),
      ] }] };
    }
    throw new Error("unerwartete Abfrage");
  };
  return { gql, calls, creates: () => calls.filter((c) => c.query.includes("create_document")) };
}

class LogQ {
  constructor(private rows: any[]) {}
  insert(row: any) { this.rows.push(row); return Promise.resolve({ error: null }); }
}

let hero: FakeHero, db: FakeDb, logRows: any[], ctx: any;
beforeEach(() => {
  hero = new FakeHero(mkDraft());
  db = new FakeDb();
  logRows = [];
  ctx = { supabase: { rpc: db.rpc, from: (t: string) => (t === "hero_offer_log" ? new LogQ(logRows) : db.from(t)) }, apiKey: "KEY", caller: "employee:42" };
  vi.stubGlobal("fetch", hero.fetch);
});
afterEach(() => vi.unstubAllGlobals());

const catalog = { project_nr: "WER-1984", services: [{ catalog_service_id: 5, quantity: 1 }] };

describe("Eingabe", () => {
  it("Einzelformat bleibt gültig, services hat Vorrang und wird geprüft", () => {
    expect(serviceInputs({ project_nr: "WER-1", catalog_service_id: 5 })).toHaveLength(1);
    expect(serviceInputs({ services: [{}, {}] })).toHaveLength(2);
    expect(() => serviceInputs({ services: [] })).toThrow(/nicht leere Liste/);
    expect(() => serviceInputs({ services: Array.from({ length: MAX_SERVICES + 1 }, () => ({})) })).toThrow(/Höchstens/);
  });
  it("freie Leistung nur mit allow_unlinked, Fehler nennen die Nummer", async () => {
    const { gql } = fakeGql();
    await expect(buildService(gql, { name: "a", products: [{ id: "x", quantity: 1 }] }, 1)).rejects.toThrow(/Leistung 2: Freie Leistung ohne Katalogverknüpfung/);
    const free = { allow_unlinked: true };
    await expect(buildService(gql, { ...free, products: [{ id: "x", quantity: 1 }] }, 1)).rejects.toThrow(/Leistung 2: name fehlt/);
    await expect(buildService(gql, { ...free, name: "a" }, 0)).rejects.toThrow(/keine Positionen/);
    await expect(buildService(gql, { ...free, name: "a", products: [{ id: "x", quantity: -1 }] }, 0)).rejects.toThrow(/Menge ungültig/);
    await expect(buildService(gql, { ...free, name: "a", quantity: 0, products: [{ id: "x", quantity: 1 }] }, 0)).rejects.toThrow(/quantity/);
    await expect(buildService(gql, { name: "a", section: "LAGER", catalog_service_id: 5 }, 0)).rejects.toThrow(/section muss/);
    const s = await buildService(gql, { ...free, name: "a", quantity: 3, description: "Text", products: [{ id: "x", quantity: 1 }] }, 0);
    expect([s.linked, s.quantity, s.payload.description, s.payload.vat_percent]).toEqual([false, 3, "Text", 19]);
  });
  it("Katalogleistung verknüpft, Mengenüberschreibung wird gegen die Positionen geprüft", async () => {
    const { gql } = fakeGql();
    const s = await buildService(gql, { catalog_service_id: 5, quantity_overrides: { p1: 4, "6824": 60 } }, 0);
    expect([s.linked, s.catalog_service_id, s.name]).toEqual([true, 5, "Banner"]);
    expect(s.positions!.map((x) => [x.id, x.kind, x.quantity])).toEqual([["p1", "Material", 4], ["6824", "Lohn(min)", 60]]);
    await expect(buildService(gql, { catalog_service_id: 5, quantity_overrides: { zzz: 1 } }, 0)).rejects.toThrow(/gehört nicht zur Leistung/);
    await expect(buildService(gql, { catalog_service_id: 5, quantity_overrides: { p1: -1 } }, 0)).rejects.toThrow(/Menge ungültig/);
  });
  it("Titel PROJEKTIERUNG/PRODUKTION/MONTAGE: Reihenfolge je Abschnitt, titles:false ohne Titel", async () => {
    const { gql } = fakeGql();
    const mk = (section: string) => buildService(gql, { catalog_service_id: 5, section }, 0);
    const built = [await mk("MONTAGE"), await mk("PRODUKTION")];
    const ord = orderBySection(built, true);
    expect(ord.map((s) => s.section)).toEqual(["PRODUKTION", "MONTAGE"]);
    const keys = buildActions(ord, true).map((a) => Object.keys(a)[0]);
    expect(keys).toEqual(["add_title", "add_title", "add_existing_service", "add_title", "add_existing_service"]);
    expect(buildActions(built, false).map((a) => Object.keys(a)[0])).toEqual(["add_existing_service", "add_existing_service"]);
  });
});

describe("createOffer", () => {
  it("dry_run ist Standard: schreibt nichts, kein Protokoll", async () => {
    const g = fakeGql();
    const r: any = await createOffer(ctx, g.gql, catalog);
    expect([r.dry_run, r.wrote, r.services.length, r.titles]).toEqual([true, false, 1, ["PROJEKTIERUNG", "PRODUKTION", "MONTAGE"]]);
    expect([g.creates().length, logRows.length, hero.saves]).toEqual([0, 0, 0]);
  });

  it("Katalogleistung: verknüpft, Angebotstyp 171300, Mengen gesetzt, recalc, Protokoll mit Aufrufer", async () => {
    const g = fakeGql();
    const r: any = await createOffer(ctx, g.gql, { project_nr: "WER-1984", dry_run: false, services: [{ catalog_service_id: 5, quantity_overrides: { p1: 4 } }] });
    expect([r.wrote, r.document_id, r.create_document_id, r.overrides_applied]).toEqual([true, DOC, 99999, 1]);
    expect(r.url).toBe(`https://login.hero-software.de/partner/Documents/edit/${DOC}`);
    const c = g.creates()[0].variables;
    expect(c.input).toEqual({ document_type_id: OFFER_TYPE, project_match_id: 12886720 });
    expect(c.actions.find((a: any) => a.add_existing_service).add_existing_service).toEqual({ supplyServiceId: 5, quantity: 1 });
    expect(r.recalc.vk).toBe(228); // Material 4 x 30 + Lohn 90 min x 72/h
    expect(hero.saves).toBe(2); // set_material + recalc, je mit Undo-Sicherung
    expect(db.undo.map((u) => u.command)).toEqual(["set_material", "recalc"]);
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({ caller: "employee:42", command: "create_offer", project_nr: "WER-1984", project_match_id: 12886720, document_id: DOC, ok: true });
    expect(logRows[0].result).toMatchObject({ services: 1, linked: 1, titles: true });
  });

  it("mehrere Katalogleistungen: je Leistung eine add_existing_service-Action in Abschnittsreihenfolge", async () => {
    const g = fakeGql();
    hero.draft.data.items[0].items.push(structuredClone(hero.draft.data.items[0].items[0]));
    hero.draft.data.items[0].items[1].uid = "u2";
    const r: any = await createOffer(ctx, g.gql, { project_nr: "WER-1984", dry_run: false, titles: false, services: [
      { catalog_service_id: 5, quantity: 2 }, { catalog_service_id: 5, quantity: 1 },
    ] });
    const actions = g.creates()[0].variables.actions;
    expect(actions.map((a: any) => a.add_existing_service.quantity)).toEqual([2, 1]);
    expect(r.services).toHaveLength(2);
    expect(r.recalc.error).toBeUndefined();
  });

  it("Neuer Entwurf nicht eindeutig (zwei oder keiner): Abbruch mit Meldung, Protokoll ok=false", async () => {
    await expect(createOffer(ctx, fakeGql({ newDocs: [[301, 302]] }).gql, { ...catalog, dry_run: false })).rejects.toThrow(/nicht eindeutig \(2 neue Entwürfe: 301, 302\)/);
    await expect(createOffer(ctx, fakeGql({ newDocs: [[]] }).gql, { ...catalog, dry_run: false })).rejects.toThrow(/nicht eindeutig \(0 neue Entwürfe\)/);
    expect(logRows.map((l) => l.ok)).toEqual([false, false]);
    expect(logRows[0].document_id).toBeNull();
    expect(logRows[0].result.error).toMatch(/nicht eindeutig/);
  });

  it("projectGuard gilt nur beim Schreiben", async () => {
    const guard = () => { throw new Error("falsches Projekt"); };
    const g = fakeGql();
    await expect(createOffer(ctx, g.gql, { ...catalog, dry_run: false }, { projectGuard: guard })).rejects.toThrow(/falsches Projekt/);
    expect(g.creates().length).toBe(0);
    expect(((await createOffer(ctx, g.gql, catalog, { projectGuard: guard })) as any).dry_run).toBe(true);
  });

  it("recalc-Fehler verdeckt das Anlegen nicht", async () => {
    const g = fakeGql();
    hero.draft.status_code = 1; // recalc lehnt Nicht-Entwürfe ab
    const r: any = await createOffer(ctx, g.gql, { ...catalog, dry_run: false });
    expect([r.wrote, r.document_id]).toEqual([true, DOC]);
    expect(r.recalc.error).toMatch(/Kein Entwurf/);
  });
});

describe("createCatalogService", () => {
  const input = { name: "Banner neu", products: [{ id: "p1", quantity: 2 }], wages: [{ id: 6824, minutes: 30 }] };
  it("Dublette per Name: nichts anlegen", async () => {
    const g = fakeGql({ catalogHit: true });
    const r: any = await createCatalogService(ctx, g.gql, input);
    expect([r.created, r.duplicate, r.wrote]).toEqual([false, true, false]);
    expect(g.calls.some((c) => c.query.includes("create_supply_service"))).toBe(false);
  });
  it("dry_run:true zeigt nur die Vorschau", async () => {
    const g = fakeGql();
    const r: any = await createCatalogService(ctx, g.gql, { ...input, dry_run: true });
    expect([r.dry_run, r.wrote]).toEqual([true, false]);
    expect(logRows).toHaveLength(0);
  });
  it("legt an und protokolliert; Eingaben werden geprüft", async () => {
    const g = fakeGql();
    const r: any = await createCatalogService(ctx, g.gql, input);
    expect([r.created, r.service_id]).toEqual([true, 4711]);
    expect(logRows[0]).toMatchObject({ caller: "employee:42", command: "create_catalog_service", ok: true });
    await expect(createCatalogService(ctx, g.gql, { ...input, name: "x" })).rejects.toThrow(/name fehlt/);
    await expect(createCatalogService(ctx, g.gql, { name: "Banner neu" })).rejects.toThrow(/keine Positionen/);
    await expect(createCatalogService(ctx, g.gql, { ...input, wages: [{ id: 1.5, minutes: 1 }] })).rejects.toThrow(/Lohngruppen-ID/);
  });
});

describe("createInvoiceDraft", () => {
  const inv = { project_nr: "WER-1984", offer_document_id: 5 };
  // Dokument 5 ist das abgeschlossene Angebot; die Edit-Seite des Fake-HERO liefert den Entwurf DOC. Für das Lesen des Angebots
  // muss die Dokument-ID passen: wir geben dem Test-Angebot deshalb die ID DOC.
  const gqlWithOffer = (status = 1) => {
    const g = fakeGql();
    const base = g.gql;
    const gql: Gql = async (q, v) => {
      const d: any = await base(q, v);
      if (q.includes("customer_documents")) {
        d.project_matches[0].customer_documents = d.project_matches[0].customer_documents.map((x: any) => (x.id === 5 ? { ...x, id: DOC, status_code: status } : x));
      }
      return d;
    };
    return { ...g, gql };
  };
  const ok = { ...inv, offer_document_id: DOC };

  it("dry_run ist Standard: zeigt Leistungen und Netto des Angebots, schreibt nichts", async () => {
    const g = gqlWithOffer();
    const r: any = await createInvoiceDraft(ctx, g.gql, ok);
    expect([r.dry_run, r.wrote, r.complete, r.services.map((s: any) => s.uid)]).toEqual([true, false, true, ["u1"]]);
    expect(r.offer.netto).toBe(168);
    expect(g.creates().length).toBe(0);
    expect(logRows).toHaveLength(0);
  });
  it("Angebot im Entwurfsstatus, falsches Projekt, kein Angebot, unbekannte service_uids werden abgelehnt", async () => {
    await expect(createInvoiceDraft(ctx, gqlWithOffer(0).gql, ok)).rejects.toThrow(/noch ein Entwurf/);
    await expect(createInvoiceDraft(ctx, gqlWithOffer().gql, { ...inv, offer_document_id: 31337 })).rejects.toThrow(/gehört nicht zu Projekt/);
    await expect(createInvoiceDraft(ctx, gqlWithOffer().gql, { ...inv, offer_document_id: "x" })).rejects.toThrow(/offer_document_id fehlt/);
    await expect(createInvoiceDraft(ctx, gqlWithOffer().gql, { ...ok, service_uids: ["nope"] })).rejects.toThrow(/service_uids nicht im Angebot: nope/);
    await expect(createInvoiceDraft(ctx, gqlWithOffer().gql, { ...ok, service_uids: [] })).rejects.toThrow(/nicht leere Liste/);
  });
  it("schreiben: Rechnungstyp 171302, add_positions_from_document mit uids, ein neuer Entwurf, Protokoll", async () => {
    const g = gqlWithOffer();
    const r: any = await createInvoiceDraft(ctx, g.gql, { ...ok, dry_run: false });
    expect([r.wrote, r.document_id]).toEqual([true, 777]);
    const c = g.creates()[0].variables;
    expect(c.input).toEqual({ document_type_id: INVOICE_TYPE, project_match_id: 12886720 });
    expect(c.actions).toEqual([{ add_positions_from_document: { documentId: DOC, selectedPositions: ["u1"] } }]);
    expect(logRows[0]).toMatchObject({ command: "create_invoice_draft", document_id: 777, ok: true });
    expect(hero.saves).toBe(0); // Rechnung wird nur gelesen
  });
});
