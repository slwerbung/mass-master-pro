// Rueckkehr aus HERO (Phase 4, Arbeitsmodus): Ergebnis speichern (Erledigt / Teilweise / Problem), bei „Erledigt“ das Projekt
// in HERO neu LESEN und mit dem Vorher-Stand vergleichen. Passt es, wird die Karte geschlossen (Logbuch nur ausserhalb des
// Schattenmodus); passt es nicht, bleibt sie offen mit Hinweis. Diese Function sendet nie Mails und aendert nichts in HERO
// ausser dem Logbuch-Eintrag.
//
//   POST { taskId, result: "done" | "partial" | "problem", note? }  ->  { ok: true, data: { passed, closed, message, changes } }

import { createClient } from "@supabase/supabase-js";
import { fail, ok, preflight, readJson, requireMailUser } from "../_shared/email/http.ts";
import { addLogbookEntry, heroGraphql, loadHeroKey } from "../_shared/email/hero.ts";
import { isShadow } from "../_shared/projects/access.ts";
import { finishTask, parseChecklists, readProjectState, type TaskResult } from "../_shared/projects/heroTask.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user = await requireMailUser(req, sb);
  if (!user) return fail("Nicht angemeldet oder kein Zugang zur Mail-App.", { code: "unauthorized" });
  const body = await readJson(req);
  try {
    const key = await loadHeroKey(sb);
    if (!key) return fail("HERO ist nicht aktiv (app_config hero_enabled / hero_api_key).");
    const { data: cl } = await sb.from("app_config").select("value").eq("key", "projects_checklists").maybeSingle();
    const r = await finishTask(sb, {
      readState: (id) => readProjectState((k, q, v) => heroGraphql(k, q, v), key, id),
      logbook: (id, text) => addLogbookEntry(key, id, text),
      shadow: await isShadow(sb),
      checklists: parseChecklists(cl?.value),
    }, { taskId: String(body.taskId || ""), result: String(body.result || "") as TaskResult, note: body.note, actor: { id: user.id, name: user.name || user.email || "Mitarbeiter", isAdmin: user.role === "admin" } });
    return ok(r);
  } catch (e) {
    return fail(String((e as Error)?.message || e).slice(0, 300));
  }
});
