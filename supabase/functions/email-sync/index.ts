// Abholen (pg_cron jede Minute, ein Aufruf je aktivem Postfach; oder per Klick auf „Jetzt abrufen“ in der Mail-App:
// Admin fuer alle Postfaecher, ein Mitarbeiter nur fuer seine eigenen).
//
// Postfach-Lock (`locked_until`) verhindert, dass zwei Laeufe dasselbe Postfach
// gleichzeitig bearbeiten. Am Ende stoesst die Function email-process an.

import { createClient } from "@supabase/supabase-js";
import { fail, isCronCall, ok, preflight, readJson, requireMailUser } from "../_shared/email/http.ts";
import { canAccount } from "../_shared/email/access.ts";
import { accountPassword } from "../_shared/email/config.ts";
import { fetchNew, fetchOneSlim, fetchPart, withImap } from "../_shared/email/imap.ts";
import { parseRaw } from "../_shared/email/parseRaw.ts";
import { claimAccount, recordRun, releaseAccount, syncStore } from "../_shared/email/store.ts";
import { type AccountRow, importOne, syncAccount } from "../_shared/email/sync.ts";

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
              return { state: r.state, baseline: r.baseline, messages: r.messages, more: r.more, skipped: r.skipped ?? null };
            },
            fetchOne: async (folder, uid) => {
              const r = await fetchOneSlim(client, folder, uid);
              return { uidValidity: r.state.uidValidity, message: r.message };
            },
            // Anhaenge grosser Mails einzeln (ohne mailparser, siehe bigMail.ts).
            fetchPart: (folder, uid, ref) => fetchPart(client, folder, uid, ref),
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
  const user = cron ? null : await requireMailUser(req, sb);
  if (!cron && !user) return fail("Nicht erlaubt.", { code: "unauthorized" });

  const body = await readJson(req);
  const origin = Deno.env.get("SUPABASE_URL")!;
  const cronSecret = cron ? req.headers.get("x-cron-secret") : null;
  // Dieselbe Berechtigung an email-process weitergeben (Cron-Secret oder Sitzung des Benutzers).
  const authHeaders: Record<string, string> = cron
    ? { "x-cron-secret": cronSecret! }
    : { authorization: req.headers.get("authorization") || "" };
  // Übersprungene Mail nachholen: { accountId, refetch: { folder: "inbox" | "sent", uid } } (Cron-Secret oder Admin).
  if (body.refetch) {
    if (user && user.accountIds !== null) return fail("Nur für Admins.", { code: "forbidden" });
    const id = String(body.accountId || "");
    const key = body.refetch.folder === "sent" ? "sent" : "inbox";
    const uid = Number(body.refetch.uid);
    if (!id || !Number.isInteger(uid) || uid <= 0) return fail("accountId und uid nötig.");
    const acc = await claimAccount(sb, id);
    if (!acc) return fail("Postfach gerade gesperrt oder unbekannt – gleich nochmal versuchen.");
    try {
      const pass = await accountPassword(acc);
      const r = await withImap({ host: acc.imap_host, port: acc.imap_port, user: acc.username, pass }, (client) =>
        importOne(acc as AccountRow, {
          store: syncStore(sb), parse: parseRaw,
          imap: {
            fetchNew: () => Promise.reject(new Error("nicht benutzt")),
            fetchPart: (folder, u, ref) => fetchPart(client, folder, u, ref),
            fetchOne: async (folder, u) => { const x = await fetchOneSlim(client, folder, u); return { uidValidity: x.state.uidValidity, message: x.message }; },
          },
        }, key, uid));
      await releaseAccount(sb, id);
      await recordRun(sb, { account_id: id, kind: "sync", started_at: new Date().toISOString(), fetched: 1, processed: r === "stored" ? 1 : 0, errors: 0, note: `Mail UID ${uid} (${key}) nachgeholt: ${r}` });
      if (r === "stored") {
        const p = fetch(`${origin}/functions/v1/email-process`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ accountId: id }) }).catch(() => {});
        (globalThis as any).EdgeRuntime?.waitUntil?.(p);
      }
      return ok({ result: r });
    } catch (e) {
      await releaseAccount(sb, id);
      return fail(String((e as Error)?.message || e).slice(0, 300));
    }
  }

  let ids: string[] = body.accountId ? [String(body.accountId)] : [];
  if (!ids.length) {
    const { data } = await sb.from("email_accounts").select("id").eq("enabled", true);
    ids = (data || []).map((r: any) => r.id);
  }
  // Mitarbeiter: nur die eigenen Postfaecher.
  if (user) {
    if (body.accountId && !canAccount(user, String(body.accountId))) return fail("Kein Zugriff auf dieses Postfach.", { code: "forbidden" });
    ids = ids.filter((id) => canAccount(user, id));
  }
  const results = [];
  for (const id of ids) results.push(await syncOne(sb, id, origin, cronSecret, authHeaders));
  return ok(results);
});
