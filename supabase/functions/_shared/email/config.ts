// Konfiguration, Postfach-Zugangsdaten und KI-Anbieter aus der Datenbank.
// Nichts davon steht fest im Code (siehe Konzept „Nichts ist fest hinterlegt").

import { decryptSecret } from "./crypto.ts";
import type { CallLog, LlmDeps, Provider, ProviderType, TaskSetting } from "./llm.ts";
import { type AiTask, DEFAULT_FOLDER_NAMES, type FolderNames } from "./types.ts";

export async function getConfig<T>(sb: any, key: string, fallback: T): Promise<T> {
  const { data } = await sb.from("email_config").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? fallback) as T;
}

export async function setConfig(sb: any, key: string, value: unknown): Promise<void> {
  const { error } = await sb.from("email_config").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export const folderNames = async (sb: any): Promise<FolderNames> =>
  ({ ...DEFAULT_FOLDER_NAMES, ...(await getConfig<Partial<FolderNames>>(sb, "folders", {})) });

export const encryptionKey = (): string | undefined => (globalThis as any).Deno?.env?.get("EMAIL_ENCRYPTION_KEY");

/** Passwort eines Postfachs im Klartext — nur im Speicher der Function, nie loggen. */
export async function accountPassword(acc: { password_enc: string | null }): Promise<string> {
  if (!acc.password_enc) throw new Error("Fuer dieses Postfach ist noch kein Passwort hinterlegt.");
  return await decryptSecret(acc.password_enc, encryptionKey());
}

async function providerFrom(row: any | undefined | null): Promise<Provider | null> {
  if (!row || row.enabled === false) return null;
  let apiKey: string | null = null;
  if (row.api_key_enc) {
    try {
      apiKey = await decryptSecret(row.api_key_enc, encryptionKey());
    } catch {
      apiKey = null; // Fehlermeldung kommt beim Aufruf („hat keinen API-Schluessel")
    }
  }
  return {
    id: row.id, name: row.name, type: row.type as ProviderType, base_url: row.base_url ?? null,
    account_id: row.account_id ?? null, api_key: apiKey,
  };
}

/** Kosten dieses Monats (UTC) in US-Dollar: Anthropic direkt + Cloudflare-Neurons ueber dem Gratis-Kontingent nicht abgezogen (konservativ). */
export async function monthCostUsd(sb: any, prices?: Record<string, any>): Promise<number> {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const { data } = await sb.from("email_ai_calls").select("cost_usd, neurons").gte("created_at", start.toISOString());
  const p = prices ?? (await getConfig<Record<string, any>>(sb, "llm_prices", {}));
  const neurons = (data || []).reduce((n: number, r: any) => n + Number(r.neurons || 0), 0);
  const usd = (data || []).reduce((n: number, r: any) => n + Number(r.cost_usd || 0), 0);
  return usd + (neurons / 1000) * Number(p?._neuron_usd_per_1000 ?? 0.011);
}

/** Verdrahtet die KI-Schicht mit der Datenbank: Einstellungen, Tageskontingent, Protokoll. */
export async function buildLlmDeps(sb: any): Promise<LlmDeps> {
  const [{ data: provRows }, { data: setRows }] = await Promise.all([
    sb.from("email_ai_providers").select("*"),
    sb.from("email_ai_settings").select("*"),
  ]);
  const prices = await getConfig<Record<string, any>>(sb, "llm_prices", {});
  const providers = new Map<string, Provider | null>();
  for (const r of provRows || []) providers.set(r.id, await providerFrom(r));
  const settings = new Map<string, any>((setRows || []).map((r: any) => [r.task, r]));

  let usedToday: number | null = null;
  const budget = await getConfig<{ monthly_usd?: number | null }>(sb, "budget", {});
  const limit = budget?.monthly_usd != null ? Number(budget.monthly_usd) : null;
  let spent: number | null = null;
  return {
    prices,
    async budgetExceeded(): Promise<boolean> {
      if (limit == null || limit <= 0) return false;
      if (spent == null) spent = await monthCostUsd(sb, prices);
      return spent >= limit;
    },
    async getSetting(task: AiTask): Promise<TaskSetting | null> {
      const s = settings.get(task);
      if (!s) return null;
      return {
        task, provider: providers.get(s.provider_id) ?? null, model: s.model,
        fallback: providers.get(s.fallback_provider_id) ?? null, fallbackModel: s.fallback_model ?? null,
        shadow: providers.get(s.shadow_provider_id) ?? null, shadowModel: s.shadow_model ?? null,
        onLimit: s.on_limit, dailyNeuronLimit: s.daily_neuron_limit,
      };
    },
    async neuronsUsedToday(): Promise<number> {
      if (usedToday == null) {
        const start = new Date(); start.setUTCHours(0, 0, 0, 0);
        const { data } = await sb.from("email_ai_calls").select("neurons").eq("provider_type", "cloudflare").gte("created_at", start.toISOString());
        usedToday = (data || []).reduce((n: number, r: any) => n + Number(r.neurons || 0), 0);
      }
      return usedToday ?? 0;
    },
    async logCall(c: CallLog): Promise<void> {
      if (c.providerType === "cloudflare" && usedToday != null) usedToday += c.neurons;
      if (spent != null) spent += c.costUsd + (c.neurons / 1000) * Number(prices?._neuron_usd_per_1000 ?? 0.011);
      await sb.from("email_ai_calls").insert({
        message_id: c.messageId ?? null, task: c.task, provider_id: c.providerId, provider_type: c.providerType,
        model: c.model, tokens_in: c.usage.tokensIn, tokens_out: c.usage.tokensOut, neurons: c.neurons,
        cost_usd: c.costUsd, ok: c.ok, fallback: c.fallback, error: c.error ?? null,
      });
    },
  };
}
