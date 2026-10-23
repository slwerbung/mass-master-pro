// Mail verfassen (Mail-App): Empfaenger pruefen, Betreff, Zitat der Originalmail, HTML-Signatur.
// Reine Funktionen ohne Netz – gebaut und gesendet wird in email-send (composeSend.ts).

import { escapeHtml, textToHtml } from "./mailHtml.ts";

export const MAX_RECIPIENTS = 50;
/** Summe aller Anhaenge (Bytes); groesser lehnen viele Server ohnehin ab. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_SIGNATURE_CHARS = 100_000;

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export class ComposeError extends Error {}

/** „a@x.de, Max <b@y.de>; c@z.de“ -> ["a@x.de", "b@y.de", "c@z.de"]; ungueltige Eintraege werfen. */
export function parseAddressList(input: string | string[] | null | undefined): string[] {
  const parts = (Array.isArray(input) ? input : String(input ?? "").split(/[,;\n]/))
    .map((p) => String(p).trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const m = /<([^>]+)>/.exec(p);
    const addr = (m ? m[1] : p).trim().toLowerCase();
    if (!EMAIL.test(addr)) throw new ComposeError(`Ungültige Adresse: ${p.slice(0, 80)}`);
    if (!out.includes(addr)) out.push(addr);
  }
  return out;
}

export interface Recipients { to: string[]; cc: string[]; bcc: string[] }

export function checkRecipients(r: Recipients): void {
  if (!r.to.length) throw new ComposeError("Bitte mindestens einen Empfänger eintragen.");
  if (r.to.length + r.cc.length + r.bcc.length > MAX_RECIPIENTS) throw new ComposeError(`Höchstens ${MAX_RECIPIENTS} Empfänger.`);
}

const strip = (s: string) => String(s || "").trim();

export function replySubject(subject: string): string {
  const s = strip(subject);
  return /^(?:re|aw)\s*:/i.test(s) ? s : `AW: ${s || "(ohne Betreff)"}`;
}

export function forwardSubject(subject: string): string {
  const s = strip(subject);
  return /^(?:fwd?|wg)\s*:/i.test(s) ? s : `WG: ${s || "(ohne Betreff)"}`;
}

/** HTML-Signatur als Text (fuer den Text-Teil der Mail): Zeilenumbrueche erhalten, Tags weg. */
export function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface QuoteSource { from: string; date: string | null; text: string | null; subject?: string; to?: string[] }

const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });
};

/** Zitat unter der Antwort bzw. weitergeleitete Mail – als HTML und als Text. */
export function quoteBlock(q: QuoteSource, mode: "reply" | "forward"): { html: string; text: string } {
  const body = String(q.text ?? "").slice(0, 100_000);
  const when = fmtDate(q.date);
  if (mode === "forward") {
    const head = ["-------- Weitergeleitete Nachricht --------", `Von: ${q.from}`, when ? `Datum: ${when}` : "", q.to?.length ? `An: ${q.to.join(", ")}` : "", `Betreff: ${q.subject ?? ""}`]
      .filter(Boolean);
    return {
      text: `${head.join("\n")}\n\n${body}`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:13px;color:#555">${head.map(escapeHtml).join("<br>")}</div><br>${textToHtml(body)}`,
    };
  }
  const intro = `Am ${when || "?"} schrieb ${q.from}:`;
  return {
    text: `${intro}\n${body.split("\n").map((l) => `> ${l}`).join("\n")}`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:13px;color:#555">${escapeHtml(intro)}</div>` +
      `<blockquote style="margin:0 0 0 .5em;padding-left:.75em;border-left:3px solid #ccc;color:#444">${textToHtml(body)}</blockquote>`,
  };
}

export interface BodyParts { text: string; html: string }

/** Nachricht = eigener Text, Signatur, darunter ggf. das Zitat. */
export function composeBody(text: string, signatureHtml: string | null, quote: { html: string; text: string } | null): BodyParts {
  const own = String(text ?? "").replace(/\s+$/, "");
  const sig = String(signatureHtml ?? "").trim();
  const sigText = sig ? htmlToText(sig) : "";
  const textPart = [own, sigText ? `-- \n${sigText}` : "", quote?.text ?? ""].filter(Boolean).join("\n\n");
  const htmlPart =
    `<!doctype html><html><head><meta charset="utf-8"></head><body>` +
    textToHtml(own) +
    (sig ? `<br><div class="signature">${sig}</div>` : "") +
    (quote ? `<br>${quote.html}` : "") +
    `</body></html>`;
  return { text: textPart, html: htmlPart };
}

/** Kette fuer In-Reply-To/References (RFC 5322): bisherige References + Message-ID der beantworteten Mail. */
export function referenceChain(original: { message_id: string | null; refs?: string[] | null }): { inReplyTo: string | null; references: string[] } {
  const id = original.message_id || null;
  const refs = (original.refs ?? []).filter((r) => r && r !== id);
  return { inReplyTo: id, references: id ? [...refs, id].slice(-20) : refs.slice(-20) };
}

/** Allen antworten: Absender + alle Empfaenger ausser den eigenen Adressen. */
export function replyAllRecipients(m: { from_addr: string; to_addrs: string[]; cc_addrs: string[] }, own: string[]): Recipients {
  const mine = new Set(own.map((a) => a.toLowerCase()));
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()))].filter((x) => x && !mine.has(x));
  const to = uniq([m.from_addr]);
  const cc = uniq([...(m.to_addrs ?? []), ...(m.cc_addrs ?? [])]).filter((x) => !to.includes(x));
  return { to, cc, bcc: [] };
}

/** KI-Entwurf ohne die angehaengte Text-Signatur (beim Senden kommt die HTML-Signatur dazu). */
export function stripTrailingSignature(text: string, signature: string): string {
  const t = String(text ?? "").trimEnd();
  const sig = String(signature ?? "").trim();
  return sig && t.endsWith(sig) ? t.slice(0, t.length - sig.length).trimEnd() : t;
}
