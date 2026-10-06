// Verarbeiten: Verstehen -> Zuordnen -> Handeln (pg_cron als Nachzuegler, und am Ende von email-sync).
//
// Jede Stufe schreibt ihren Stand in die Datenbank; ein Fehler haelt nur die eine
// Mail an, der naechste Lauf macht dort weiter. Max. 20 Mails je Aufruf
// (Laufzeitgrenze der Edge Function).

import { createClient } from "@supabase/supabase-js";
import { fail, isCronCall, ok, preflight, readJson, requireAdmin } from "../_shared/email/http.ts";
import { buildLlmDeps, getConfig } from "../_shared/email/config.ts";
import { claimAccount, loadExamples, loadRules, recordRun, releaseAccount, understandStore } from "../_shared/email/store.ts";
import { understandPending } from "../_shared/email/understand.ts";

async function processOne(sb: any, id: string) {
  const acc = await claimAccount(sb, id);
  if (!acc) return { accountId: id, skipped: "gesperrt oder unbekannt" };
  const started = new Date().toISOString();
  try {
    const llm = await buildLlmDeps(sb);
    const [rules, examples, knowledge] = await Promise.all([
      loadRules(sb), loadExamples(sb), getConfig<string>(sb, "company_knowledge", ""),
    ]);
    const u = await understandPending(
      id, understandStore(sb),
      { companyKnowledge: knowledge, rules, examples, shadowMode: !!acc.shadow_mode },
      llm,
    );
    await releaseAccount(sb, id);
    await recordRun(sb, {
      account_id: id, kind: "process", started_at: started, processed: u.processed, errors: u.errors,
      tokens_in: u.tokensIn, tokens_out: u.tokensOut, neurons: u.neurons,
      note: u.waiting ? "KI-Tageskontingent erschoepft – Rest wartet bis Mitternacht (UTC)" : null,
    });
    return { accountId: id, ...u };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 300);
    await releaseAccount(sb, id, { last_error: msg });
    await recordRun(sb, { account_id: id, kind: "process", started_at: started, errors: 1, note: msg });
    return { accountId: id, error: msg };
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await isCronCall(req, sb)) && !(await requireAdmin(req, sb))) return fail("Nicht erlaubt.", { code: "unauthorized" });

  const body = await readJson(req);
  let ids: string[] = body.accountId ? [String(body.accountId)] : [];
  if (!ids.length) {
    const { data } = await sb.from("email_accounts").select("id").eq("enabled", true);
    ids = (data || []).map((r: any) => r.id);
  }
  const results = [];
  for (const id of ids) results.push(await processOne(sb, id));
  return ok(results);
});
