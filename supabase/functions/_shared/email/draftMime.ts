// Entwurf als MIME-Nachricht bauen und ins Postfach legen.
//
// Gebaut wird mit MailComposer (nodemailer): korrekte Kodierung von Umlauten. Der Entwurf traegt
// From, Date, eine eigene Message-ID sowie In-Reply-To und References, damit er in Thunderbird im
// richtigen Thread erscheint. Es gibt hier KEINEN Versand: nodemailer wird nur als MIME-Baukasten
// benutzt, ein Transport wird nie angelegt.

import MailComposer from "nodemailer/lib/mail-composer";
import type { ImapFlow } from "imapflow";
import { appendDraft, findUidByMessageId, moveMessage } from "./imap.ts";
import type { DraftMsg, DraftWriter } from "./draft.ts";

export interface DraftHeaders {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  date?: Date;
}

export async function buildDraftMime(h: DraftHeaders): Promise<Uint8Array> {
  const mc = new MailComposer({
    from: { name: h.from.name, address: h.from.address },
    to: h.to,
    subject: h.subject,
    text: h.text,
    date: h.date ?? new Date(),
    messageId: h.messageId,
    ...(h.inReplyTo ? { inReplyTo: h.inReplyTo } : {}),
    ...(h.references.length ? { references: h.references } : {}),
    // Kennzeichnet ihn fuer Menschen und Filter als Maschinenentwurf.
    headers: { "X-Mail-Assistent": "Entwurf" },
  } as any);
  return (await mc.compile().build()) as Uint8Array;
}

export function newMessageId(address: string): string {
  const domain = address.split("@")[1] || "localhost";
  return `<${crypto.randomUUID()}@${domain}>`;
}

/**
 * Schreibt den Entwurf in den Entwuerfe-Ordner. Ein ueberholter eigener Entwurf wird nicht
 * geloescht, sondern in den Papierkorb verschoben (Kein Loeschen).
 */
export function imapDraftWriter(
  getClient: () => Promise<ImapFlow>,
  cfg: { drafts: string; trash: string | null; fromName: string; fromAddress: string },
): DraftWriter {
  return {
    async write(msg: DraftMsg, subject: string, text: string, previousMessageId: string | null, previousUid: number | null) {
      const client = await getClient();
      const messageId = newMessageId(cfg.fromAddress);
      const raw = await buildDraftMime({
        from: { name: cfg.fromName, address: cfg.fromAddress },
        to: msg.from_addr,
        subject,
        text,
        messageId,
        inReplyTo: msg.message_id,
        references: [...msg.refs.filter((r) => r !== msg.message_id), msg.message_id],
      });
      const uid = await appendDraft(client, cfg.drafts, raw);

      // Alten Entwurf aufraeumen (erst NACH dem erfolgreichen Anlegen des neuen).
      if (previousMessageId && cfg.trash) {
        try {
          const old = previousUid ?? (await findUidByMessageId(client, cfg.drafts, previousMessageId));
          if (old != null) await moveMessage(client, cfg.drafts, old, cfg.trash);
        } catch { /* der neue Entwurf steht; ein Altlast-Entwurf ist harmlos */ }
      }
      return { messageId, uid };
    },
  };
}
