// Versand aus der Mail-App: Mail verfassen, Antworten, Weiterleiten – NUR per Klick eines angemeldeten Admins.
//
// Dritte Ausnahme vom Grundsatz „Kein Versand“ (ausdruecklich freigegeben, Okt. 2026: die Mail-App ersetzt
// Thunderbird). Gesendet wird ausschliesslich hier; aufgerufen wird `sendComposed` nur aus email-send/index.ts
// (Aktion `send`, Admin-Sitzung). Der Assistent selbst (Sync, Verarbeitung, Autopilot) sendet nie –
// `imap.test.ts` prueft das im Quelltext.
//
// SMTP: Port 465 (implizites TLS). Die Ports 25 und 587 sind aus Supabase Edge Functions gesperrt.

import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { SmtpCreds } from "./lexwareSend.ts";
import { checkRecipients, ComposeError, type Recipients } from "./compose.ts";

export interface ComposedMail {
  from: { name: string; address: string };
  recipients: Recipients;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  attachments: { filename: string; mime: string; bytes: Uint8Array }[];
}

/** MIME der fertigen Mail. Bcc steht NICHT im Kopf (nur im Umschlag). */
export async function buildComposedMime(m: ComposedMail): Promise<Uint8Array> {
  const mc = new MailComposer({
    from: m.from,
    to: m.recipients.to,
    ...(m.recipients.cc.length ? { cc: m.recipients.cc } : {}),
    subject: m.subject,
    text: m.text,
    html: m.html,
    date: new Date(),
    messageId: m.messageId,
    ...(m.inReplyTo ? { inReplyTo: m.inReplyTo } : {}),
    ...(m.references.length ? { references: m.references } : {}),
    attachments: m.attachments.map((f) => ({ filename: f.filename, content: f.bytes as unknown as Uint8Array, contentType: f.mime })),
  } as any);
  return (await mc.compile().build()) as Uint8Array;
}

export async function sendComposed(smtp: SmtpCreds, from: string, recipients: Recipients, raw: Uint8Array): Promise<void> {
  checkRecipients(recipients);
  if (!smtp.host) throw new ComposeError("Kein SMTP-Server hinterlegt (Einstellungen → Postfächer).");
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: true, auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 60_000,
  });
  try {
    const to = [...recipients.to, ...recipients.cc, ...recipients.bcc];
    await transport.sendMail({ envelope: { from, to }, raw: raw as unknown as Buffer });
  } finally {
    transport.close();
  }
}
