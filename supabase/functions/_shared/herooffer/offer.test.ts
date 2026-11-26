import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOffer, serviceInputs, buildService, MAX_SERVICES, OFFER_TYPE, type Gql } from "./offer.ts";
import { DOC, FakeDb, FakeHero, mkDraft } from "../herocalc/testkit.ts";

/** Simuliertes HERO-GraphQL: Projekt, Katalogleistung, Entwürfe vor/nach create_document. */
function fakeGql(opts: { newDocs?: number[][] } = {}) {
  const calls: { query: string; variables: any }[] = [];
  let drafts: number[] = [111, 222];           // bestehende Entwürfe im Projekt
  const plan = opts.newDocs ?? [[DOC]];         // je create_document: welche neuen Dokument-IDs entstehen
  let n = 0;
  const gql: Gql = async (query, variables: any = {}) => {
    calls.push({ query, variables });
    if (query.includes("project_matches(relative_id")) {
      return { project_matches: [{ id: "12886720", project_nr: "WER-1984", name: "Fenster test", customer: { company_name: "Test" }, current_project_match_status: { step: { name: "Neu" } } }] };
    }
    if (query.includes("supply_services(service_ids")) {
      return { supply_services: [{ id: 5, nr: "K1", name: "Banner", unit_type: "Stk", positions: [
        { __typename: "Documents_SupplyProduct", id: "FVD77tFAAAA", quantity: 2 }, { __typename: "WageGroup", id: 6824, quantity: 90 },
      ] }] };
    }
    if (query.includes("create_document")) { drafts = [...drafts, ...(plan[n++] ?? [])]; return { create_document: { id: 99999 } }; }
    if (query.includes("customer_documents")) {
      return { project_matches: [{ customer_documents: [...drafts.map((id) => ({ id, status_code: 0, document_type: { base_type: "offer" } })), { id: 5, status_code: 1, document_type: { base_type: "offer" } }] }] };
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

const single = { project_nr: "WER-1984", name: "Banner", products: [{ id: "FVD77tFAAAA", quantity: 2 }], wages: [{ id: 6824, minutes: 90 }] };

describe("Eingabe", () => {
  it("Einzelformat bleibt gültig, services hat Vorrang und wird geprüft", () => {
    expect(serviceInputs(single)).toHaveLength(1);
    expect(serviceInputs({ services: [{}, {}] })).toHaveLength(2);
    expect(() => serviceInputs({ services: [] })).toThrow(/nicht leere Liste/);
    expect(() => serviceInputs({ services: Array.from({ length: MAX_SERVICES + 1 }, () => ({})) })).toThrow(/Höchstens/);
  });
  it("Leistung: Fehler nennen die Nummer, quantity und Mengen werden geprüft", async () => {
    const { gql } = fakeGql();
    await expect(buildService(gql, { products: [{ id: "x", quantity: 1 }] }, 1)).rejects.toThrow(/Leistung 2: name fehlt/);
    await expect(buildService(gql, { name: "a" }, 0)).rejects.toThrow(/keine Positionen/);
    await expect(buildService(gql, { name: "a", products: [{ id: "x", quantity: -1 }] }, 0)).rejects.toThrow(/Menge ungültig/);
    await expect(buildService(gql, { name: "a", quantity: 0, products: [{ id: "x", quantity: 1 }] }, 0)).rejects.toThrow(/quantity/);
    const s = await buildService(gql, { name: "a", quantity: 3, description: "Text", products: [{ id: "x", quantity: 1 }] }, 0);
    expect([s.quantity, s.description, s.vat_percent]).toEqual([3, "Text", 19]);
  });
  it("Katalogleistung mit Mengenüberschreibung", async () => {
    const { gql } = fakeGql();
    const s = await buildService(gql, { catalog_service_id: 5, quantity_overrides: { "FVD77tFAAAA": 4, "6824": 60 } }, 0);
    expect(s.productPositions).toEqual([{ id: "FVD77tFAAAA", quantity: 4 }]);
    expect(s.wagePositions).toEqual([{ id: 6824, timeMinutes: 60 }]);
    expect([s.name, s.nr]).toEqual(["Banner", "K1"]);
  });
});

describe("createOffer", () => {
  it("dry_run ist Standard: schreibt nichts, meldet ob recalc übersprungen würde", async () => {
    const g = fakeGql();
    const one: any = await createOffer(ctx, g.gql, single);
    expect([one.dry_run, one.wrote, one.recalc_will_be_skipped, one.services.length]).toEqual([true, false, false, 1]);
    const two: any = await createOffer(ctx, g.gql, { project_nr: "WER-1984", services: [single, single].map((s) => ({ name: s.name, products: s.products })) });
    expect(two.recalc_will_be_skipped).toBe(false); // mehrere Leistungen sind freigegeben (SUPPORT)
    expect([g.creates().length, logRows.length]).toEqual([0, 0]);
  });

  it("eine Leistung: Dokument-ID per Vorher/Nachher, Angebotstyp 171300, recalc läuft, Protokoll mit Aufrufer", async () => {
    const g = fakeGql();
    const r: any = await createOffer(ctx, g.gql, { ...single, dry_run: false });
    expect([r.wrote, r.document_id, r.recalc_skipped, r.create_document_id]).toEqual([true, DOC, false, 99999]);
    expect(r.recalc.vk).toBe(168);
    expect(r.url).toBe(`https://login.hero-software.de/partner/Documents/edit/${DOC}`);
    const c = g.creates()[0].variables;
    expect(c.input).toEqual({ document_type_id: OFFER_TYPE, project_match_id: 12886720 });
    expect(c.actions).toHaveLength(1);
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({ caller: "employee:42", project_nr: "WER-1984", document_id: DOC });
    expect(JSON.parse(logRows[0].result)).toMatchObject({ command: "create_offer", ok: true, project_match_id: 12886720 });
    expect(hero.saves).toBe(1); // recalc schreibt (mit Undo-Sicherung), auch wenn sich nichts ändert
    expect(db.undo[0].command).toBe("recalc");
  });

  it("mehrere Leistungen: eine create_supply_service-Action je Leistung in Reihenfolge, recalc läuft (freigegeben)", async () => {
    const g = fakeGql();
    const r: any = await createOffer(ctx, g.gql, { project_nr: "WER-1984", dry_run: false, services: [
      { name: "A", quantity: 2, products: [{ id: "p1", quantity: 1 }] }, { name: "B", wages: [{ id: 6824, minutes: 50 }] },
    ] });
    const actions = g.creates()[0].variables.actions;
    expect(actions.map((a: any) => a.create_supply_service.name)).toEqual(["A", "B"]);
    expect(actions[0].create_supply_service.quantity).toBe(2);
    expect(r.recalc_skipped).toBe(false);
    expect(r.recalc_skip_reason).toBeUndefined();
    expect(r.recalc.vk).toBe(168);
    expect(r.services).toHaveLength(2);
    expect(r.service).toBeUndefined();
    expect(hero.saves).toBe(1);
    expect(JSON.parse(logRows[0].result)).toMatchObject({ services: 2, recalc_skipped: false });
  });

  it("Neuer Entwurf nicht eindeutig (zwei oder keiner): Abbruch mit Meldung, Protokoll ok=false", async () => {
    await expect(createOffer(ctx, fakeGql({ newDocs: [[301, 302]] }).gql, { ...single, dry_run: false })).rejects.toThrow(/nicht eindeutig \(2 neue Entwürfe: 301, 302\)/);
    await expect(createOffer(ctx, fakeGql({ newDocs: [[]] }).gql, { ...single, dry_run: false })).rejects.toThrow(/nicht eindeutig \(0 neue Entwürfe\)/);
    expect(logRows.map((l) => JSON.parse(l.result).ok)).toEqual([false, false]);
    expect(logRows[0].document_id).toBeNull();
  });

  it("projectGuard gilt nur beim Schreiben", async () => {
    const guard = () => { throw new Error("falsches Projekt"); };
    const g = fakeGql();
    await expect(createOffer(ctx, g.gql, { ...single, dry_run: false }, { projectGuard: guard })).rejects.toThrow(/falsches Projekt/);
    expect(g.creates().length).toBe(0);
    expect(((await createOffer(ctx, g.gql, single, { projectGuard: guard })) as any).dry_run).toBe(true);
  });

  it("recalc-Fehler verdeckt das Anlegen nicht", async () => {
    const g = fakeGql();
    hero.draft.status_code = 1; // recalc lehnt Nicht-Entwürfe ab
    const r: any = await createOffer(ctx, g.gql, { ...single, dry_run: false });
    expect([r.wrote, r.document_id]).toEqual([true, DOC]);
    expect(r.recalc.error).toMatch(/Kein Entwurf/);
  });
});
