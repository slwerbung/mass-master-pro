// Kalendereintrag (.ics) fuer die Terminmail.
//
// Reines Modul ohne IO: das Format ist streng (RFC 5545) und faellt bei
// Kleinigkeiten auf die Nase — nicht escapte Kommas, zu lange Zeilen, falsche
// Zeitangaben. Outlook ist da besonders empfindlich. Deshalb hier und mit
// Tests, statt irgendwo in einer Edge Function zusammengeklebt.

export interface IcsEvent {
  /** Stabil ueber Aenderungen hinweg — sonst legt der Kalender einen zweiten Termin an. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  organizer?: { name: string; email: string };
  /** Hochzaehlen, wenn derselbe Termin erneut verschickt wird. */
  sequence?: number;
  /** "CANCEL" macht aus der Einladung eine Absage. */
  method?: "REQUEST" | "CANCEL";
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** Nur fuer Tests: sonst "jetzt". */
  stamp?: Date;
}

/** 2026-09-24T09:45:00Z -> 20260924T094500Z */
export function icsDate(d: Date): string {
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/**
 * Textwerte escapen. Reihenfolge ist wichtig: erst der Backslash, sonst
 * werden die gerade eingefuegten Escapes noch einmal escapet.
 */
export function icsEscape(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Zeilen auf 75 Oktette falten (Fortsetzung beginnt mit einem Leerzeichen).
 * Gezaehlt werden Bytes, nicht Zeichen — ein Umlaut braucht zwei, und ein
 * Schnitt mitten im Zeichen macht die Datei kaputt.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  // Erste Zeile 75 Oktette, Folgezeilen 74 (das fuehrende Leerzeichen zaehlt mit).
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Nicht mitten in einem UTF-8-Zeichen schneiden.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(dec.decode(bytes.slice(start, end)));
    start = end;
    limit = 74;
  }
  return parts[0] + parts.slice(1).map((p) => `\r\n ${p}`).join("");
}

/** Baut die .ics-Datei. Zeilenenden sind CRLF, das verlangt der Standard. */
export function buildIcs(ev: IcsEvent): string {
  const method = ev.method ?? "REQUEST";
  const status = ev.status ?? (method === "CANCEL" ? "CANCELLED" : "CONFIRMED");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SL WERBUNG//Captfix//DE",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${icsDate(ev.stamp ?? new Date())}`,
    `DTSTART:${icsDate(ev.start)}`,
    `DTEND:${icsDate(ev.end)}`,
    `SEQUENCE:${ev.sequence ?? 0}`,
    `STATUS:${status}`,
    `SUMMARY:${icsEscape(ev.summary)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  if (ev.organizer) {
    lines.push(`ORGANIZER;CN=${icsEscape(ev.organizer.name)}:mailto:${ev.organizer.email}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Base64 fuer den Mailanhang (Resend erwartet den Inhalt so). */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
