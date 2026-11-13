// Autopilot „Automatisch“ (pg_cron stuendlich, Header x-cron-secret): sendet faellige Nachfass-Entwuerfe im Versandfenster.
// Der Runner sendet nie selbst: er waehlt Entwuerfe aus und ruft den Autopilot-Weg von email-send auf, der alles noch einmal
// prueft (Autopilot, offene Karte, Fenster, Tageslimit, Kundenantwort). Im Schattenmodus passiert nichts.
//
//   POST {} -> { ok: true, data: { sent, failed, errors, skipped? } }

import { createClient } from "@supabase/supabase-js";
import { fail, isCronCall, ok, preflight } from "../_shared/email/http.ts";
import { isShadow } from "../_shared/projects/access.ts";
import { evaluateAll } from "../_shared/projects/evaluate.ts";
import { inSendWindow, parseWindow } from "../_shared/projects/followup.ts";
import { selectAutoDrafts } from "../_shared/projects/followupSend.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await isCronCall(req, sb))) return fail("Nicht erlaubt.", { code: "forbidden" });

  try {
    if (await isShadow(sb)) return ok({ sent: 0, failed: 0, errors: [], skipped: "Schattenmodus" });
    const cfg = await sb.from("app_config").select("key, value").in("key", ["projects_followup_hours", "projects_auto_max_per_run"]);
    const c = new Map<string, string>((cfg.data || []).map((r: any) => [r.key, r.value]));
    if (!inSendWindow(new Date(), parseWindow(c.get("projects_followup_hours")))) return ok({ sent: 0, failed: 0, errors: [], skipped: "Außerhalb des Versandfensters" });

    // Frisch halten: Kundenantworten erkennen (stoppt die Kette), Entwuerfe aktualisieren – rein lokal.
    await evaluateAll(sb);
    const ids = await selectAutoDrafts(sb, Number(c.get("projects_auto_max_per_run")) || 5);

    let sent = 0, failed = 0;
    const errors: string[] = [];
    for (const draftId of ids) {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/email-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": req.headers.get("x-cron-secret") || "" },
        body: JSON.stringify({ action: "send_followup_auto", draftId }),
      });
      const j = await r.json().catch(() => null);
      if (j?.ok && !j.data?.shadow) sent++;
      else { failed++; errors.push(String(j?.error || `HTTP ${r.status}`).slice(0, 200)); }
    }
    return ok({ sent, failed, errors });
  } catch (e) {
    return fail(String((e as Error)?.message || e).slice(0, 300));
  }
});
