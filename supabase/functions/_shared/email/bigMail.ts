// Sehr grosse Mails (z. B. gesendete Druckdaten mit 25 MB) nicht ganz holen: die ganze Quelle durch mailparser
// sprengt Speicher/CPU der Edge Function (HTTP 546) – und weil der naechste Lauf an derselben Stelle weitermacht,
// blieb das Postfach dauerhaft haengen. Stattdessen nur Kopfzeilen und Text holen und daraus eine schlanke Mail
// bauen; die Anhaenge stehen als Hinweis im Text.

import type { StructNode } from "./mailHtml.ts";

/** Ab dieser Groesse (RFC822.SIZE) wird nur der Text geholt. */
export const BIG_MAIL_BYTES = 8 * 1024 * 1024;

export interface OmittedPart { name: string; size: number }

/** Anhaenge laut BODYSTRUCTURE (Name und ungefaehre Groesse; base64 ist ca. 4/3 der echten Groesse). */
export function attachmentParts(root: StructNode): OmittedPart[] {
  const out: OmittedPart[] = [];
  const walk = (n: any) => {
    if (n.childNodes?.length) { n.childNodes.forEach(walk); return; }
    const type = String(n.type || "").toLowerCase();
    const name = n.dispositionParameters?.filename || n.parameters?.name || null;
    const isBody = (type === "text/plain" || type === "text/html") && n.disposition !== "attachment" && !name;
    if (isBody || (type.startsWith("image/") && n.id && n.disposition !== "attachment")) return;
    out.push({ name: String(name || type || "Anhang"), size: Math.round((n.size ?? 0) * (String(n.encoding || "").toLowerCase() === "base64" ? 0.75 : 1)) });
  };
  walk(root);
  return out;
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

export function omittedNote(total: number, parts: OmittedPart[]): string {
  const list = parts.map((p) => `${p.name} (${mb(p.size)})`).join(", ");
  return `[Mail mit ${mb(total)} – zu groß zum vollständigen Abholen. Anhänge nicht übernommen${list ? `: ${list}` : ""}. Im Mailprogramm öffnen.]`;
}

/** HTML grob zu Text (nur fuer den Ausnahmefall ohne Textteil). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const DROP = /^(content-type|content-transfer-encoding|mime-version|content-disposition)$/i;

/**
 * Schlanke Ersatz-Quelle: Original-Kopfzeilen (ohne MIME-Struktur) + Text als text/plain UTF-8.
 * Message-ID, In-Reply-To, References, Absender, Empfaenger und Datum bleiben – Thread und Zuordnung funktionieren.
 */
export function slimSource(header: Uint8Array, text: string): Uint8Array {
  // Byte fuer Byte (latin1): 8-bit-Kopfzeilen kommen unveraendert wieder heraus.
  let raw = "";
  for (let i = 0; i < header.length; i += 0x8000) raw += String.fromCharCode(...header.subarray(i, i + 0x8000));
  raw = raw.replace(/\r?\n\r?\n[\s\S]*$/, "");
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let dropping = false;
  for (const l of lines) {
    if (/^[ \t]/.test(l)) { if (!dropping) kept.push(l); continue; }
    const name = l.split(":", 1)[0].trim();
    dropping = DROP.test(name);
    if (!dropping && l.trim()) kept.push(l);
  }
  const head = kept.join("\r\n") + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n";
  const headBytes = Uint8Array.from(head, (c) => c.charCodeAt(0) & 0xff);
  const body = new TextEncoder().encode(text.replace(/\r?\n/g, "\r\n"));
  const out = new Uint8Array(headBytes.length + body.length);
  out.set(headBytes, 0);
  out.set(body, headBytes.length);
  return out;
}
