// Wendet die Projekt-Regeln an (Karten anlegen/aktualisieren/schliessen, Wiedervorlagen wecken).
// Taeglich 6:30 als Waisen-Check (pg_cron, x-cron-secret) und per Klick aus der Mail-App. Rein lesend gegenueber HERO.

import { createClient } from "@supabase/supabase-js";
import { fail, isCronCall, ok, preflight, requireMailUser } from "../_shared/email/http.ts";
import { evaluateAll } from "../_shared/projects/evaluate.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await isCronCall(req, sb)) && !(await requireMailUser(req, sb))) return fail("Nicht angemeldet.", { code: "unauthorized" });
  try {
    const stats = await evaluateAll(sb);
    await sb.from("project_runs").insert({ kind: "evaluate", ok: true, stats });
    return ok(stats);
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 400);
    await sb.from("project_runs").insert({ kind: "evaluate", ok: false, error: msg });
    return fail(msg);
  }
});
