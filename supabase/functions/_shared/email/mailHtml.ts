// HTML-Ansicht einer Mail (Edge Function `email-mailbox`). Rein, damit es unter vitest laeuft.
//
// Die Mail-App zeigt das Ergebnis in einem iframe mit `sandbox` (keine Skripte, kein Zugriff auf die App)
// und einer CSP, die externe Bilder erst nach Klick erlaubt. Hier wird nur zusammengesetzt:
// HTML (oder Text als HTML) und eingebettete Bilder (cid:) als data:-URLs.

export const MAX_INLINE_IMAGE_BYTES = 1_500_000;
export const MAX_INLINE_TOTAL_BYTES = 4_000_000;
/** Groesser wird nicht zwischengespeichert (die Ansicht holt es dann jedes Mal frisch). */
export const MAX_CACHE_CHARS = 400_000;
/** Groesser wird gar nicht ausgeliefert, sondern der Text gezeigt. */
export const MAX_HTML_CHARS = 2_500_000;

export interface InlinePart { cid: string | null; mime: string; content: Uint8Array | null }

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Text-Mail als HTML (Zeilenumbrueche, Links klickbar). */
export function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
  return `<div style="white-space:pre-wrap;font-family:system-ui,sans-serif;font-size:14px">${linked}</div>`;
}

/** `cid:`-Verweise durch data:-URLs der eingebetteten Bilder ersetzen (mit Groessengrenzen). */
export function inlineCidImages(html: string, parts: InlinePart[]): string {
  let total = 0;
  let out = html;
  for (const p of parts) {
    if (!p.cid || !p.content || !/^image\//i.test(p.mime)) continue;
    if (p.content.length > MAX_INLINE_IMAGE_BYTES || total + p.content.length > MAX_INLINE_TOTAL_BYTES) continue;
    const cid = p.cid.replace(/^<|>$/g, "");
    const re = new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
    if (!re.test(out)) continue;
    total += p.content.length;
    out = out.replace(re, `data:${p.mime};base64,${toBase64(p.content)}`);
  }
  return out;
}

/** Aus dem mailparser-Ergebnis die Anzeige bauen. */
export function mailHtml(mp: { html?: string | false | null; textAsHtml?: string | null; text?: string | null; attachments?: any[] }): { html: string; kind: "html" | "text" } {
  const parts: InlinePart[] = (mp.attachments || []).map((a: any) => ({ cid: a.cid ?? a.contentId ?? null, mime: a.contentType || "", content: a.content ?? null }));
  if (mp.html && String(mp.html).trim()) {
    const html = inlineCidImages(String(mp.html), parts);
    if (html.length <= MAX_HTML_CHARS) return { html, kind: "html" };
  }
  return { html: textToHtml(String(mp.text || "").slice(0, 200_000)), kind: "text" };
}

// ---------------------------------------------------------------- nur die sichtbaren Teile holen
//
// Edge Functions haben ca. 2 s CPU. Eine Mail mit grossem Anhang (z. B. 3 MB PDF) komplett durch mailparser zu
// schicken, sprengt das („CPU Time exceeded“). Deshalb: BODYSTRUCTURE lesen, nur HTML/Text und eingebettete
// Bilder (cid) per IMAP holen und hier selbst dekodieren. Anhaenge werden fuer die Ansicht nie geladen.

/** Knoten der BODYSTRUCTURE, wie imapflow sie liefert. */
export interface StructNode {
  part?: string; type?: string; parameters?: Record<string, string>; id?: string; encoding?: string; size?: number;
  disposition?: string; childNodes?: StructNode[];
}
export interface PartRef { key: string; charset: string | null; encoding: string; size: number }
export interface DisplayParts { html: PartRef | null; text: PartRef | null; images: (PartRef & { cid: string; mime: string })[] }

const MAX_BODY_PART_BYTES = 3_000_000;

/** Welche Teile braucht die Ansicht? Angehaengte Mails (message/rfc822) und Anhaenge zaehlen nicht. */
export function pickDisplayParts(root: StructNode): DisplayParts {
  const out: DisplayParts = { html: null, text: null, images: [] };
  let imageBytes = 0;
  const ref = (n: StructNode): PartRef => ({
    key: n.part ? n.part.toLowerCase() : "text", charset: n.parameters?.charset ?? null, encoding: (n.encoding || "7bit").toLowerCase(), size: n.size ?? 0,
  });
  const walk = (n: StructNode) => {
    const type = (n.type || "").toLowerCase();
    if (type === "message/rfc822") return;
    if (n.childNodes?.length) { n.childNodes.forEach(walk); return; }
    const attached = n.disposition === "attachment";
    if (type === "text/html" && !attached && !out.html && (n.size ?? 0) <= MAX_BODY_PART_BYTES) out.html = ref(n);
    else if (type === "text/plain" && !attached && !out.text && (n.size ?? 0) <= MAX_BODY_PART_BYTES) out.text = ref(n);
    else if (type.startsWith("image/") && n.id) {
      // base64 ist ca. 4/3 der echten Groesse
      const bytes = Math.round((n.size ?? 0) * 0.75);
      if (bytes <= MAX_INLINE_IMAGE_BYTES && imageBytes + bytes <= MAX_INLINE_TOTAL_BYTES) {
        imageBytes += bytes;
        out.images.push({ ...ref(n), cid: n.id, mime: type });
      }
    }
  };
  walk(root);
  return out;
}

function decodeQuotedPrintable(raw: string): Uint8Array {
  const s = raw.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 61 && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(c & 0xff);
  }
  return new Uint8Array(out);
}

/** Inhalt eines Teils nach Content-Transfer-Encoding dekodieren. */
export function decodeTransfer(bytes: Uint8Array, encoding: string): Uint8Array {
  const latin1 = () => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return s; };
  if (encoding === "base64") {
    const bin = atob(latin1().replace(/[^A-Za-z0-9+/=]/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (encoding === "quoted-printable") return decodeQuotedPrintable(latin1());
  return bytes;
}

/** Bytes -> Text im angegebenen Zeichensatz (unbekannt: UTF-8, bei kaputtem UTF-8 Windows-1252). */
export function decodeCharset(bytes: Uint8Array, charset: string | null): string {
  const cs = (charset || "utf-8").toLowerCase();
  try {
    return new TextDecoder(cs, { fatal: cs === "utf-8" || cs === "utf8" }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
