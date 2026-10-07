// Reine Textwerkzeuge fuer Mails (keine Netz- und keine npm-Abhaengigkeiten,
// damit sie unter vitest und Deno gleich laufen).

export const BODY_MAX_CHARS = 6000;
export const MIN_ATTACHMENT_BYTES = 10 * 1024;

/** „AW: Re: WG: Angebot" -> „Angebot", kleingeschrieben fuer den Vergleich. */
export function normalizeSubject(subject: string): string {
  let s = String(subject || "").trim();
  const prefix = /^\s*(?:re|aw|fwd?|wg|antwort|antw|sv|vs)\s*(?:\[\d+\])?\s*:\s*/i;
  for (let i = 0; i < 10 && prefix.test(s); i++) s = s.replace(prefix, "");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Einfache HTML -> Text-Umwandlung fuer Mails ohne text/plain-Teil. */
export function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n");
}

// Zeilen, mit denen ein zitierter Verlauf beginnt.
const QUOTE_HEADERS: RegExp[] = [
  /^\s*-{2,}\s*(?:original(?:\s|-)?message|urspr(?:ü|ue)ngliche nachricht|weitergeleitete nachricht|forwarded message)\s*-{2,}/i,
  /^\s*(?:am|on)\s.{5,200}(?:schrieb|wrote)\b.*:?\s*$/i,
  /^\s*_{5,}\s*$/,
  /^\s*von:\s.+/i,
  /^\s*from:\s.+@.+/i,
];

/**
 * Zitate und Signatur abschneiden, auf ca. 6000 Zeichen kuerzen.
 * Absichtlich vorsichtig: lieber etwas zu viel Text behalten als Inhalt verlieren.
 */
export function cleanBody(text: string, max = BODY_MAX_CHARS): string {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Signaturtrenner „-- " (Standard) — alles danach ist Signatur.
    if (/^--\s?$/.test(line) && i > 0) break;
    // Beginn eines zitierten Verlaufs: nur schneiden, wenn schon eigener Text da ist.
    if (kept.some((l) => l.trim()) && QUOTE_HEADERS.some((re) => re.test(line))) {
      // „Von:" / „From:" nur dann als Zitatkopf werten, wenn danach „Gesendet/Sent/Datum" folgt.
      if (/^\s*(?:von|from):/i.test(line)) {
        const next = lines.slice(i + 1, i + 5).join("\n");
        if (!/(gesendet|sent|datum|date|an:|to:|betreff|subject)/i.test(next)) { kept.push(line); continue; }
      }
      break;
    }
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  let out = kept.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (out.length > max) out = out.slice(0, max).trimEnd() + " …";
  return out;
}

/** WER-1234 / TEX 99 / wer-1234 -> „WER-1234". Nur die konfigurierten Kuerzel. */
export function extractProjectNumbers(text: string, prefixes: string[] = ["WER", "TEX"]): string[] {
  const ps = prefixes.map((p) => p.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean);
  if (!ps.length) return [];
  const re = new RegExp(`\\b(${ps.join("|")})[-\\s]?(\\d{1,6})\\b`, "gi");
  const found: string[] = [];
  for (const m of String(text || "").matchAll(re)) {
    const nr = `${m[1].toUpperCase()}-${parseInt(m[2], 10)}`;
    if (!found.includes(nr)) found.push(nr);
  }
  return found;
}

/** „WER-1234" -> 1234 (HERO `relative_id`). */
export function projectRelativeId(nr: string): number | null {
  const m = /-(\d+)$/.exec(nr);
  return m ? parseInt(m[1], 10) : null;
}

export function emailDomain(addr: string): string {
  const at = String(addr || "").lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).toLowerCase().trim() : "";
}

/** Passt eine Absenderadresse auf ein Muster (`a@b.de` oder `@b.de`)? Unterdomains zaehlen mit. */
export function matchesPattern(addr: string, pattern: string): boolean {
  const a = String(addr || "").toLowerCase().trim();
  const p = String(pattern || "").toLowerCase().trim();
  if (!a || !p) return false;
  if (p.startsWith("@")) {
    const dom = p.slice(1);
    const ad = emailDomain(a);
    return ad === dom || ad.endsWith("." + dom);
  }
  return a === p;
}

export function isNoReply(addr: string): boolean {
  return /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster|bounce[s]?)(?:[+@._-]|$)/i.test(
    String(addr || "").split("@")[0] + "@",
  );
}

/** Message-IDs aus In-Reply-To / References ziehen. */
export function parseMessageIds(header: string | string[] | undefined | null): string[] {
  const joined = Array.isArray(header) ? header.join(" ") : String(header || "");
  return [...joined.matchAll(/<[^<>\s]+>/g)].map((m) => m[0]);
}

export function safeFilename(name: string, fallback = "datei"): string {
  const base = String(name || "").split(/[\\/]/).pop() || fallback;
  const cleaned = base.replace(/[^\w.\-äöüÄÖÜß ()]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || fallback;
}

/** Signaturbilder, Tracking-Pixel und Winzdateien kommen nie an HERO. */
export function isIgnorableAttachment(a: { size: number; mime: string; inline?: boolean }): boolean {
  if (a.size < MIN_ATTACHMENT_BYTES) return true;
  if (a.inline && /^image\//i.test(a.mime)) return true;
  return false;
}

/** Name aus „Vorname Nachname <a@b.de>" oder die Adresse selbst. */
export function displayName(name: string | undefined | null, addr: string): string {
  const n = String(name || "").trim().replace(/^["']|["']$/g, "");
  return n || addr;
}
