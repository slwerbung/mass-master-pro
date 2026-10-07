// „HERO-IDs aus HERO neu laden": Pipeline-Schritte und Dokumenttypen anhand ihrer NAMEN
// den Einstellungen zuordnen. IDs aendern sich, Namen kaum – deshalb Namen als Schluessel.

import type { StepIds } from "./steps.ts";

export function normalizeName(n: string): string {
  return String(n || "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9äöü ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STEP_PATTERNS: Record<keyof StepIds, string> = {
  angebot: "angeboterstellung",
  vor_ort: "vor ort termin",
  detailgespraech: "detailgespr",
  projektplanung: "projektplanung",
  visualisierung: "visualisierung",
  materialbestellung: "materialbestellung",
  produktionsdaten: "produktionsdaten",
  reklamation: "reklamation",
  warten_auftrag: "warten auf auftrag",
  warten_layout: "warten auf layoutfreigabe",
  warten_ware: "warten auf ware",
};
const EXCLUDED_PATTERNS = ["warten auf bezahlung", "abgeschlossen", "archiviert"];

export interface NamedId { id: number | string; name: string }

export function mapSteps(steps: NamedId[]): { steps: Partial<StepIds>; excluded: number[]; missing: string[] } {
  const out: Partial<StepIds> = {};
  const excluded: number[] = [];
  const norm = steps.map((s) => ({ id: Number(s.id), n: normalizeName(s.name) }));
  for (const [key, pat] of Object.entries(STEP_PATTERNS) as [keyof StepIds, string][]) {
    const hit = norm.find((s) => s.n.includes(pat));
    if (hit) out[key] = hit.id;
  }
  for (const pat of EXCLUDED_PATTERNS) {
    const hit = norm.find((s) => s.n.includes(pat));
    if (hit) excluded.push(hit.id);
  }
  const missing = [
    ...(Object.keys(STEP_PATTERNS) as (keyof StepIds)[]).filter((k) => out[k] == null),
    ...EXCLUDED_PATTERNS.filter((p) => !norm.some((s) => s.n.includes(p))),
  ];
  return { steps: out, excluded, missing };
}

const DOC_PATTERNS: Record<string, string> = {
  layouts: "plan layout",
  aufmasse: "aufmassdokument",
  druckdaten: "druckdaten",
};

export function mapDocumentTypes(types: NamedId[]): { found: Record<string, number>; offerTypeId: number | null } {
  const norm = types.map((t) => ({ id: Number(t.id), n: normalizeName(t.name) }));
  const found: Record<string, number> = {};
  for (const [key, pat] of Object.entries(DOC_PATTERNS)) {
    const hit = norm.find((t) => t.n === pat) ?? norm.find((t) => t.n.includes(pat));
    if (hit) found[key] = hit.id;
  }
  const offer = norm.find((t) => t.n === "angebot");
  return { found, offerTypeId: offer?.id ?? null };
}
