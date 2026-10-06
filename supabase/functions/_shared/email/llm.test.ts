import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callProvider, computeCost, LimitWaitError, runShadow, runTask, type CallLog, type LlmDeps, type LlmRequest, type Provider, type TaskSetting } from "./llm.ts";

const schema = z.object({ category: z.enum(["a", "b"]), n: z.number() });
const req: LlmRequest = {
  system: [{ text: "SYS", cache: true }], user: "USER", schemaName: "result",
  jsonSchema: { type: "object", properties: { category: { type: "string" }, n: { type: "number" } }, required: ["category", "n"] },
};
const cf: Provider = { id: "p1", name: "CF", type: "cloudflare", base_url: null, account_id: "ACC", api_key: "cfkey" };
const an: Provider = { id: "p2", name: "Anthropic", type: "anthropic", base_url: null, account_id: null, api_key: "ankey" };
const prices = {
  "@cf/m": { neurons_in_per_m: 26668, neurons_out_per_m: 204805 },
  haiku: { usd_in_per_m: 1, usd_out_per_m: 5, usd_cached_in_per_m: 0.1 },
};

function cfReply(content: unknown, u = { prompt_tokens: 1000, completion_tokens: 100 }) {
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: u }));
}
function anReply(input: unknown) {
  return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "result", input }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 4000 } }));
}

function setting(over: Partial<TaskSetting> = {}): TaskSetting {
  return { task: "understand", provider: cf, model: "@cf/m", fallback: an, fallbackModel: "haiku", shadow: null, shadowModel: null, onLimit: "ausweichen", dailyNeuronLimit: 10000, ...over };
}
function deps(s: TaskSetting, fetches: ((url: string, init: any) => Response | Promise<Response>)[], used = 0) {
  const calls: CallLog[] = [];
  const seen: { url: string; init: any }[] = [];
  let i = 0;
  const d: LlmDeps = {
    getSetting: async () => s,
    neuronsUsedToday: async () => used,
    logCall: async (r) => { calls.push(r); },
    prices,
    fetchImpl: (async (url: string, init: any) => { seen.push({ url, init }); return fetches[Math.min(i++, fetches.length - 1)](url, init); }) as any,
  };
  return { d, calls, seen };
}

describe("Adapter", () => {
  it("Cloudflare: OpenAI-kompatibler Pfad, Schema im response_format, Bearer-Schluessel", async () => {
    const { d, seen } = deps(setting(), [() => cfReply({ category: "a", n: 1 })]);
    const r = await callProvider(cf, "@cf/m", req, d.fetchImpl);
    expect(r.json).toEqual({ category: "a", n: 1 });
    expect(r.usage).toEqual({ tokensIn: 1000, tokensOut: 100, cachedIn: 0 });
    expect(seen[0].url).toBe("https://api.cloudflare.com/client/v4/accounts/ACC/ai/v1/chat/completions");
    expect(seen[0].init.headers.authorization).toBe("Bearer cfkey");
    const body = JSON.parse(seen[0].init.body);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
  });
  it("Cloudflare: toleriert Code-Zaeune und Text um das JSON", async () => {
    const { d } = deps(setting(), [() => cfReply('Hier:\n```json\n{"category":"b","n":2}\n```')]);
    expect((await callProvider(cf, "@cf/m", req, d.fetchImpl)).json).toEqual({ category: "b", n: 2 });
  });
  it("Anthropic: erzwungenes Tool, Prompt-Caching-Marker, Cache-Token zaehlen", async () => {
    const { d, seen } = deps(setting(), [() => anReply({ category: "a", n: 3 })]);
    const r = await callProvider(an, "haiku", req, d.fetchImpl);
    expect(r.json).toEqual({ category: "a", n: 3 });
    expect(r.usage).toEqual({ tokensIn: 4100, tokensOut: 20, cachedIn: 4000 });
    const body = JSON.parse(seen[0].init.body);
    expect(body.tool_choice).toEqual({ type: "tool", name: "result" });
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(seen[0].init.headers["x-api-key"]).toBe("ankey");
  });
  it("lehnt Anbieter ohne Schluessel ab", async () => {
    await expect(callProvider({ ...cf, api_key: null }, "m", req)).rejects.toThrow(/Schluessel/);
  });
});

describe("Kosten", () => {
  it("rechnet Neurons fuer Cloudflare (Beispiel aus dem Konzept: ~229 je Mail)", () => {
    const c = computeCost("cloudflare", "@cf/m", { tokensIn: 5500, tokensOut: 400, cachedIn: 0 }, prices);
    expect(Math.round(c.neurons)).toBe(229);
    expect(c.costUsd).toBe(0);
  });
  it("rechnet Dollar fuer Haiku mit Cache-Rabatt (~0,0075 $ ohne Cache)", () => {
    const plain = computeCost("anthropic", "haiku", { tokensIn: 5500, tokensOut: 400, cachedIn: 0 }, prices);
    expect(plain.costUsd).toBeCloseTo(0.0075, 4);
    const cached = computeCost("anthropic", "haiku", { tokensIn: 5500, tokensOut: 400, cachedIn: 4000 }, prices);
    expect(cached.costUsd).toBeLessThan(plain.costUsd);
  });
  it("unbekanntes Modell kostet 0", () => {
    expect(computeCost("openai", "x", { tokensIn: 1, tokensOut: 1, cachedIn: 0 }, prices)).toEqual({ neurons: 0, costUsd: 0 });
  });
});

describe("runTask", () => {
  it("Normalfall: Hauptanbieter, Aufruf wird protokolliert", async () => {
    const { d, calls } = deps(setting(), [() => cfReply({ category: "a", n: 1 })]);
    const r = await runTask("understand", req, schema, d, { messageId: "m1" });
    expect(r.data).toEqual({ category: "a", n: 1 });
    expect(r.usedFallback).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ ok: true, fallback: false, messageId: "m1", providerType: "cloudflare" });
    expect(calls[0].neurons).toBeGreaterThan(0);
  });
  it("Schema verletzt -> ein Versuch beim Ausweich-Anbieter", async () => {
    const { d, calls } = deps(setting(), [() => cfReply({ category: "ZZZ", n: 1 }), () => anReply({ category: "b", n: 2 })]);
    const r = await runTask("understand", req, schema, d);
    expect(r.data.category).toBe("b");
    expect(r.usedFallback).toBe(true);
    expect(calls.map((c) => [c.ok, c.fallback])).toEqual([[false, false], [true, true]]);
    expect(calls[0].error).toMatch(/Schema verletzt/);
  });
  it("Anbieter nicht erreichbar -> Ausweichen", async () => {
    const { d } = deps(setting(), [() => { throw new Error("ECONNRESET"); }, () => anReply({ category: "a", n: 1 })]);
    expect((await runTask("understand", req, schema, d)).usedFallback).toBe(true);
  });
  it("Kontingent erschoepft + ausweichen -> direkt Ausweich-Anbieter, Cloudflare wird nicht angefragt", async () => {
    const { d, seen } = deps(setting(), [() => anReply({ category: "a", n: 1 })], 10000);
    const r = await runTask("understand", req, schema, d);
    expect(r.usedFallback).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("anthropic");
  });
  it("Kontingent erschoepft + warten -> LimitWaitError, kein Aufruf", async () => {
    const { d, seen } = deps(setting({ onLimit: "warten" }), [() => anReply({})], 10000);
    await expect(runTask("understand", req, schema, d)).rejects.toBeInstanceOf(LimitWaitError);
    expect(seen).toHaveLength(0);
  });
  it("Kontingent erschoepft ohne Ausweich-Anbieter -> warten", async () => {
    const { d } = deps(setting({ fallback: null, fallbackModel: null }), [() => anReply({})], 10000);
    await expect(runTask("understand", req, schema, d)).rejects.toBeInstanceOf(LimitWaitError);
  });
  it("ohne Ausweich-Anbieter: ein Wiederholungsversuch, dann Fehler", async () => {
    const { d, calls } = deps(setting({ fallback: null, fallbackModel: null }), [() => cfReply("kein json"), () => cfReply({ category: "a", n: 9 })]);
    expect((await runTask("understand", req, schema, d)).data.n).toBe(9);
    expect(calls).toHaveLength(2);
    const { d: d2 } = deps(setting({ fallback: null, fallbackModel: null }), [() => cfReply("kein json")]);
    await expect(runTask("understand", req, schema, d2)).rejects.toThrow();
  });
  it("beide Anbieter scheitern -> Fehlertext nennt beide", async () => {
    const { d } = deps(setting(), [() => cfReply("kaputt"), () => new Response("boom", { status: 500 })]);
    await expect(runTask("understand", req, schema, d)).rejects.toThrow(/Hauptanbieter.*Ausweichanbieter/s);
  });
  it("ohne Einstellung/Anbieter klare Fehlermeldung", async () => {
    const { d } = deps(setting({ provider: null }), [() => cfReply({})]);
    await expect(runTask("understand", req, schema, d)).rejects.toThrow(/kein KI-Anbieter/);
  });
});

describe("runShadow", () => {
  it("liefert null ohne Vergleichs-Anbieter und wirft nie", async () => {
    const { d } = deps(setting(), [() => cfReply({})]);
    expect(await runShadow("understand", req, schema, d)).toBeNull();
    const { d: d2 } = deps(setting({ shadow: an, shadowModel: "haiku" }), [() => new Response("x", { status: 500 })]);
    const r = await runShadow("understand", req, schema, d2);
    expect(r?.error).toMatch(/500/);
  });
  it("liefert das Ergebnis des zweiten Modells", async () => {
    const { d } = deps(setting({ shadow: an, shadowModel: "haiku" }), [() => anReply({ category: "b", n: 5 })]);
    expect((await runShadow("understand", req, schema, d))?.data).toEqual({ category: "b", n: 5 });
  });
});
