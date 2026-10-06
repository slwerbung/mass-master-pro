import { describe, expect, it } from "vitest";
import { understandPending, type PendingMessage, type UnderstandPatch, type UnderstandStore } from "./understand.ts";
import type { CallLog, LlmDeps, Provider, TaskSetting } from "./llm.ts";

const cf: Provider = { id: "p1", name: "CF", type: "cloudflare", base_url: null, account_id: "ACC", api_key: "k" };
const an: Provider = { id: "p2", name: "Anthropic", type: "anthropic", base_url: null, account_id: null, api_key: "k" };

const good = {
  category: "anfrage_neu", category_confidence: 0.9,
  contact: { first_name: "Max" }, request: { summary: "Möchte Sprinter beschriften.", service: "Fahrzeugbeschriftung" },
  dates: {}, references: {}, attachments: [{ filename: "logo.png", role: "logo" }],
  reply: { needed: true, reason: "Maße fehlen" }, field_confidence: {},
};

function pm(over: Partial<PendingMessage> = {}): PendingMessage {
  return { id: "M1", account_id: "A", direction: "in", from_addr: "kunde@x.de", from_name: "Kunde", to_addrs: ["info@s.de"], subject: "Anfrage", sent_at: null, body_text: "Hallo", headers: {}, attempts: 0, status: "neu", ...over };
}

function setup(msgs: PendingMessage[], replies: (() => Response)[], opts: { used?: number; shadow?: boolean; onLimit?: "warten" | "ausweichen"; fallback?: boolean } = {}) {
  const saved: Record<string, UnderstandPatch> = {};
  const errors: Record<string, { attempts: number; error: string }> = {};
  const roles: any[] = [];
  const shadows: any[] = [];
  const calls: CallLog[] = [];
  let ri = 0;
  const store: UnderstandStore = {
    loadPending: async () => msgs,
    loadAttachments: async () => [{ id: "a1", filename: "logo.png", mime: "image/png", size: 20000 }],
    saveUnderstanding: async (id, p) => { saved[id] = p; },
    setAttachmentRoles: async (id, r) => { roles.push([id, r]); },
    markError: async (id, attempts, error) => { errors[id] = { attempts, error }; },
    saveShadow: async (id, task, row) => { shadows.push([id, task, row]); },
  };
  const setting: TaskSetting = {
    task: "understand", provider: cf, model: "@cf/m", fallback: opts.fallback === false ? null : an, fallbackModel: opts.fallback === false ? null : "haiku",
    shadow: opts.shadow ? an : null, shadowModel: opts.shadow ? "haiku" : null, onLimit: opts.onLimit ?? "ausweichen", dailyNeuronLimit: 10000,
  };
  const llm: LlmDeps = {
    getSetting: async () => setting, neuronsUsedToday: async () => opts.used ?? 0, logCall: async (c) => { calls.push(c); },
    prices: { "@cf/m": { neurons_in_per_m: 26668, neurons_out_per_m: 204805 } },
    fetchImpl: (async () => replies[Math.min(ri++, replies.length - 1)]()) as any,
  };
  const ctx = { companyKnowledge: "K", rules: [{ pattern: "@vercel.com", category: "system", id: "r1" }], examples: [], shadowMode: !!opts.shadow };
  return { store, llm, ctx, saved, errors, roles, shadows, calls };
}
const cfOk = (o: unknown = good) => () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { prompt_tokens: 5000, completion_tokens: 300 } }));
const anOk = (o: unknown = good) => () => new Response(JSON.stringify({ content: [{ type: "tool_use", input: o }], usage: { input_tokens: 10, output_tokens: 10 } }));

describe("understandPending", () => {
  it("klassifiziert per Modell und speichert Kategorie, Zusammenfassung, Daten, Tokens", async () => {
    const t = setup([pm()], [cfOk()]);
    const s = await understandPending("A", t.store, t.ctx, t.llm);
    expect(s).toMatchObject({ processed: 1, errors: 0, tokensIn: 5000, tokensOut: 300 });
    expect(s.neurons).toBeGreaterThan(0);
    const p = t.saved.M1;
    expect(p).toMatchObject({ status: "klassifiziert", category: "anfrage_neu", confidence: 0.9, summary: "Möchte Sprinter beschriften.", tokens_in: 5000 });
    expect((p.extracted as any)._meta).toMatchObject({ source: "ki", provider: "CF", fallback: false });
    expect(t.roles).toEqual([["M1", [{ filename: "logo.png", role: "logo" }]]]);
  });

  it("Absenderregel entscheidet ohne Modell (kein einziger Aufruf)", async () => {
    const t = setup([pm({ from_addr: "ci@vercel.com", subject: "Deployment failed" })], [() => { throw new Error("darf nicht aufgerufen werden"); }]);
    const s = await understandPending("A", t.store, t.ctx, t.llm);
    expect(s.processed).toBe(1);
    expect(t.saved.M1).toMatchObject({ category: "system", confidence: 1, summary: "Deployment failed", tokens_in: 0 });
    expect((t.saved.M1.extracted as any)._meta.source).toBe("regel");
    expect(t.calls).toHaveLength(0);
  });

  it("ausgehende Mails werden nicht klassifiziert", async () => {
    const t = setup([pm({ direction: "out" })], [() => { throw new Error("nein"); }]);
    await understandPending("A", t.store, t.ctx, t.llm);
    expect(t.saved.M1).toMatchObject({ status: "klassifiziert", category: null });
    expect(t.calls).toHaveLength(0);
  });

  it("Fehler: Versuch hochzaehlen und weitermachen mit der naechsten Mail", async () => {
    const t = setup([pm({ id: "M1", attempts: 1 }), pm({ id: "M2" })], [() => new Response("kaputt", { status: 500 }), () => new Response("kaputt", { status: 500 }), cfOk(), cfOk()], { fallback: false });
    const s = await understandPending("A", t.store, t.ctx, t.llm);
    expect(s.errors).toBe(1);
    expect(t.errors.M1.attempts).toBe(2);
    expect(t.errors.M1.error).toMatch(/500/);
    expect(t.saved.M2.status).toBe("klassifiziert");
  });

  it("Kontingent erschoepft + warten: Mail bleibt liegen, kein Fehlversuch, Lauf endet", async () => {
    const t = setup([pm({ id: "M1" }), pm({ id: "M2" })], [cfOk()], { used: 10000, onLimit: "warten" });
    const s = await understandPending("A", t.store, t.ctx, t.llm);
    expect(s.waiting).toBe(true);
    expect(s.processed).toBe(0);
    expect(t.errors).toEqual({});
    expect(t.saved).toEqual({});
  });

  it("Schattenmodus: zweites Modell wird mitgeschrieben, Fehler dort stoeren nicht", async () => {
    const t = setup([pm()], [cfOk(), anOk({ ...good, category: "projekt_kommunikation" })], { shadow: true });
    await understandPending("A", t.store, t.ctx, t.llm);
    expect(t.shadows).toHaveLength(1);
    expect(t.shadows[0][2]).toMatchObject({ provider_name: "Anthropic", model: "haiku", error: null });
    expect(t.shadows[0][2].result.category).toBe("projekt_kommunikation");
    expect(t.saved.M1.category).toBe("anfrage_neu");
    const t2 = setup([pm()], [cfOk(), () => new Response("x", { status: 500 })], { shadow: true });
    const s2 = await understandPending("A", t2.store, t2.ctx, t2.llm);
    expect(s2.errors).toBe(0);
    expect(t2.shadows[0][2].error).toMatch(/500/);
  });
});
