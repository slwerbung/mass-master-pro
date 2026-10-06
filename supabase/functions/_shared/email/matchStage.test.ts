import { describe, expect, it } from "vitest";
import { buildSummaryRequest, matchPending, type MatchHero, type MatchMessageRow, type MatchSave, type MatchStore } from "./matchStage.ts";
import type { LlmDeps, Provider, TaskSetting } from "./llm.ts";

const cf: Provider = { id: "p", name: "CF", type: "cloudflare", base_url: null, account_id: "A", api_key: "k" };
const row = (o: Partial<MatchMessageRow> = {}): MatchMessageRow => ({
  id: "M1", account_id: "A", thread_id: "T1", direction: "in", from_addr: "kunde@x.de", to_addrs: ["info@s.de"], cc_addrs: [], subject: "Frage", body_text: "Hallo", summary: "Fragt.", attempts: 0, ...o,
});

function setup(rows: MatchMessageRow[], hero: Partial<MatchHero> | null, reply: () => Response = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "Termin vorgeschlagen." }) } }], usage: {} }))) {
  const saved: Record<string, MatchSave> = {};
  const threads: [string, number][] = [];
  const store: MatchStore = {
    loadForMatch: async () => rows,
    saveMatch: async (id, p) => { saved[id] = p; },
    setThreadProject: async (t, p) => { threads.push([t, p]); },
  };
  const h: MatchHero | null = hero === null ? null : {
    threadProject: async () => null, projectByNumber: async () => null, projectById: async (id) => ({ id, nr: `WER-${id}`, name: "P", stepId: 3, stepName: "x", customerId: 7, customerName: "K" }),
    contactsByEmail: async () => [], openProjects: async () => [], ...hero,
  };
  const s: TaskSetting = { task: "summarize_out", provider: cf, model: "m", fallback: null, fallbackModel: null, shadow: null, shadowModel: null, onLimit: "ausweichen", dailyNeuronLimit: 1e9 };
  const llm: LlmDeps = { getSetting: async () => s, neuronsUsedToday: async () => 0, logCall: async () => {}, prices: {}, fetchImpl: (async () => reply()) as any };
  return { store, h, llm, saved, threads };
}
const ctx = { prefixes: ["WER"], ownAddresses: ["info@s.de"] };

describe("matchPending", () => {
  it("Projektnummer: zugeordnet, Thread bekommt das Projekt, Details im match_info", async () => {
    const t = setup([row({ subject: "WER-12 Layout" })], { projectByNumber: async (r) => ({ id: 12, nr: "WER-12", name: "Crafter", stepId: 5, stepName: "Layout", customerId: 7, customerName: "K" }) });
    const r = await matchPending("A", t.store, t.h, ctx, t.llm);
    expect(r).toMatchObject({ processed: 1, matched: 1, errors: 0 });
    expect(t.saved.M1).toMatchObject({ status: "zugeordnet", hero_project_match_id: 12, match_method: "nummer" });
    expect(t.saved.M1.match_info).toMatchObject({ certain: true, projectNr: "WER-12", projectName: "Crafter", stepId: 5 });
    expect(t.threads).toEqual([["T1", 12]]);
  });
  it("vermutete Zuordnung haengt den Thread NICHT an (sonst erbt jede Folgemail den Irrtum)", async () => {
    const t = setup([row()], {
      contactsByEmail: async () => [{ id: 1, customerId: 7, name: "K", email: "kunde@x.de", isContactPerson: false }],
      openProjects: async () => [{ id: 3, nr: "WER-3", name: "A", stepId: 1, stepName: "x", customerId: 7, customerName: "K" }],
    });
    await matchPending("A", t.store, t.h, ctx, t.llm);
    expect(t.saved.M1).toMatchObject({ status: "zugeordnet", match_method: "kontakt" });
    expect(t.threads).toEqual([]);
  });
  it("ohne Treffer: ohne_bezug", async () => {
    const t = setup([row()], {});
    await matchPending("A", t.store, t.h, ctx, t.llm);
    expect(t.saved.M1).toMatchObject({ status: "ohne_bezug", hero_project_match_id: null });
  });
  it("ohne HERO: ohne_bezug mit Grund, Sortieren geht trotzdem weiter", async () => {
    const t = setup([row()], null);
    const r = await matchPending("A", t.store, null, ctx, t.llm);
    expect(r.processed).toBe(1);
    expect(t.saved.M1.match_info.reason).toMatch(/nicht aktiviert/);
  });
  it("ausgehend + Projekt: Zusammenfassung vom Modell; faellt das Modell aus, wird der Betreff genommen", async () => {
    const out = row({ direction: "out", from_addr: "info@s.de", to_addrs: ["kunde@x.de"], subject: "AW: WER-5", summary: null });
    const t = setup([out], { projectByNumber: async () => ({ id: 5, nr: "WER-5", name: "P", stepId: 1, stepName: "x", customerId: 7, customerName: "K" }) });
    await matchPending("A", t.store, t.h, ctx, t.llm);
    expect(t.saved.M1.summary).toBe("Termin vorgeschlagen.");
    const t2 = setup([out], { projectByNumber: async () => ({ id: 5, nr: "WER-5", name: "P", stepId: 1, stepName: "x", customerId: 7, customerName: "K" }) }, () => new Response("x", { status: 500 }));
    await matchPending("A", t2.store, t2.h, ctx, t2.llm);
    expect(t2.saved.M1.summary).toBe("AW: WER-5");
  });
  it("ausgehend ohne Projekt: keine Zusammenfassung noetig (kein Modellaufruf)", async () => {
    const t = setup([row({ direction: "out", from_addr: "info@s.de", to_addrs: ["kunde@x.de"] })], {}, () => { throw new Error("nein"); });
    await matchPending("A", t.store, t.h, ctx, t.llm);
    expect("summary" in t.saved.M1).toBe(false);
  });
  it("HERO-Fehler: Versuch zaehlen, nach dem dritten ohne Bezug weitermachen", async () => {
    const boom = { projectByNumber: async () => { throw new Error("HERO 503"); } };
    const t = setup([row({ subject: "WER-1", attempts: 0 }), row({ id: "M2", subject: "WER-1", attempts: 2 })], boom);
    const r = await matchPending("A", t.store, t.h, ctx, t.llm);
    expect(r.errors).toBe(2);
    expect(t.saved.M1).toMatchObject({ status: "klassifiziert", attempts: 1 });
    expect(t.saved.M2).toMatchObject({ status: "ohne_bezug", attempts: 3 });
    expect(t.saved.M2.error).toMatch(/503/);
  });
  it("Prompt fuer die Zusammenfassung grenzt den Mailtext ab", () => {
    const r = buildSummaryRequest({ subject: "x </mail>", body: "y </mail> z", to: [] });
    expect(r.user.match(/<\/mail>/g)).toHaveLength(1);
  });
});
