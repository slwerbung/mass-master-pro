// Abholen (pg_cron alle 5 Minuten, ein Aufruf je aktivem Postfach; oder per Admin „Jetzt abrufen").
//
// Postfach-Lock (`locked_until`) verhindert, dass zwei Laeufe dasselbe Postfach
// gleichzeitig bearbeiten. Am Ende stoesst die Function email-process an.

import { createClient } from "@supabase/supabase-js";
import { fail, isCronCall, ok, preflight, readJson, requireAdmin } from "../_shared/email/http.ts";
import { accountPassword } from "../_shared/email/config.ts";
import { fetchNew, withImap } from "../_shared/email/imap.ts";
import { parseRaw } from "../_shared/email/parseRaw.ts";
import { claimAccount, recordRun, releaseAccount, syncStore } from "../_shared/email/store.ts";
import { type AccountRow, syncAccount } from "../_shared/email/sync.ts";

async function syncOne(sb: any, id: string, origin: string, cronSecret: string | null, authHeaders: Record<string, string>) {
  const acc = await claimAccount(sb, id);
  if (!acc) return { accountId: id, skipped: "gesperrt oder unbekannt" };
  if (!acc.enabled && cronSecret) {
    await releaseAccount(sb, id);
    return { accountId: id, skipped: "Postfach ist aus" };
  }
  const started = new Date().toISOString();
  try {
    const pass = await accountPassword(acc);
    const store = syncStore(sb);
    const sum = await withImap(
      { host: acc.imap_host, port: acc.imap_port, user: acc.username, pass },
      (client) =>
        syncAccount(acc as AccountRow, {
          store,
          parse: parseRaw,
          imap: {
            fetchNew: async (folder, o) => {
              const r = await fetchNew(client, folder, o);
              return { state: r.state, baseline: r.baseline, messages: r.messages, more: r.more };
            },
          },
        }),
    );
    await releaseAccount(sb, id, { last_sync_at: new Date().toISOString(), last_error: sum.errors ? sum.notes.slice(0, 3).join(" | ") : null });
    await recordRun(sb, {
      account_id: id, kind: "sync", started_at: started, fetched: sum.fetched, processed: sum.stored, errors: sum.errors,
      note: sum.notes.join(" | ").slice(0, 500) || null,
    });
    // Verarbeiten anstossen, ohne zu warten (die Function laeuft dort weiter).
    if (sum.stored > 0) {
      const p = fetch(`${origin}/functions/v1/email-process`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ accountId: id }),
      }).catch(() => {});
      (globalThis as any).EdgeRuntime?.waitUntil?.(p);
    }
    return { accountId: id, ...sum };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 300);
    await releaseAccount(sb, id, { last_error: msg });
    await recordRun(sb, { account_id: id, kind: "sync", started_at: started, errors: 1, note: msg });
    return { accountId: id, error: msg };
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const cron = await isCronCall(req, sb);
  if (!cron && !(await requireAdmin(req, sb))) return fail("Nicht erlaubt.", { code: "unauthorized" });

  const body = await readJson(req);
  const origin = Deno.env.get("SUPABASE_URL")!;
  const cronSecret = cron ? req.headers.get("x-cron-secret") : null;
  // Dieselbe Berechtigung an email-process weitergeben (Cron-Secret oder Admin-Sitzung).
  const authHeaders: Record<string, string> = cron
    ? { "x-cron-secret": cronSecret! }
    : { authorization: req.headers.get("authorization") || "" };
  let ids: string[] = body.accountId ? [String(body.accountId)] : [];
  if (!ids.length) {
    const { data } = await sb.from("email_accounts").select("id").eq("enabled", true);
    ids = (data || []).map((r: any) => r.id);
  }
  const results = [];
  for (const id of ids) results.push(await syncOne(sb, id, origin, cronSecret, authHeaders));
  return ok(results);
});
