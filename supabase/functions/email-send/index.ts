// Mail verfassen und senden aus der Mail-App (Ersatz fuer Thunderbird):
//
//   { action: "accounts" }                               Postfaecher zum Senden (Absender, Signatur, SMTP vorhanden?)
//   { action: "signature_save", accountId, html }        HTML-Signatur eines Postfachs speichern
//   { action: "prepare", replyTo, mode }                 Vorbelegung fuer Antworten / Allen antworten / Weiterleiten
//   { action: "send", accountId, to, cc, bcc, subject, text, replyTo?, mode?, forwardAttachmentIds?, uploads?, discardDraft? }
//
// Gesendet wird nur hier und nur per Klick (Admin-Sitzung) – siehe composeSend.ts. Die gesendete Mail wird in den
// Gesendet-Ordner gelegt; der naechste Abruf uebernimmt sie von dort (Richtung „out“, HERO-Logbuch wie bei Thunderbird).
// Antwort immer HTTP 200 mit { ok, data | error }.

import { createClient } from "@supabase/supabase-js";
import { fail, ok, preflight, readJson, requireMailUser, type MailUser } from "../_shared/email/http.ts";
import { AccessError, assertAccount, scopeAccounts } from "../_shared/email/access.ts";
import { accountPassword } from "../_shared/email/config.ts";
import { addKeywords, findUidByMessageId, moveMessage, withImap } from "../_shared/email/imap.ts";
import { newMessageId } from "../_shared/email/draftMime.ts";
import { storageDownloader } from "../_shared/email/uploader.ts";
import {
  checkRecipients, ComposeError, composeBody, forwardSubject, MAX_ATTACHMENT_BYTES, MAX_SIGNATURE_CHARS, parseAddressList,
  quoteBlock, referenceChain, replyAllRecipients, replySubject, stripTrailingSignature,
} from "../_shared/email/compose.ts";
import { buildComposedMime, sendComposed } from "../_shared/email/composeSend.ts";

const COMPANY_NAME = "SL WERBUNG";
const MSG_COLS = "id, account_id, thread_id, message_id, refs, from_addr, from_name, to_addrs, cc_addrs, subject, sent_at, body_text, folder, current_folder, draft_message_id, draft_uid, draft_text";
type Mode = "reply" | "replyAll" | "forward";
const asMode = (m: unknown): Mode | null => (m === "reply" || m === "replyAll" || m === "forward" ? m : null);

async function loadAccount(sb: any, id: string) {
  const { data } = await sb.from("email_accounts").select("*").eq("id", id).maybeSingle();
  if (!data) throw new ComposeError("Postfach nicht gefunden.");
  return data;
}

async function loadMessage(sb: any, id: string) {
  const { data } = await sb.from("email_messages").select(MSG_COLS).eq("id", id).maybeSingle();
  if (!data) throw new ComposeError("Mail nicht gefunden.");
  return data;
}

async function ownAddresses(sb: any): Promise<string[]> {
  const { data } = await sb.from("email_accounts").select("address, username");
  return (data || []).flatMap((a: any) => [a.address, a.username]).filter((x: string) => x && x.includes("@"));
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(String(b64 || "").replace(/^data:[^,]*,/, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const fromLabel = (m: any) => (m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr);

const handlers: Record<string, (sb: any, body: any, user: MailUser) => Promise<unknown>> = {
  async accounts(sb, _body, user) {
    const { data } = await scopeAccounts(sb.from("email_accounts").select("id, label, address, signature_html, smtp_host, folder_map, enabled"), user, "id").order("created_at");
    return (data || []).map((a: any) => ({
      id: a.id, label: a.label, address: a.address, signatureHtml: a.signature_html ?? "", smtp: !!a.smtp_host,
      sentFolder: a.folder_map?.sent ?? null, enabled: a.enabled,
    }));
  },

  async signature_save(sb, body, user) {
    assertAccount(user, String(body.accountId || ""));
    const html = String(body.html ?? "");
    if (html.length > MAX_SIGNATURE_CHARS) throw new ComposeError("Signatur zu groß (Bilder bitte verlinken statt einbetten).");
    await loadAccount(sb, String(body.accountId || ""));
    const { error } = await sb.from("email_accounts").update({ signature_html: html.trim() || null }).eq("id", String(body.accountId));
    if (error) throw new Error(error.message);
    return { saved: true };
  },

  async prepare(sb, body, user) {
    const mode = asMode(body.mode);
    if (!mode) throw new ComposeError("Unbekannte Art (reply, replyAll, forward).");
    const m = await loadMessage(sb, String(body.replyTo || ""));
    assertAccount(user, m.account_id);
    const own = await ownAddresses(sb);
    const recipients = mode === "forward"
      ? { to: [], cc: [], bcc: [] }
      : mode === "replyAll" ? replyAllRecipients(m, own) : { to: [m.from_addr].filter(Boolean), cc: [], bcc: [] };
    const { data: att } = mode === "forward"
      ? await sb.from("email_attachments").select("id, filename, mime, size, storage_path, is_ignored").eq("message_id", m.id)
      : { data: [] };
    const quote = quoteBlock({ from: fromLabel(m), date: m.sent_at, text: m.body_text, subject: m.subject, to: m.to_addrs }, mode === "forward" ? "forward" : "reply");
    return {
      accountId: m.account_id,
      ...recipients,
      subject: mode === "forward" ? forwardSubject(m.subject) : replySubject(m.subject),
      quoteText: quote.text,
      hasDraft: !!m.draft_message_id,
      // KI-Entwurf ohne Text-Signatur: beim Senden haengt die HTML-Signatur des Postfachs an.
      draftText: m.draft_text ? stripTrailingSignature(m.draft_text, (await loadAccount(sb, m.account_id)).signature || "") : null,
      attachments: (att || []).map((a: any) => ({
        id: a.id, filename: a.filename, mime: a.mime, size: a.size, available: !!a.storage_path, ignored: a.is_ignored,
      })),
    };
  },

  async send(sb, body, user) {
    const acc = await loadAccount(sb, String(body.accountId || ""));
    const mode = body.replyTo ? asMode(body.mode) ?? "reply" : null;
    const orig = body.replyTo ? await loadMessage(sb, String(body.replyTo)) : null;
    // Senden nur aus eigenen Postfaechern und nur zu Mails eigener Postfaecher.
    assertAccount(user, acc.id);
    if (orig) assertAccount(user, orig.account_id);
    const recipients = { to: parseAddressList(body.to), cc: parseAddressList(body.cc), bcc: parseAddressList(body.bcc) };
    checkRecipients(recipients);
    const subject = String(body.subject ?? "").trim().slice(0, 500);
    if (!subject && body.allowEmptySubject !== true) throw new ComposeError("Betreff fehlt.");

    // Anhaenge: weitergeleitete Originalanhaenge (aus dem Speicher) + hochgeladene Dateien
    const files: { filename: string; mime: string; bytes: Uint8Array }[] = [];
    const fwdIds = (Array.isArray(body.forwardAttachmentIds) ? body.forwardAttachmentIds : []).map(String).slice(0, 50);
    if (fwdIds.length) {
      if (!orig) throw new ComposeError("Anhänge weiterleiten geht nur beim Weiterleiten.");
      const { data } = await sb.from("email_attachments").select("id, filename, mime, storage_path").eq("message_id", orig.id).in("id", fwdIds);
      const dl = storageDownloader(sb);
      for (const a of data || []) {
        if (!a.storage_path) throw new ComposeError(`Anhang „${a.filename}“ ist nicht mehr gespeichert.`);
        files.push({ filename: a.filename, mime: a.mime, bytes: await dl(a.storage_path) });
      }
    }
    for (const u of (Array.isArray(body.uploads) ? body.uploads : []).slice(0, 20)) {
      files.push({ filename: String(u.filename || "Anhang").slice(0, 200), mime: String(u.mime || "application/octet-stream"), bytes: decodeBase64(u.base64) });
    }
    const total = files.reduce((s, f) => s + f.bytes.length, 0);
    if (total > MAX_ATTACHMENT_BYTES) throw new ComposeError(`Anhänge zusammen zu groß (${Math.round(total / 1e6)} MB, höchstens ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB).`);

    const quote = orig && body.withQuote !== false
      ? quoteBlock({ from: fromLabel(orig), date: orig.sent_at, text: orig.body_text, subject: orig.subject, to: orig.to_addrs }, mode === "forward" ? "forward" : "reply")
      : null;
    const parts = composeBody(String(body.text ?? ""), acc.signature_html, quote);
    const chain = orig && mode !== "forward" ? referenceChain(orig) : { inReplyTo: null, references: [] };
    const messageId = newMessageId(acc.address);
    const raw = await buildComposedMime({
      from: { name: COMPANY_NAME, address: acc.address }, recipients, subject, text: parts.text, html: parts.html,
      messageId, inReplyTo: chain.inReplyTo, references: chain.references, attachments: files,
    });

    const smtp = { host: acc.smtp_host ?? "", port: acc.smtp_port ?? 465, user: acc.username, pass: await accountPassword(acc) };
    await sendComposed(smtp, acc.address, recipients, raw);

    // Ab hier ist die Mail draussen: Nacharbeiten duerfen den Versand nicht mehr als Fehler melden.
    const warnings: string[] = [];
    const fm = acc.folder_map || {};
    let sentUid: number | null = null;
    try {
      await withImap({ host: acc.imap_host, port: acc.imap_port, user: acc.username, pass: smtp.pass }, async (client: any) => {
        if (fm.sent) {
          const res: any = await client.append(fm.sent, raw as any, ["\\Seen"]);
          sentUid = res?.uid ? Number(res.uid) : null;
        } else warnings.push("Kein Gesendet-Ordner bekannt – Kopie nicht abgelegt.");
        // Wie jedes Mailprogramm: Original als beantwortet bzw. weitergeleitet markieren (Thunderbird zeigt beides).
        if (orig) {
          for (const f of [...new Set([orig.current_folder, orig.folder].filter(Boolean))] as string[]) {
            const uid = await findUidByMessageId(client, f, orig.message_id).catch(() => null);
            if (uid != null) { await addKeywords(client, f, uid, [mode === "forward" ? "$Forwarded" : "\\Answered"]); break; }
          }
        }
        // Ein KI-Entwurf zu dieser Mail ist mit dem Versand ueberholt: in den Papierkorb (nie loeschen).
        if (orig && body.discardDraft && orig.draft_message_id && fm.drafts && fm.trash) {
          const uid = orig.draft_uid ?? (await findUidByMessageId(client, fm.drafts, orig.draft_message_id).catch(() => null));
          if (uid != null) await moveMessage(client, fm.drafts, Number(uid), fm.trash).catch(() => warnings.push("KI-Entwurf blieb im Entwürfe-Ordner."));
        }
      });
    } catch (e) {
      warnings.push(`Postfach-Nacharbeit: ${String((e as Error).message).slice(0, 160)}`);
    }

    await sb.from("email_sent").insert({
      account_id: acc.id, message_id: messageId, to_addrs: recipients.to, cc_addrs: recipients.cc, bcc_count: recipients.bcc.length,
      subject, reply_to: mode && mode !== "forward" ? orig?.id ?? null : null, forward_of: mode === "forward" ? orig?.id ?? null : null,
      attachment_count: files.length, sent_by: user.id, sent_folder_uid: sentUid, warnings,
    });
    if (orig && body.discardDraft) await sb.from("email_messages").update({ draft_message_id: null, draft_uid: null }).eq("id", orig.id);
    if (orig?.thread_id && mode !== "forward") {
      await sb.from("email_threads").update({ answered: true, last_activity_at: new Date().toISOString() }).eq("id", orig.thread_id);
    }
    return { messageId, warnings };
  },
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user = await requireMailUser(req, sb);
  if (!user) return fail("Nicht angemeldet oder kein Zugang zur Mail-App.", { code: "unauthorized" });
  const body = await readJson(req);
  const h = handlers[String(body.action || "")];
  if (!h) return fail("Unbekannte Aktion.");
  try {
    return ok(await h(sb, body, user));
  } catch (e) {
    return fail(String((e as Error)?.message || e).slice(0, 300), e instanceof ComposeError ? { code: "invalid" } : e instanceof AccessError ? { code: "forbidden" } : {});
  }
});
