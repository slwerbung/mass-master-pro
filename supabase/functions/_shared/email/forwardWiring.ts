// Verdrahtung der Lexware-Weiterleitung mit Datenbank, Storage, IMAP (Entwurf) und SMTP (Versand).

import { appendDraft } from "./imap.ts";
import { buildForwardMime, newMessageId } from "./draftMime.ts";
import { forwardBeleg, pickBelegFiles, type ForwardDeps } from "./forward.ts";
import type { LazyImap } from "./lazyImap.ts";
import { sendToLexware } from "./lexwareSend.ts";
import { storageDownloader } from "./uploader.ts";

export interface ForwardAccount {
  address: string;
  username: string;
  smtp_host: string | null;
  smtp_port: number | null;
  folder_map: any;
}

export function makeForwarder(
  sb: any, acc: ForwardAccount, address: string, imap: LazyImap, fromName: string, password: string,
) {
  const drafts: string | undefined = acc.folder_map?.drafts;
  const deps: ForwardDeps = {
    address,
    async loadMessage(id) {
      const { data } = await sb.from("email_messages").select("id, from_addr, from_name, subject, sent_at, body_text, forwarded_at").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async loadFiles(messageId) {
      const { data } = await sb.from("email_attachments").select("filename, mime, role, storage_path")
        .eq("message_id", messageId).eq("is_ignored", false).not("storage_path", "is", null);
      const dl = storageDownloader(sb);
      const out = [];
      for (const a of pickBelegFiles(data || [])) out.push({ filename: a.filename, mime: a.mime, bytes: await dl((a as any).storage_path) });
      return out;
    },
    buildMime: (h) => buildForwardMime({ from: { name: fromName, address: acc.address }, messageId: newMessageId(acc.address), ...h }),
    async append(raw) {
      if (!drafts) throw new Error("Kein Entwürfe-Ordner bekannt (Einstellungen → Postfächer → „Ordner anlegen & speichern“).");
      return await appendDraft(await imap.raw(), drafts, raw);
    },
    send: acc.smtp_host
      ? (raw, to) => sendToLexware({ host: acc.smtp_host!, port: acc.smtp_port || 465, user: acc.username, pass: password }, acc.address, to, address, raw)
      : undefined,
    async markForwarded(id, how) {
      await sb.from("email_messages").update({
        forwarded_at: new Date().toISOString(),
        beleg_state: how === "gesendet" ? "weitergeleitet" : "weiterleiten_offen",
      }).eq("id", id);
    },
  };
  return { address, run: (messageId: string, mode: "send" | "draft") => forwardBeleg(messageId, deps, mode) };
}
