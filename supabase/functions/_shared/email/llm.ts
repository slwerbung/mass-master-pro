// Austauschbare KI-Anbieter-Schicht.
//
//   runTask(task, request, schema, deps)
//
// Dahinter stecken Adapter fuer Cloudflare Workers AI, Anthropic und jeden
// OpenAI-kompatiblen Anbieter. Welche Aufgabe welchen Anbieter und welches
// Modell nutzt, steht in `email_ai_settings` (Admin-Bereich der Mail-App).
//
// Sicherheit: Das Modell liefert nur strukturierte Felder (festes JSON-Schema,
// mit zod validiert). Aktionen entscheidet der Code, nie das Modell.
//
// Ausweichen (Konzept „Regeln fuer das Ausweichen"):
//   * Kontingent: Cloudflare-Tagesgrenze (Neurons) erreicht -> Ausweich-Anbieter
//     oder warten bis Mitternacht UTC (`on_limit`).
//   * Fehler: Schema verletzt, Zeitueberschreitung, Anbieter nicht erreichbar ->
//     ein Versuch beim Ausweich-Anbieter. Ohne Ausweich-Anbieter: ein
//     Wiederholungsversuch beim selben, danach Fehler.

import type { ZodType } from "zod";
import type { AiTask } from "./types.ts";

export type ProviderType = "cloudflare" | "anthropic" | "openai";

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  base_url: string | null;
  account_id: string | null;
  /** Entschluesselt — nie loggen, nie an die Oberflaeche geben. */
  api_key: string | null;
}

export interface TaskSetting {
  task: AiTask;
  provider: Provider | null;
  model: string;
  fallback: Provider | null;
  fallbackModel: string | null;
  shadow: Provider | null;
  shadowModel: string | null;
  onLimit: "ausweichen" | "warten";
  dailyNeuronLimit: number;
}

export interface LlmRequest {
  /** Feste Bloecke vorn: Systemprompt, Firmenwissen, Kategorien. `cache` = Prompt-Caching (Anthropic). */
  system: { text: string; cache?: boolean }[];
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  cachedIn: number;
}

export interface CallLog {
  task: AiTask;
  messageId?: string | null;
  providerId: string | null;
  providerType: ProviderType | null;
  model: string;
  usage: Usage;
  neurons: number;
  costUsd: number;
  ok: boolean;
  fallback: boolean;
  error?: string | null;
}

export interface LlmDeps {
  getSetting(task: AiTask): Promise<TaskSetting | null>;
  /** Heute (UTC) verbrauchte Neurons ueber alle Cloudflare-Aufrufe. */
  neuronsUsedToday(): Promise<number>;
  logCall(row: CallLog): Promise<void>;
  /** `email_config.llm_prices` */
  prices: Record<string, any>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Kontingent erschoepft und `on_limit = warten`: die Mail bleibt liegen, ohne Fehlversuch. */
export class LimitWaitError extends Error {
  constructor() {
    super("KI-Tageskontingent erschoepft – Mail wartet bis Mitternacht (UTC).");
    this.name = "LimitWaitError";
  }
}

export class LlmError extends Error {}

const CF_BASE = (accountId: string) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";

function stripFences(t: string): string {
  return t.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseJsonLoose(content: unknown): unknown {
  if (content && typeof content === "object") return content;
  const text = stripFences(String(content ?? ""));
  try {
    return JSON.parse(text);
  } catch {
    // Manche Modelle schicken Text vor/hinter dem Objekt.
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new LlmError("Antwort ist kein gueltiges JSON");
  }
}

export interface RawResult { json: unknown; usage: Usage }

export async function callProvider(
  p: Provider, model: string, req: LlmRequest, fetchImpl: typeof fetch = fetch, timeoutMs = 45_000,
): Promise<RawResult> {
  if (!p.api_key) throw new LlmError(`Anbieter „${p.name}“ hat keinen API-Schluessel`);
  const signal = AbortSignal.timeout(timeoutMs);

  if (p.type === "anthropic") {
    const base = (p.base_url || ANTHROPIC_BASE).replace(/\/+$/, "");
    const body = {
      model,
      max_tokens: req.maxTokens ?? 1500,
      temperature: req.temperature ?? 0.1,
      system: req.system.map((b) => ({
        type: "text",
        text: b.text,
        ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}),
      })),
      messages: [{ role: "user", content: req.user }],
      tools: [{ name: req.schemaName, description: "Liefert das Ergebnis als strukturierte Felder.", input_schema: req.jsonSchema }],
      tool_choice: { type: "tool", name: req.schemaName },
    };
    const resp = await fetchImpl(`${base}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": p.api_key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await resp.text();
    if (!resp.ok) throw new LlmError(`Anthropic HTTP ${resp.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    const tool = (data.content || []).find((b: any) => b.type === "tool_use");
    if (!tool) throw new LlmError("Anthropic lieferte kein Tool-Ergebnis");
    const u = data.usage || {};
    return {
      json: tool.input,
      usage: {
        tokensIn: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
        tokensOut: u.output_tokens || 0,
        cachedIn: u.cache_read_input_tokens || 0,
      },
    };
  }

  // Cloudflare Workers AI und alle OpenAI-kompatiblen Anbieter: gleiches Format.
  let base: string;
  if (p.type === "cloudflare") {
    if (!p.account_id) throw new LlmError(`Anbieter „${p.name}“ hat keine Cloudflare-Account-ID`);
    base = (p.base_url || CF_BASE(p.account_id)).replace(/\/+$/, "");
  } else {
    if (!p.base_url) throw new LlmError(`Anbieter „${p.name}“ hat keine Basis-URL`);
    base = p.base_url.replace(/\/+$/, "");
  }
  const body = {
    model,
    max_tokens: req.maxTokens ?? 1500,
    temperature: req.temperature ?? 0.1,
    messages: [
      { role: "system", content: req.system.map((b) => b.text).join("\n\n") },
      { role: "user", content: req.user },
    ],
    response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.jsonSchema } },
  };
  const resp = await fetchImpl(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key}` },
    body: JSON.stringify(body),
    signal,
  });
  const text = await resp.text();
  if (!resp.ok) throw new LlmError(`${p.name} HTTP ${resp.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content ?? data?.result?.response;
  if (content == null) throw new LlmError(`${p.name}: leere Antwort`);
  const u = data.usage || {};
  return {
    json: parseJsonLoose(content),
    usage: { tokensIn: u.prompt_tokens || 0, tokensOut: u.completion_tokens || 0, cachedIn: 0 },
  };
}

/** Neurons (Cloudflare) bzw. US-Dollar (Anthropic) aus den Token-Zahlen. */
export function computeCost(
  type: ProviderType | null, model: string, usage: Usage, prices: Record<string, any>,
): { neurons: number; costUsd: number } {
  const p = prices?.[model];
  if (!p) return { neurons: 0, costUsd: 0 };
  if (type === "cloudflare" && p.neurons_in_per_m != null) {
    const neurons = (usage.tokensIn * p.neurons_in_per_m + usage.tokensOut * p.neurons_out_per_m) / 1_000_000;
    return { neurons, costUsd: 0 };
  }
  if (p.usd_in_per_m != null) {
    const fresh = Math.max(0, usage.tokensIn - usage.cachedIn);
    const cachedRate = p.usd_cached_in_per_m ?? p.usd_in_per_m;
    const costUsd =
      (fresh * p.usd_in_per_m + usage.cachedIn * cachedRate + usage.tokensOut * p.usd_out_per_m) / 1_000_000;
    return { neurons: 0, costUsd };
  }
  return { neurons: 0, costUsd: 0 };
}

export interface TaskResult<T> {
  data: T;
  usage: Usage;
  providerName: string;
  model: string;
  usedFallback: boolean;
  neurons: number;
  costUsd: number;
}

async function attempt<T>(
  task: AiTask, provider: Provider, model: string, req: LlmRequest, schema: ZodType<T>,
  deps: LlmDeps, messageId: string | null | undefined, fallback: boolean,
): Promise<TaskResult<T>> {
  let usage: Usage = { tokensIn: 0, tokensOut: 0, cachedIn: 0 };
  try {
    const raw = await callProvider(provider, model, req, deps.fetchImpl ?? fetch, deps.timeoutMs);
    usage = raw.usage;
    const parsed = schema.safeParse(raw.json);
    if (!parsed.success) {
      const why = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new LlmError(`Schema verletzt (${why})`);
    }
    const cost = computeCost(provider.type, model, usage, deps.prices);
    await deps.logCall({
      task, messageId, providerId: provider.id, providerType: provider.type, model, usage,
      neurons: cost.neurons, costUsd: cost.costUsd, ok: true, fallback,
    });
    return { data: parsed.data, usage, providerName: provider.name, model, usedFallback: fallback, ...cost };
  } catch (e) {
    const cost = computeCost(provider.type, model, usage, deps.prices);
    await deps.logCall({
      task, messageId, providerId: provider.id, providerType: provider.type, model, usage,
      neurons: cost.neurons, costUsd: cost.costUsd, ok: false, fallback,
      error: String((e as Error)?.message || e).slice(0, 400),
    }).catch(() => {});
    throw e;
  }
}

export async function runTask<T>(
  task: AiTask, req: LlmRequest, schema: ZodType<T>, deps: LlmDeps, opts: { messageId?: string | null } = {},
): Promise<TaskResult<T>> {
  const s = await deps.getSetting(task);
  if (!s || !s.provider) throw new LlmError(`Fuer die Aufgabe „${task}“ ist kein KI-Anbieter eingestellt`);

  let primaryAllowed = true;
  if (s.provider.type === "cloudflare") {
    const used = await deps.neuronsUsedToday();
    if (used >= s.dailyNeuronLimit) {
      if (s.onLimit === "warten" || !(s.fallback && s.fallbackModel)) throw new LimitWaitError();
      primaryAllowed = false;
    }
  }

  const hasFallback = !!(s.fallback && s.fallbackModel);
  let firstError: unknown = null;
  if (primaryAllowed) {
    try {
      return await attempt(task, s.provider, s.model, req, schema, deps, opts.messageId, false);
    } catch (e) {
      firstError = e;
    }
  }
  if (hasFallback) {
    try {
      return await attempt(task, s.fallback!, s.fallbackModel!, req, schema, deps, opts.messageId, true);
    } catch (e) {
      throw new LlmError(
        `Hauptanbieter: ${firstError ? String((firstError as Error).message) : "Kontingent erschoepft"}; ` +
          `Ausweichanbieter: ${(e as Error).message}`,
      );
    }
  }
  // Kein Ausweich-Anbieter: ein Wiederholungsversuch, dann Fehler.
  return await attempt(task, s.provider, s.model, req, schema, deps, opts.messageId, false);
}

/** Zweiter Anbieter fuer den Parallelvergleich im Schattenmodus. Wirft nie. */
export async function runShadow<T>(
  task: AiTask, req: LlmRequest, schema: ZodType<T>, deps: LlmDeps, opts: { messageId?: string | null } = {},
): Promise<{ providerName: string; model: string; data?: T; error?: string } | null> {
  const s = await deps.getSetting(task);
  if (!s || !s.shadow || !s.shadowModel) return null;
  try {
    const r = await attempt(task, s.shadow, s.shadowModel, req, schema, deps, opts.messageId, false);
    return { providerName: s.shadow.name, model: s.shadowModel, data: r.data };
  } catch (e) {
    return { providerName: s.shadow.name, model: s.shadowModel, error: String((e as Error).message).slice(0, 300) };
  }
}
