// „Verstehen" (email-process, Teil 1): Regeln vor KI, dann ein Modellaufruf je Mail.
//
// Wie `sync.ts` kennt der Kern nur Schnittstellen (Store, LLM-Abhaengigkeiten),
// damit er ohne Netz und Datenbank getestet werden kann.

import {
  buildUnderstandRequest, classifyByRules, UnderstandSchema,
  type FeedbackExample, type RuleRow, type Understanding,
} from "./classify.ts";
import { BudgetExceededError, LimitWaitError, runShadow, runTask, type LlmDeps } from "./llm.ts";
import type { Category, Direction, MessageStatus } from "./types.ts";

export const UNDERSTAND_BATCH = 20;
export const MAX_ATTEMPTS = 3;

export interface PendingMessage {
  id: string;
  account_id: string;
  direction: Direction;
  from_addr: string;
  from_name: string;
  to_addrs: string[];
  subject: string;
  sent_at: string | null;
  body_text: string | null;
  headers: Record<string, unknown>;
  attempts: number;
  status: MessageStatus;
}

export interface AttachmentInfo { id: string; filename: string; mime: string; size: number }

export interface UnderstandPatch {
  status: MessageStatus;
  category: Category | null;
  confidence: number | null;
  summary: string | null;
  extracted: Record<string, unknown>;
  tokens_in: number;
  tokens_out: number;
  attempts: number;
  error: string | null;
}

export interface UnderstandStore {
  loadPending(accountId: string, limit: number): Promise<PendingMessage[]>;
  loadAttachments(messageId: string): Promise<AttachmentInfo[]>;
  saveUnderstanding(id: string, patch: UnderstandPatch): Promise<void>;
  setAttachmentRoles(messageId: string, roles: { filename: string; role: string }[]): Promise<void>;
  markError(id: string, attempts: number, error: string): Promise<void>;
  saveShadow(messageId: string, task: string, row: { provider_name: string; model: string; result: unknown; error: string | null }): Promise<void>;
}

export interface UnderstandContext {
  companyKnowledge: string;
  rules: RuleRow[];
  examples: FeedbackExample[];
  /** Im Schattenmodus laeuft der Vergleichs-Anbieter parallel mit. */
  shadowMode: boolean;
}

export interface UnderstandSummary {
  processed: number; errors: number; waiting: boolean; budget?: boolean;
  tokensIn: number; tokensOut: number; neurons: number; costUsd: number;
}

export async function understandPending(
  accountId: string, store: UnderstandStore, ctx: UnderstandContext, llm: LlmDeps, limit = UNDERSTAND_BATCH,
): Promise<UnderstandSummary> {
  const sum: UnderstandSummary = { processed: 0, errors: 0, waiting: false, tokensIn: 0, tokensOut: 0, neurons: 0, costUsd: 0 };
  const pending = await store.loadPending(accountId, limit);

  for (const m of pending) {
    try {
      // Ausgehende Mails werden nicht klassifiziert (Konzept); sie werden spaeter nur zugeordnet und protokolliert.
      if (m.direction === "out") {
        await store.saveUnderstanding(m.id, {
          status: "klassifiziert", category: null, confidence: null, summary: null,
          extracted: { _meta: { source: "ausgehend" } }, tokens_in: 0, tokens_out: 0, attempts: m.attempts, error: null,
        });
        sum.processed++;
        continue;
      }

      const hit = classifyByRules({ from: m.from_addr, headers: m.headers }, ctx.rules);
      if (hit) {
        await store.saveUnderstanding(m.id, {
          status: "klassifiziert", category: hit.category, confidence: 1,
          summary: m.subject.slice(0, 200) || null,
          extracted: { _meta: { source: hit.source, rule_id: hit.rule?.id ?? null, protect: hit.protect } },
          tokens_in: 0, tokens_out: 0, attempts: m.attempts, error: null,
        });
        sum.processed++;
        continue;
      }

      const attachments = await store.loadAttachments(m.id);
      const req = buildUnderstandRequest(
        { companyKnowledge: ctx.companyKnowledge, examples: ctx.examples },
        {
          from: m.from_addr, fromName: m.from_name, to: m.to_addrs, subject: m.subject, sentAt: m.sent_at,
          attachments: attachments.map((a) => ({ filename: a.filename, mime: a.mime, size: a.size })),
          body: m.body_text ?? "",
        },
      );
      const r = await runTask("understand", req, UnderstandSchema, llm, { messageId: m.id });
      const u: Understanding = r.data;
      await store.saveUnderstanding(m.id, {
        status: "klassifiziert",
        category: u.category,
        confidence: u.category_confidence,
        summary: u.request.summary,
        extracted: { ...u, _meta: { source: "ki", provider: r.providerName, model: r.model, fallback: r.usedFallback, protect: false } },
        tokens_in: r.usage.tokensIn, tokens_out: r.usage.tokensOut, attempts: m.attempts, error: null,
      });
      if (u.attachments.length) await store.setAttachmentRoles(m.id, u.attachments);
      sum.processed++;
      sum.tokensIn += r.usage.tokensIn; sum.tokensOut += r.usage.tokensOut;
      sum.neurons += r.neurons; sum.costUsd += r.costUsd;

      if (ctx.shadowMode) {
        const sh = await runShadow("understand", req, UnderstandSchema, llm, { messageId: m.id });
        if (sh) {
          await store.saveShadow(m.id, "understand", {
            provider_name: sh.providerName, model: sh.model, result: sh.data ?? null, error: sh.error ?? null,
          });
        }
      }
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        // Ohne KI weiter: die Mail bleibt unklassifiziert im Posteingang, kann aber ueber Thread oder
        // Projektnummer noch zugeordnet und protokolliert werden.
        await store.saveUnderstanding(m.id, {
          status: "klassifiziert", category: null, confidence: null, summary: m.subject.slice(0, 200) || null,
          extracted: { _meta: { source: "budget" } }, tokens_in: 0, tokens_out: 0, attempts: m.attempts, error: null,
        });
        sum.processed++;
        sum.budget = true;
        continue;
      }
      if (e instanceof LimitWaitError) {
        // Kein Fehlversuch: die Mail bleibt unveraendert liegen und kommt nach Mitternacht dran.
        sum.waiting = true;
        break;
      }
      sum.errors++;
      await store.markError(m.id, m.attempts + 1, String((e as Error)?.message || e).slice(0, 500));
    }
  }
  return sum;
}
