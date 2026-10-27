// Postfach-Aktionen der Mail-App, die IMAP brauchen:
//
//   { action: "body", id, refresh? }   HTML-Ansicht einer Mail (aus dem Postfach, zwischengespeichert in body_html)
//   { action: "trash", ids }           in den Papierkorb des Postfachs VERSCHIEBEN (nie endgueltig loeschen)
//   { action: "restore", ids }         aus dem Papierkorb zurueck in den Posteingang
//
// Nur mit Admin-Sitzung. Antwort immer HTTP 200 mit { ok, data | error }.

import { createClient } from "@supabase/supabase-js";
import { simpleParser } from "mailparser";
import { Buffer } from "node:buffer";
import { fail, ok, preflight, readJson, requireAdmin } from "../_shared/email/http.ts";
import { accountPassword } from "../_shared/email/config.ts";
import { fetchSource, findUidByMessageId, moveMessage, withImap } from "../_shared/email/imap.ts";
import { mailHtml, MAX_CACHE_CHARS } from "../_shared/email/mailHtml.ts";

const MAX_IDS = 100;
const COLS = "id, account_id, message_id, folder, uid, current_folder, current_uid, trashed_at, body_html, body_text";

async function account(sb: any, id: string) {
  const { data } = await sb.from("email_accounts").select("*").eq("id", id).maybeSingle();
  if (!data) throw new Error("Postfach nicht gefunden.");
  return { acc: data, creds: { host: data.imap_host, port: data.imap_port, user: data.username, pass: await accountPassword(data) } };
}

/** Wo liegt die Mail gerade? Suche per Message-ID – eine gespeicherte UID kann nach Verschieben in Thunderbird veraltet sein. */
async function locate(client: any, m: any, extra: string[] = []): Promise<{ folder: string; uid: number } | null> {
  const folders = [...new Set([m.current_folder, m.folder, ...extra].filter(Boolean))] as string[];
  for (const f of folders) {
    const uid = await findUidByMessageId(client, f, m.message_id).catch(() => null);
    if (uid != null) return { folder: f, uid };
  }
  return null;
}

const handlers: Record<string, (sb: any, body: any) => Promise<unknown>> = {
  async body(sb, body) {
    const { data: m } = await sb.from("email_messages").select(COLS).eq("id", String(body.id || "")).maybeSingle();
    if (!m) throw new Error("Mail nicht gefunden.");
    if (m.body_html && !body.refresh) return { html: m.body_html, kind: "html", source: "cache" };
    try {
      const { acc, creds } = await account(sb, m.account_id);
      const fm = acc.folder_map || {};
      const r = await withImap(creds, async (client) => {
        const at = await locate(client, m, [fm.inbox || "INBOX", fm.sent, ...Object.values(fm.folders || {})].filter(Boolean) as string[]);
        if (!at) return null;
        const src = await fetchSource(client, at.folder, at.uid);
        return src ? { at, src } : null;
      });
      if (!r) {
        // Nicht (mehr) im Postfach: der gespeicherte Text ist alles, was es gibt.
        return { html: null, kind: "missing", text: m.body_text, source: "none" };
      }
      const view = mailHtml(await simpleParser(Buffer.from(r.src) as any));
      const patch: Record<string, unknown> = { current_folder: r.at.folder, current_uid: r.at.uid };
      if (view.html.length <= MAX_CACHE_CHARS) patch.body_html = view.html;
      await sb.from("email_messages").update(patch).eq("id", m.id);
      return { html: view.html, kind: view.kind, source: "imap" };
    } catch (e) {
      // Postfach nicht erreichbar o. Ae.: wenigstens den gespeicherten Text zeigen.
      return { html: null, kind: "missing", text: m.body_text, source: "none", error: String((e as Error).message).slice(0, 200) };
    }
  },

  async trash(sb, body) {
    return await moveMany(sb, body, "trash");
  },

  async restore(sb, body) {
    return await moveMany(sb, body, "restore");
  },
};

async function moveMany(sb: any, body: any, mode: "trash" | "restore") {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, MAX_IDS);
  if (!ids.length) throw new Error("Keine Mails ausgewählt.");
  const { data: rows } = await sb.from("email_messages").select(COLS).in("id", ids);
  const byAccount = new Map<string, any[]>();
  for (const m of rows || []) (byAccount.get(m.account_id) ?? byAccount.set(m.account_id, []).get(m.account_id)!).push(m);

  let moved = 0;
  const notInMailbox: string[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();
  for (const [accountId, msgs] of byAccount) {
    const { acc, creds } = await account(sb, accountId);
    const fm = acc.folder_map || {};
    const inbox = fm.inbox || "INBOX";
    const dest = mode === "trash" ? fm.trash : inbox;
    if (!dest) { errors.push(`${acc.label || acc.address}: Papierkorb-Ordner unbekannt – Einstellungen → Postfächer → „Ordner anlegen & speichern“.`); continue; }
    await withImap(creds, async (client) => {
      for (const m of msgs) {
        if (mode === "trash" ? m.trashed_at : !m.trashed_at) continue; // schon dort
        try {
          const at = await locate(client, m, mode === "trash" ? [inbox] : [fm.trash]);
          let patch: Record<string, unknown>;
          if (!at) {
            // Im Postfach schon weg (z. B. in Thunderbird geloescht): nur in der App ein-/ausblenden.
            notInMailbox.push(m.id);
            patch = mode === "trash" ? { trashed_at: now } : { trashed_at: null };
          } else if (at.folder === dest) {
            patch = { trashed_at: mode === "trash" ? now : null, current_folder: dest, current_uid: at.uid };
          } else {
            const uid = await moveMessage(client, at.folder, at.uid, dest);
            patch = { trashed_at: mode === "trash" ? now : null, current_folder: dest, current_uid: uid };
            moved++;
          }
          // Im Papierkorb gibt es nichts mehr zu tun: offene Vorschlaege verwerfen, nicht weiter verarbeiten.
          if (mode === "trash") {
            patch.status = "erledigt";
            await sb.from("email_suggestions").update({ status: "abgelehnt", decided_at: now, result: { reason: "Papierkorb" } })
              .eq("message_id", m.id).eq("status", "offen");
          }
          await sb.from("email_messages").update(patch).eq("id", m.id);
        } catch (e) {
          errors.push(`${String((e as Error).message).slice(0, 120)}`);
        }
      }
    });
  }
  return { moved, notInMailbox: notInMailbox.length, errors };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await requireAdmin(req, sb))) return fail("Nicht angemeldet oder keine Admin-Rolle.", { code: "unauthorized" });
  const body = await readJson(req);
  const h = handlers[String(body.action || "")];
  if (!h) return fail("Unbekannte Aktion.");
  try {
    return ok(await h(sb, body));
  } catch (e) {
    return fail(String((e as Error)?.message || e).slice(0, 300));
  }
});
