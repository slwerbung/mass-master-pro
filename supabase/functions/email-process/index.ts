// Verarbeiten: Verstehen -> Zuordnen -> Handeln (pg_cron als Nachzuegler, und am Ende von email-sync).
//
// Jede Stufe schreibt ihren Stand in die Datenbank; ein Fehler haelt nur die eine
// Mail an, der naechste Lauf macht dort weiter. Max. 20 Mails je Stufe und Aufruf
// (Laufzeitgrenze der Edge Function).

import { createClient } from "@supabase/supabase-js";
import { fail, isCronCall, ok, preflight, readJson, requireAdmin } from "../_shared/email/http.ts";
import { accountPassword, buildLlmDeps, getConfig } from "../_shared/email/config.ts";
import { normalizeAutopilot } from "../_shared/email/autopilot.ts";
import { actPending, type ActContext } from "../_shared/email/act.ts";
import { actHero, matchHero } from "../_shared/email/heroAdapters.ts";
import { buildExtra } from "../_shared/email/extras.ts";
import { imapDraftWriter } from "../_shared/email/draftMime.ts";
import { projectDraftContext } from "../_shared/email/hero.ts";
import { directUploader } from "../_shared/email/uploader.ts";
import { offerSuggester } from "../_shared/email/offerWiring.ts";
import { makeForwarder } from "../_shared/email/forwardWiring.ts";
import { loadHeroKey } from "../_shared/email/hero.ts";
import { LazyImap } from "../_shared/email/lazyImap.ts";
import { matchPending } from "../_shared/email/matchStage.ts";
import {
  actStore, claimAccount, draftStore, loadExamples, loadRules, matchStore, recordRun, releaseAccount, understandStore,
} from "../_shared/email/store.ts";
import { understandPending } from "../_shared/email/understand.ts";
import type { Gewerk } from "../_shared/email/gewerke.ts";
import type { StepIds } from "../_shared/email/steps.ts";

const COMPANY_NAME = "SL WERBUNG";

async function processOne(sb: any, id: string) {
  const acc = await claimAccount(sb, id);
  if (!acc) return { accountId: id, skipped: "gesperrt oder unbekannt" };
  const started = new Date().toISOString();
  let imap: LazyImap | null = null;
  try {
    const llm = await buildLlmDeps(sb);
    const [rules, examples, knowledge, heroCfg, gewerke, heroKey] = await Promise.all([
      loadRules(sb), loadExamples(sb), getConfig<string>(sb, "company_knowledge", ""),
      getConfig<any>(sb, "hero", {}), getConfig<Gewerk[]>(sb, "gewerke", []), loadHeroKey(sb),
    ]);

    // 1. Verstehen
    const u = await understandPending(
      id, understandStore(sb), { companyKnowledge: knowledge, rules, examples, shadowMode: !!acc.shadow_mode }, llm,
    );

    // 2. Zuordnen
    const excluded: number[] = heroCfg.excluded_steps ?? [];
    const hero = heroKey ? matchHero(sb, heroKey, excluded) : null;
    const t = await matchPending(
      id, matchStore(sb), hero,
      { prefixes: gewerke.map((g) => g.short).filter(Boolean), ownAddresses: [acc.address, acc.username] }, llm,
    );

    // 3. Handeln
    const fm = acc.folder_map || {};
    const actCtx: ActContext = {
      autopilot: normalizeAutopilot(acc.autopilot), shadowMode: !!acc.shadow_mode,
      inbox: fm.inbox || "INBOX", folders: fm.folders || {}, steps: (heroCfg.steps ?? {}) as StepIds,
      gewerke, accountLabel: acc.label || acc.address,
    };
    const lazy = new LazyImap({ host: acc.imap_host, port: acc.imap_port, user: acc.username, pass: await accountPassword(acc) });
    imap = lazy;

    // Phase 3: Antwortentwuerfe und Anhaenge. Der Entwurf wird nur ins Postfach geschrieben, wenn der
    // Entwuerfe-Ordner bekannt ist; sonst bleibt er in der Mail-App.
    const replyRules = await getConfig<string>(sb, "reply_rules", "");
    const lexoffice = await getConfig<{ address?: string }>(sb, "lexoffice", {});
    const writer = fm.drafts
      ? imapDraftWriter(() => lazy.raw(), { drafts: fm.drafts, trash: fm.trash ?? null, fromName: COMPANY_NAME, fromAddress: acc.address })
      : null;
    actCtx.extra = buildExtra({
      docTypes: heroCfg.document_types ?? {},
      offer: heroKey ? offerSuggester(sb, llm, heroKey) : null,
      forward: lexoffice?.address ? makeForwarder(sb, acc, String(lexoffice.address), lazy, COMPANY_NAME, await accountPassword(acc)) : null,
      draft: {
        canWrite: !!writer,
        deps: {
          llm, store: draftStore(sb), writer, knowledge, replyRules, signature: acc.signature || "",
          heroContext: heroKey ? (pid) => projectDraftContext(heroKey, pid) : null,
        },
      },
    });
    const a = await actPending(id, actCtx, {
      imap: lazy, hero: heroKey ? actHero(heroKey) : null, store: actStore(sb),
      uploader: heroKey ? directUploader(sb, heroKey) : null,
    });

    await releaseAccount(sb, id);
    const waiting = u.waiting || t.waiting;
    await recordRun(sb, {
      account_id: id, kind: "process", started_at: started,
      processed: u.processed + t.processed + a.processed, errors: u.errors + t.errors + a.errors,
      tokens_in: u.tokensIn, tokens_out: u.tokensOut, neurons: u.neurons,
      note: [
        waiting ? "KI-Tageskontingent erschoepft – Rest wartet bis Mitternacht (UTC)" : null,
        `verstanden ${u.processed}, zugeordnet ${t.matched}/${t.processed}, gehandelt ${a.processed} (verschoben ${a.moved}, Logbuch ${a.logged}, Vorschlaege ${a.suggestions})`,
        heroKey ? null : "HERO nicht aktiv",
      ].filter(Boolean).join(" · "),
    });
    return { accountId: id, understood: u, matched: t, acted: a };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 300);
    await releaseAccount(sb, id, { last_error: msg });
    await recordRun(sb, { account_id: id, kind: "process", started_at: started, errors: 1, note: msg });
    return { accountId: id, error: msg };
  } finally {
    await imap?.close();
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
