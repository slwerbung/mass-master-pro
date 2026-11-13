// Spiegelt alle offenen HERO-Projekte nach hero_projects (pg_cron alle 10 Min, Header x-cron-secret) und
// stoesst danach die Regelauswertung an. Rein LESEND gegenueber HERO.
//   POST {} -> { ok: true, data: { sync, evaluate } } | { ok: false, error }

import { createClient } from "@supabase/supabase-js";
import { fail, isCronCall, ok, preflight, requireMailUser } from "../_shared/email/http.ts";
import { loadHeroKey } from "../_shared/email/hero.ts";
import { syncProjects } from "../_shared/projects/sync.ts";
import { evaluateAll } from "../_shared/projects/evaluate.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await isCronCall(req, sb)) && !(await requireMailUser(req, sb))) return fail("Nicht angemeldet.", { code: "unauthorized" });

  try {
    const key = await loadHeroKey(sb);
    if (!key) return fail("HERO ist nicht aktiv (app_config hero_enabled / hero_api_key).");
    const sync = await syncProjects(sb, key);
    const evaluate = await evaluateAll(sb);
    await sb.from("project_runs").insert([{ kind: "sync", ok: true, stats: sync }, { kind: "evaluate", ok: true, stats: evaluate }]);
    return ok({ sync, evaluate });
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 400);
    await sb.from("project_runs").insert({ kind: "sync", ok: false, error: msg });
    return fail(msg);
  }
});
