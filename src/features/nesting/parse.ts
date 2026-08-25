// Text input parsing. One line per part, core "<Breite> x <Höhe>".
// Accepts x, ×, * and both . and , as decimal separators.

import type { Teil } from "./types";

const MASS_RE = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i;

export function parseZeile(zeile: string, index: number): Teil | null {
  const m = MASS_RE.exec(zeile);
  if (!m) return null;
  const num = (s: string) => parseFloat(s.replace(",", "."));
  const vorDoppelpunkt = zeile.split(":")[0].trim().replace(/\s+/g, "");
  const label = vorDoppelpunkt || `T${index + 1}`;
  return { label, breite: num(m[1]), hoehe: num(m[2]) };
}

/** Parses a multi-line text block. Empty lines / lines without a measure are skipped. */
export function parseText(text: string): Teil[] {
  const out: Teil[] = [];
  const lines = String(text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = parseZeile(lines[i], out.length);
    if (t) out.push(t);
  }
  return out;
}

/** Serialises parts back to the editable text form ("F1: 500 x 300 mm"). */
export function teileZuText(teile: Teil[]): string {
  const fmt = (n: number) => String(n).replace(".", ",");
  return teile.map((t) => `${t.label}: ${fmt(t.breite)} x ${fmt(t.hoehe)} mm`).join("\n");
}
