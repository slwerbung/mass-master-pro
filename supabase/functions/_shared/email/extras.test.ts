import { describe, expect, it } from "vitest";
import { buildExtra } from "./extras.ts";
import { AUTOPILOT_DEFAULTS, type Autopilot } from "./types.ts";
import type { ActContext, ActDeps, ActMessage, PlanEntry } from "./act.ts";
import type { DraftDeps } from "./draft.ts";
import { LimitWaitError } from "./llm.ts";

const m = (o: Partial<ActMessage> = {}): ActMessage => ({
  id: "M1", account_id: "A", thread_id: "T1", direction: "in", current_folder: "INBOX", current_uid: 1, from_addr: "k@x.de", from_name: "K", to_addrs: [], subject: "Frage",
  category: "projekt_kommunikation", confidence: 0.9, summary: "s", extracted: { reply: { needed: true } }, hero_project_match_id: null, match_method: null,
  match_info: { certain: false, knownContact: false, reason: "" }, hero_logged_at: null, has_attachments: false, plan: [], status: "zugeordnet", attempts: 0, message_id: "<m@x>", refs: [], body_text: "Wann?", sent_at: "2026-10-05T08:00:00Z", ...o,
});
const ctx = (shadow = false, ap: Partial<Autopilot> = {}): ActContext => ({ autopilot: { ...AUTOPILOT_DEFAULTS, ...ap }, shadowMode: shadow, inbox: "INBOX", folders: {}, steps: {}, gewerke: [], accountLabel: "info@" });

function setup(o: { answered?: boolean; draftErr?: Error; canWrite?: boolean; atts?: any[]; uploader?: boolean } = {}) {
  const log = { drafts: [] as any[], suggestions: [] as any[], uploads: [] as any[] };
  const draftDeps = { __marker: true } as unknown as DraftDeps;
  const deps = {
    store: {
      hasOutgoingAfter: async () => !!o.answered,
      loadAttachments: async () => o.atts ?? [],
      createSuggestion: async (id: string, type: string, payload: any) => { log.suggestions.push({ type, payload }); return true; },
    },
    uploader: o.uploader ? { upload: async (p: number, items: any[]) => { log.uploads.push([p, items.length]); return { uploaded: items.length, failed: [] }; } } : null,
  } as unknown as ActDeps;
  return { log, deps, draftDeps, canWrite: o.canWrite ?? true };
}
// generateDraft ersetzen wir nicht – wir pruefen ueber ein DraftDeps-Attrappe, die den Ablauf mitschreibt.
import { vi } from "vitest";
vi.mock("./draft.ts", async (orig) => {
  const real: any = await orig();
  return { ...real, generateDraft: vi.fn(async (_m: any, _d: any, opts: any) => ({ text: "T", subject: "AW: x", written: opts.write, placeholders: ["a"] })) };
});
import { generateDraft } from "./draft.ts";

describe("Entwurf", () => {
  it("auto: wird ins Postfach gelegt", async () => {
    const t = setup(); const plan: PlanEntry[] = [];
    await buildExtra({ docTypes: {}, draft: { deps: t.draftDeps, canWrite: true } })(m(), ctx(), t.deps, plan);
    expect(plan[0]).toMatchObject({ action: "draft", decision: "auto", done: true });
    expect((generateDraft as any).mock.calls.at(-1)[2].write).toBe(true);
  });
  it("Schattenmodus: berechnet, aber NICHT ins Postfach", async () => {
    const t = setup(); const plan: PlanEntry[] = [];
    await buildExtra({ docTypes: {}, draft: { deps: t.draftDeps, canWrite: true } })(m(), ctx(true), t.deps, plan);
    expect(plan[0]).toMatchObject({ decision: "shadow", done: false });
    expect((generateDraft as any).mock.calls.at(-1)[2].write).toBe(false);
  });
  it("Stufe Vorschlag, unsichere Konfidenz oder kein Entwuerfe-Ordner: nicht ins Postfach", async () => {
    for (const [c, ap, mm] of [[true, { draft: "suggest" }, m()], [true, {}, m({ confidence: 0.4 })], [false, {}, m()]] as const) {
      const t = setup(); const plan: PlanEntry[] = [];
      await buildExtra({ docTypes: {}, draft: { deps: t.draftDeps, canWrite: c } })(mm, ctx(false, ap as any), t.deps, plan);
      expect(plan[0].done).toBe(false);
      expect((generateDraft as any).mock.calls.at(-1)[2].write).toBe(false);
    }
  });
  it("Stufe Aus, schon beantwortet, schon ein Entwurf oder falsche Kategorie: kein Entwurf", async () => {
    const before = (generateDraft as any).mock.calls.length;
    const run = async (mm: ActMessage, c: ActContext, o = {}) => { const t = setup(o); const plan: PlanEntry[] = []; await buildExtra({ docTypes: {}, draft: { deps: t.draftDeps, canWrite: true } })(mm, c, t.deps, plan); return plan; };
    expect(await run(m(), ctx(false, { draft: "off" }))).toEqual([]);
    expect((await run(m(), ctx(), { answered: true }))[0].detail).toMatch(/schon beantwortet/);
    expect(await run(m({ draft_text: "da" }), ctx())).toEqual([]);
    expect((await run(m({ category: "auftrag" }), ctx()))[0].detail).toMatch(/Auftragsbestätigung/);
    expect((generateDraft as any).mock.calls.length).toBe(before);
  });
  it("Modellfehler oder erschoepftes Kontingent bringen die Mail nicht zu Fall", async () => {
    (generateDraft as any).mockRejectedValueOnce(new Error("Schema verletzt"));
    const t = setup(); const plan: PlanEntry[] = [];
    await buildExtra({ docTypes: {}, draft: { deps: t.draftDeps, canWrite: true } })(m(), ctx(), t.deps, plan);
    expect(plan[0]).toMatchObject({ decision: "skip", done: false });
    expect(plan[0].detail).toMatch(/fehlgeschlagen/);
    (generateDraft as any).mockRejectedValueOnce(new LimitWaitError());
    const plan2: PlanEntry[] = [];
    await buildExtra({ docTypes: {}, draft: { deps: t.draftDeps, canWrite: true } })(m(), ctx(), t.deps, plan2);
    expect(plan2[0].detail).toMatch(/Kontingent/);
  });
});

describe("Anhaenge", () => {
  const atts = [{ id: "a1", filename: "logo.png", mime: "image/png", size: 50000, role: "logo", storage_path: "p", is_ignored: false }];
  const mm = m({ hero_project_match_id: 5, has_attachments: true, match_info: { certain: true, knownContact: true, reason: "", projectNr: "WER-5" }, match_method: "nummer", category: "auftrag" });
  it("Standard: Vorschlag mit Dokumenttyp je Rolle", async () => {
    const t = setup({ atts }); const plan: PlanEntry[] = [];
    await buildExtra({ docTypes: { layouts: 11 }, draft: null })(mm, ctx(), t.deps, plan);
    expect(t.log.suggestions[0]).toMatchObject({ type: "upload_attachments", payload: { projectId: 5, items: [expect.objectContaining({ attachmentId: "a1", documentTypeId: 11 })] } });
  });
  it("Automatisch laedt hoch (Stufe in den Einstellungen), im Schattenmodus nur geplant", async () => {
    const t = setup({ atts, uploader: true }); const plan: PlanEntry[] = [];
    await buildExtra({ docTypes: { layouts: 11 }, draft: null })(mm, ctx(false, { attachments: "auto" }), t.deps, plan);
    expect(t.log.uploads).toEqual([[5, 1]]);
    const t2 = setup({ atts, uploader: true }); const plan2: PlanEntry[] = [];
    await buildExtra({ docTypes: { layouts: 11 }, draft: null })(mm, ctx(true, { attachments: "auto" }), t2.deps, plan2);
    expect(t2.log.uploads).toEqual([]);
    expect(plan2[0].decision).toBe("shadow");
  });
  it("nichts ohne Projekt, ohne Anhaenge oder ohne konfigurierten Dokumenttyp", async () => {
    const t = setup({ atts }); const plan: PlanEntry[] = [];
    const ex = buildExtra({ docTypes: { layouts: 11 }, draft: null });
    await ex(m({ has_attachments: true }), ctx(), t.deps, plan);
    await ex({ ...mm, has_attachments: false }, ctx(), t.deps, plan);
    await buildExtra({ docTypes: {}, draft: null })(mm, ctx(), t.deps, plan);
    expect(t.log.suggestions).toEqual([]);
  });
});

describe("Angebot vorbereiten", () => {
  const mm = m({ hero_project_match_id: 5, category: "anfrage_neu", match_info: { certain: true, knownContact: true, reason: "", projectNr: "WER-5" }, match_method: "nummer" });
  it("nur Neuanfragen mit Projekt; legt einen Vorschlag an", async () => {
    const calls: any[] = [];
    const offer = { suggest: async (...a: any[]) => { calls.push(a); return { kind: "angebot" }; } };
    const t = setup(); const plan: PlanEntry[] = [];
    const ex = buildExtra({ docTypes: {}, draft: null, offer });
    await ex(mm, ctx(), t.deps, plan);
    expect(calls).toEqual([["M1", 5, "WER-5"]]);
    expect(plan.find((p) => p.action === "prepare_offer")).toMatchObject({ decision: "suggest", done: true });
    await ex(m({ hero_project_match_id: 5, category: "projekt_kommunikation" }), ctx(), t.deps, []);
    await ex(m({ category: "anfrage_neu" }), ctx(), t.deps, []);
    expect(calls).toHaveLength(1);
  });
  it("Stufe Aus: nichts; Schattenmodus + Automatisch: nur geplant; Budget/Fehler stoeren nicht", async () => {
    const calls: any[] = [];
    const offer = { suggest: async (...a: any[]) => { calls.push(a); return null; } };
    const t = setup();
    await buildExtra({ docTypes: {}, draft: null, offer })(mm, ctx(false, { prepare_offer: "off" }), t.deps, []);
    expect(calls).toEqual([]);
    const plan: PlanEntry[] = [];
    await buildExtra({ docTypes: {}, draft: null, offer })(mm, ctx(true, { prepare_offer: "auto" }), t.deps, plan);
    expect(plan[0]).toMatchObject({ decision: "shadow", done: false });
    expect(calls).toEqual([]);
    const plan2: PlanEntry[] = [];
    await buildExtra({ docTypes: {}, draft: null, offer: { suggest: async () => { throw new Error("HERO kaputt"); } } })(mm, ctx(), t.deps, plan2);
    expect(plan2[0].detail).toMatch(/nicht möglich: HERO kaputt/);
  });
});

describe("Beleg an Lexware (automatischer Versand)", () => {
  const beleg = m({ category: "beleg", has_attachments: true, extracted: { beleg: { is_booking_document: true, delivery: "anhang", vendor: "Lieferant" } } });
  const fwd = (calls: any[] = [], how: "gesendet" | "entwurf" = "gesendet") => ({
    address: "belege@lexware.example",
    run: async (id: string, mode: string) => { calls.push([id, mode]); return { files: 2, how, ...(how === "entwurf" ? { fallbackReason: "ETIMEDOUT" } : {}) }; },
  });
  const run = async (mm: ActMessage, f: any, c = ctx()) => { const plan: PlanEntry[] = []; await buildExtra({ docTypes: {}, draft: null, forward: f })(mm, c, setup().deps, plan); return plan; };

  it("Standard (Automatisch): sendet, Plan nennt es", async () => {
    const calls: any[] = [];
    const plan = await run(beleg, fwd(calls));
    expect(calls).toEqual([["M1", "send"]]);
    expect(plan[0]).toMatchObject({ action: "forward_beleg", decision: "auto", done: true });
    expect(plan[0].detail).toMatch(/An Lexware gesendet/);
  });
  it("auch wenn nur das Modell „buchungsrelevanter Beleg“ sagt (andere Kategorie)", async () => {
    const calls: any[] = [];
    await run({ ...beleg, category: "lieferant" }, fwd(calls));
    expect(calls).toHaveLength(1);
  });
  it("Senden scheitert -> Entwurf: der Plan sagt es deutlich", async () => {
    const plan = await run(beleg, fwd([], "entwurf"));
    expect(plan[0].detail).toMatch(/Senden nicht möglich \(ETIMEDOUT\) – Entwurf/);
  });
  it("Schattenmodus, unsichere Konfidenz und Stufe Aus: nie senden", async () => {
    const calls: any[] = [];
    expect((await run(beleg, fwd(calls), ctx(true)))[0].decision).toBe("shadow");
    expect((await run({ ...beleg, confidence: 0.4 }, fwd(calls)))[0].decision).toBe("suggest");
    expect(await run(beleg, fwd(calls), ctx(false, { forward_beleg: "off" }))).toEqual([]);
    expect(calls).toEqual([]);
  });
  it("nie: Portal-Rechnung, ohne Anhang, ohne Adresse, vom Lexware-Absender selbst, ausgehend, schon weitergeleitet", async () => {
    const calls: any[] = [];
    const portal = { ...beleg, extracted: { beleg: { is_booking_document: true, delivery: "portal" } } };
    for (const mm of [portal, { ...beleg, has_attachments: false }, { ...beleg, from_addr: "Belege@Lexware.example" }, { ...beleg, direction: "out" as const },
      { ...beleg, forwarded_at: "2026-10-06" }, { ...beleg, beleg_state: "weitergeleitet" }, { ...beleg, plan: [{ action: "forward_beleg", decision: "auto", done: true }] }]) {
      expect(await run(mm as ActMessage, fwd(calls))).toEqual([]);
    }
    expect(await run(beleg, { address: "", run: async () => ({ files: 1, how: "gesendet" }) })).toEqual([]);
    expect(calls).toEqual([]);
  });
  it("kein Beleg (normale Mail oder Modell sagt nein) -> nichts", async () => {
    const calls: any[] = [];
    await run(m({ category: "projekt_kommunikation", has_attachments: true, extracted: { beleg: { is_booking_document: false, delivery: "keine" } } }), fwd(calls));
    expect(calls).toEqual([]);
  });
  it("Fehler beim Weiterleiten stoeren die Mail nicht", async () => {
    const plan = await run(beleg, { address: "a@b.de", run: async () => { throw new Error("kein Beleg-Anhang"); } });
    expect(plan[0].detail).toMatch(/nicht möglich: kein Beleg-Anhang/);
  });
});
