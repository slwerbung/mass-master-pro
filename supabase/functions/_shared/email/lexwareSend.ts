// EINZIGE Stelle im Mail-Assistenten, die eine Mail wirklich versendet.
//
// Ausnahme vom Grundsatz „Kein Versand“ (ausdruecklich freigegeben): Belege duerfen automatisch an die
// in den Einstellungen hinterlegte Lexware-Belegadresse gesendet werden – an NIEMAND sonst. Die Funktion
// verlangt deshalb zusaetzlich zum Empfaenger die erlaubte Adresse und weigert sich bei jeder Abweichung.
// Antworten an Kunden bleiben Entwuerfe. `imap.test.ts` stellt sicher, dass kein anderer Code sendet.
//
// SMTP: Port 465 (implizites TLS). Die Ports 25 und 587 sind aus Supabase Edge Functions gesperrt.

import nodemailer from "nodemailer";

export interface SmtpCreds { host: string; port: number; user: string; pass: string }

export class SendRefused extends Error {}

export function assertAllowedRecipient(to: string, allowed: string): void {
  const a = String(allowed || "").trim().toLowerCase();
  if (!a || !/^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(a)) throw new SendRefused("Keine gültige Lexware-Belegadresse hinterlegt.");
  if (String(to || "").trim().toLowerCase() !== a) throw new SendRefused("Versand nur an die hinterlegte Lexware-Belegadresse erlaubt.");
}

export async function sendToLexware(
  smtp: SmtpCreds, from: string, to: string, allowedAddress: string, raw: Uint8Array,
): Promise<void> {
  assertAllowedRecipient(to, allowedAddress);
  if (!smtp.host) throw new SendRefused("Kein SMTP-Server hinterlegt (Einstellungen → Postfächer).");
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: true, auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 60_000,
  });
  try {
    // Umschlag und Rohnachricht sind fest: genau ein Empfaenger.
    await transport.sendMail({ envelope: { from, to: [to.trim()] }, raw: raw as unknown as Buffer });
  } finally {
    transport.close();
  }
}
