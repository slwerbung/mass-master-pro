// Postfach testen und einrichten (Aufruf aus den Einstellungen der Mail-App).
//
//   { accountId }                          gespeichertes Postfach testen
//   { host, port, username, password }     neues Postfach testen, bevor es gespeichert wird
//   { ..., setup: true }                   zusaetzlich fehlende Zielordner anlegen und die
//                                          Ordnerzuordnung am Postfach speichern
//
// Das ist zugleich der Phase-0-Test in der ECHTEN Edge Runtime: Login -> Ordnerliste
// -> bis zu 50 Mails holen und parsen, mit Laufzeiten. Gelesen wird nur; geschrieben
// wird hoechstens beim Anlegen fehlender Ordner (setup) – nie geloescht, nie gesendet.

import { createClient } from "@supabase/supabase-js";
import { fail, ok, preflight, readJson, requireAdmin } from "../_shared/email/http.ts";
import { accountPassword, folderNames } from "../_shared/email/config.ts";
import { ensureFolders, fetchNew, listFolders, withImap, type ImapCreds } from "../_shared/email/imap.ts";
import { planFolders } from "../_shared/email/folders.ts";
import { parseRaw } from "../_shared/email/parseRaw.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const admin = await requireAdmin(req, sb);
  if (!admin) return fail("Nicht angemeldet oder keine Admin-Rolle.", { code: "unauthorized" });

  const body = await readJson(req);
  const t0 = performance.now();
  try {
    let creds: ImapCreds;
    let account: any = null;
    if (body.accountId) {
      const { data } = await sb.from("email_accounts").select("*").eq("id", body.accountId).maybeSingle();
      if (!data) return fail("Postfach nicht gefunden.");
      account = data;
      // Ein neues Passwort im Formular hat Vorrang vor dem gespeicherten.
      const pass = body.password ? String(body.password) : await accountPassword(data);
      creds = { host: data.imap_host, port: data.imap_port, user: data.username, pass };
    } else {
      if (!body.host || !body.username || !body.password) return fail("Server, Benutzername und Passwort fehlen.");
      creds = { host: String(body.host), port: Number(body.port) || 993, user: String(body.username), pass: String(body.password) };
    }

    const out: Record<string, unknown> = { runtime: `Deno ${Deno.version.deno}` };
    let step = "Verbindung";
    const deadline = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Zeitlimit (90 s) im Schritt „${step}“`)), 90_000));
    await Promise.race([deadline, withImap(creds, async (client) => {
      step = "Ordnerliste";
      out.connectMs = Math.round(performance.now() - t0);
      const folders = await listFolders(client);
      const delim = ((await client.list()) as any[])[0]?.delimiter || "/";
      const names = await folderNames(sb);
      const plan = planFolders(folders, names, delim);
      out.folders = folders.map((f) => ({ path: f.path, specialUse: f.specialUse }));
      out.plan = plan;

      if (body.setup) {
        out.created = await ensureFolders(client, folders, plan.toCreate);
        if (account) {
          await sb.from("email_accounts").update({ folder_map: plan.map }).eq("id", account.id);
        }
      }

      // Probeabruf: nur lesen, nichts speichern.
      step = "Probeabruf";
      const t1 = performance.now();
      const res = await fetchNew(client, plan.map.inbox || "INBOX", { lastUid: null, uidValidity: null, limit: 5, backfill: 5 });
      let parsed = 0, failed = 0, withAttachments = 0;
      for (const m of res.messages) {
        try {
          const p = await parseRaw(m.source);
          parsed++;
          if (p.attachments.length) withAttachments++;
        } catch {
          failed++;
        }
      }
      out.inbox = {
        exists: res.state.exists, uidValidity: res.state.uidValidity, fetched: res.messages.length,
        parsed, parseFailed: failed, withAttachments, ms: Math.round(performance.now() - t1),
      };
    })]);
    out.totalMs = Math.round(performance.now() - t0);

    await sb.from("email_runs").insert({
      account_id: account?.id ?? null, kind: "test", finished_at: new Date().toISOString(),
      fetched: (out.inbox as any)?.fetched ?? 0, note: `Test ok (${out.totalMs} ms)`,
    });
    return ok(out);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    // Das Passwort steht nie in einer Fehlermeldung; trotzdem ausschneiden, falls ein Server es zurueckspiegelt.
    const safe = body.password ? msg.split(String(body.password)).join("***") : msg;
    return fail(`Verbindung fehlgeschlagen: ${safe.slice(0, 300)}`, { runtime: `Deno ${Deno.version.deno}`, ms: Math.round(performance.now() - t0) });
  }
});

