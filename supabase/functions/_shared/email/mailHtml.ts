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

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
