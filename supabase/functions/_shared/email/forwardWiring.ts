// Verdrahtung des Lexoffice-Weiterleitungs-ENTWURFS mit Datenbank, Storage und IMAP.

import { appendDraft } from "./imap.ts";
import { buildForwardMime, newMessageId } from "./draftMime.ts";
import { forwardBelegDraft, type ForwardDeps } from "./forward.ts";
import type { LazyImap } from "./lazyImap.ts";
import { storageDownloader } from "./uploader.ts";

export function makeForwarder(sb: any, acc: { address: string; folder_map: any }, address: string, imap: LazyImap, fromName: string) {
  const drafts: string | undefined = acc.folder_map?.drafts;
  const deps: ForwardDeps = {
    address,
    async loadMessage(id) {
      const { data } = await sb.from("email_messages").select("id, from_addr, from_name, subject, sent_at, body_text").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async loadFiles(messageId) {
      const { data } = await sb.from("email_attachments").select("filename, mime, storage_path")
        .eq("message_id", messageId).eq("is_ignored", false).not("storage_path", "is", null);
      const dl = storageDownloader(sb);
      const out = [];
      for (const a of data || []) out.push({ filename: a.filename, mime: a.mime, bytes: await dl(a.storage_path) });
      return out;
    },
    buildMime: (h) => buildForwardMime({ from: { name: fromName, address: acc.address }, messageId: newMessageId(acc.address), ...h }),
    async append(raw) {
      if (!drafts) throw new Error("Kein Entwürfe-Ordner bekannt (Einstellungen → Postfächer → „Ordner anlegen & speichern“).");
      return await appendDraft(await imap.raw(), drafts, raw);
    },
  };
  return { address, run: (messageId: string) => forwardBelegDraft(messageId, deps) };
}
