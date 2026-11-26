// Sicherheitsnetz: Ist SUPPORT.multipleServices wieder aus, legt hero-offer den Entwurf an, überspringt recalc und meldet das.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../herocalc/guard.ts", async (orig) => {
  const m: any = await orig();
  return { ...m, SUPPORT: { multipleServices: false, fixedPrice: false } };
});

import { createOffer, type Gql } from "./offer.ts";
import { DOC, FakeDb, FakeHero, mkDraft } from "../herocalc/testkit.ts";

const gql: Gql = async (query: string) => {
  if (query.includes("project_matches(relative_id")) return { project_matches: [{ id: "12886720", project_nr: "WER-1984", name: "t", customer: {}, current_project_match_status: null }] };
  if (query.includes("create_document")) { created = true; return { create_document: { id: 1 } }; }
  return { project_matches: [{ customer_documents: created ? [{ id: DOC, status_code: 0, document_type: { base_type: "offer" } }] : [] }] };
};
let created = false;
let hero: FakeHero;
beforeEach(() => { created = false; hero = new FakeHero(mkDraft()); vi.stubGlobal("fetch", hero.fetch); });
afterEach(() => vi.unstubAllGlobals());

describe("hero-offer mit gesperrtem multipleServices", () => {
  it("mehrere Leistungen: recalc übersprungen, Grund gemeldet, kein Zugriff auf HERO-Edit-Seite", async () => {
    const db = new FakeDb();
    const ctx: any = { supabase: { rpc: db.rpc, from: (t: string) => (t === "hero_offer_log" ? { insert: async () => ({ error: null }) } : db.from(t)) }, apiKey: "K", caller: "key:1" };
    const svc = (name: string) => ({ name, products: [{ id: "p", quantity: 1 }] });
    const dry: any = await createOffer(ctx, gql, { project_nr: "WER-1984", services: [svc("A"), svc("B")] });
    expect(dry.recalc_will_be_skipped).toBe(true);
    const r: any = await createOffer(ctx, gql, { project_nr: "WER-1984", dry_run: false, services: [svc("A"), svc("B")] });
    expect([r.recalc_skipped, r.recalc]).toEqual([true, { skipped: true }]);
    expect(r.recalc_skip_reason).toMatch(/Mehrere Leistungen/);
    expect(hero.gets).toBe(0);
  });
});
