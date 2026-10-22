// Aufbewahrung (pg_cron taeglich 03:17): Anhaenge, Mailtexte und HTML-Ansicht nach `retention_days`
// (email_config, Standard 180) loeschen, dazu alte KI-Aufrufe und Laeufe. Die Mail selbst (Absender, Betreff,
// Kategorie, Zuordnung) bleibt; im Postfach wird nichts angefasst.
//
// Nur per Cron-Secret oder Admin-Sitzung. Antwort immer HTTP 200 mit { ok, data | error }.

import { createClient } from "@supabase/supabase-js";
import { fail, isCronCall, ok, preflight, requireAdmin } from "../_shared/email/http.ts";
import { runRetention } from "../_shared/email/retention.ts";

const BUCKET = "email-attachments";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await isCronCall(req, sb)) && !(await requireAdmin(req, sb))) return fail("Nicht erlaubt.", { code: "unauthorized" });
  try {
    const result = await runRetention({
      async due(limit) {
        const { data, error } = await sb.rpc("email_retention_files", { max_rows: limit });
        if (error) throw new Error(error.message);
        return data || [];
      },
      async remove(paths) {
        const { error } = await sb.storage.from(BUCKET).remove(paths);
        if (error) throw new Error(`Anhänge nicht gelöscht: ${error.message}`);
      },
      async clear(ids) {
        const { error } = await sb.from("email_attachments").update({ storage_path: null }).in("id", ids);
        if (error) throw new Error(error.message);
      },
      async finish() {
        const { error } = await sb.rpc("email_retention");
        if (error) throw new Error(error.message);
      },
    });
    await sb.from("email_runs").insert({
      kind: "retention", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      processed: result.files, errors: 0, note: `${result.files} Anhang-Datei(en) gelöscht${result.more ? " – Rest beim nächsten Lauf" : ""}`,
    });
    return ok(result);
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 300);
    await sb.from("email_runs").insert({ kind: "retention", started_at: new Date().toISOString(), finished_at: new Date().toISOString(), errors: 1, note: msg });
    return fail(msg);
  }
});
