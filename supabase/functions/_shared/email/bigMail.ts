// Sehr grosse Mails (z. B. gesendete Druckdaten mit 25 MB) nicht ganz holen: die ganze Quelle durch mailparser
// sprengt Speicher/CPU der Edge Function (HTTP 546) – und weil der naechste Lauf an derselben Stelle weitermacht,
// blieb das Postfach dauerhaft haengen. Stattdessen nur Kopfzeilen und Text holen und daraus eine schlanke Mail
// bauen. Die Anhaenge werden danach EINZELN per IMAP geholt (`attachmentRefs` + `decodePart`, ohne mailparser);
// nur was dafuer zu gross ist, steht als Hinweis oben im Text.

import { decodeTransfer, type StructNode } from "./mailHtml.ts";

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

/** Ein Anhang laut BODYSTRUCTURE, den man einzeln per IMAP holen kann (`bodyParts: [key]`). */
export interface AttachmentRef {
  key: string;
  filename: string;
  mime: string;
  encoding: string;
  /** Ungefaehre echte Groesse (base64: 3/4 der Teilgroesse). */
  size: number;
  /** Eingebettet (cid-Bild oder Content-Disposition inline) – wie `related`/`inline` bei mailparser. */
  inline: boolean;
}

/**
 * Wie `attachmentParts`, aber mit allem, was zum einzelnen Holen noetig ist. Eingebettete Bilder zaehlen hier mit
 * (mailparser liefert sie ebenfalls als Anhang; `isIgnorableAttachment` blendet Signaturbilder aus).
 * Angehaengte Mails (message/rfc822) kommen als ein Teil (.eml), nicht zerlegt.
 */
export function attachmentRefs(root: StructNode): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  const walk = (n: any) => {
    const type = String(n.type || "").toLowerCase();
    if (n.childNodes?.length && type !== "message/rfc822") { n.childNodes.forEach(walk); return; }
    const name = n.dispositionParameters?.filename || n.parameters?.name || null;
    const isBody = (type === "text/plain" || type === "text/html") && n.disposition !== "attachment" && !name;
    if (isBody) return;
    const encoding = String(n.encoding || "7bit").toLowerCase();
    out.push({
      key: n.part ? String(n.part).toLowerCase() : "1",
      filename: String(name || (type === "message/rfc822" ? "weitergeleitete-mail.eml" : "anhang")),
      mime: type || "application/octet-stream",
      encoding,
      size: Math.round((n.size ?? 0) * (encoding === "base64" ? 0.75 : 1)),
      inline: n.disposition === "inline" || (!!n.id && n.disposition !== "attachment"),
    });
  };
  walk(root);
  return out;
}

const B64 = (() => {
  const t = new Int16Array(256).fill(-1);
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < abc.length; i++) t[abc.charCodeAt(i)] = i;
  return t;
})();

/**
 * base64 direkt auf den Bytes dekodieren (ein Durchlauf, Zeilenumbrueche/Fremdzeichen werden uebersprungen).
 * Bewusst nicht ueber String + atob: bei 10 MB kostet das ein Vielfaches an CPU-Zeit (Edge-Limit 2 s).
 */
export function decodeBase64Bytes(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.floor((src.length * 3) / 4) + 3);
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < src.length; i++) {
    const v = B64[src[i]];
    if (v < 0) { if (src[i] === 61) break; continue; } // "=" beendet, alles andere (CRLF) ueberspringen
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

/** Einen einzeln geholten Teil dekodieren (base64 schnell, sonst wie die Ansicht). */
export function decodePart(bytes: Uint8Array, encoding: string): Uint8Array {
  return encoding === "base64" ? decodeBase64Bytes(bytes) : decodeTransfer(bytes, encoding);
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

export function omittedNote(total: number, parts: OmittedPart[]): string {
  const list = parts.map((p) => `${p.name} (${mb(p.size)})`).join(", ");
  return `[Mail mit ${mb(total)} – zu groß zum vollständigen Abholen. Anhänge nicht übernommen${list ? `: ${list}` : ""}. Im Mailprogramm öffnen.]`;
}

/** Hinweis fuer einzelne Anhaenge, die selbst zum Einzelabholen zu gross sind. */
export function tooBigNote(parts: OmittedPart[]): string {
  const list = parts.map((p) => `${p.name} (${mb(p.size)})`).join(", ");
  return `[Anhang zu groß zum Übernehmen: ${list}. Im Mailprogramm öffnen.]`;
}

/**
 * Text der schlanken Ersatz-Mail. Der Hinweis steht OBEN: `cleanBody` schneidet alles ab dem ersten Zitat
 * („Von: … Betreff:“) ab – unten angehaengt verschwand er bei jeder weitergeleiteten Mail.
 */
export function slimText(text: string, note: string | null): string {
  return note ? `${note}\n\n${text.trim()}` : text.trim();
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
