// Regeln: aus einem Projekt wird hoechstens EIN Signal (die erste passende, aktive Regel gewinnt).
// Rein rechnerisch, ohne Datenbank und ohne HERO – deshalb gut testbar. Schwellen kommen aus project_rules
// und project_step_settings, nie aus dem Code.

import { confirmations, latest, normalizeDocuments, sentOffers, unsentOffers, type HeroDoc } from "./docs.ts";
import { RULE_STEP_KEYS, displayStepName } from "./steps.ts";

export type Category = "kunde" | "auftrag" | "termine" | "pflege";

export interface RuleRow {
  key: string; label: string; category: Category; threshold_days: number | null; suggestion: string;
  channel: string; followup_days: number | null; followup_reason: string; autopilot: string; sort: number; active: boolean;
}
export interface StepSetting { step_id: number; name: string; key: string; target_days: number; excluded: boolean; closeness: number }
/** Bereits gesendete Nachfass-Mails bzw. erledigte Anrufe (Stufe 2) eines Projekts. */
export interface SentFollowup { rule_key: string; stage: number; sent_at: string }
export interface ProjectRow {
  hero_id: number; project_nr: string; name: string; step_id: number | null; step_name: string; step_key: string;
  step_since: string | null; hero_created: string | null; documents: unknown;
  followups?: SentFollowup[];
}
export interface Signal {
  ruleKey: string; category: Category; days: number; closeness: number; bundled: boolean; priority: number;
  reasons: { text: string; days: number; stepName: string; offerDate?: string | null };
}
export interface EvalContext {
  now: Date;
  bundleAfterDays: number;
  rules: Map<string, RuleRow>;
  steps: Map<number, StepSetting>;
}

const DAY = 86_400_000;
export const daysBetween = (from: string | null, now: Date): number => {
  const t = from ? Date.parse(from) : NaN;
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now.getTime() - t) / DAY));
};
const RANK: Record<Category, number> = { kunde: 1, auftrag: 2, termine: 3, pflege: 4 };

/** Aufsteigend sortieren: Kategorie, dann hoehere Naehe zum Abschluss, dann laengere Verweildauer. */
export function priorityOf(category: Category, closeness: number, days: number): number {
  return RANK[category] * 1_000_000_000 + (999 - Math.min(Math.max(closeness, 0), 999)) * 1_000_000 + (999_999 - Math.min(days, 999_999));
}

const tage = (n: number) => (n === 1 ? "1 Tag" : `${n} Tagen`);

/** Signal fuer ein Projekt oder null (nichts zu tun / ausgeschlossener Status). */
export function evaluateProject(p: ProjectRow, ctx: EvalContext): Signal | null {
  const step = p.step_id != null ? ctx.steps.get(p.step_id) : undefined;
  if (step?.excluded) return null;
  const key = p.step_key;
  const days = daysBetween(p.step_since ?? p.hero_created, ctx.now);
  const target = step?.target_days ?? 7;
  const closeness = step?.closeness ?? 0;
  const stepName = displayStepName(p.step_name);
  const docs: HeroDoc[] = normalizeDocuments(p.documents);
  const sent = sentOffers(docs);
  const unsent = unsentOffers(docs);
  const hasAb = confirmations(docs).length > 0;
  const lastSent = latest(sent);
  const offerDays = lastSent ? daysBetween(lastSent.created, ctx.now) : 0;
  // Nachfass-Kette gilt je Angebot: ein neues (erneut versendetes) Angebot beginnt wieder bei Stufe 1.
  const sinceOffer = (stage: number) => (p.followups ?? [])
    .filter((f) => f.rule_key === "nachfassen" && f.stage === stage && (!lastSent?.created || Date.parse(f.sent_at) >= Date.parse(lastSent.created)))
    .sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))[0] ?? null;
  const stage1 = sinceOffer(1);
  const stage2 = sinceOffer(2);

  const make = (ruleKey: string, d: number, text: string, extra: Partial<Signal["reasons"]> = {}): Signal | null => {
    const rule = ctx.rules.get(ruleKey);
    if (!rule || !rule.active) return null;
    return {
      ruleKey, category: rule.category, days: d, closeness,
      bundled: d > ctx.bundleAfterDays,
      priority: priorityOf(rule.category, closeness, d),
      reasons: { text, days: d, stepName, ...extra },
    };
  };
  const thr = (k: string, fallback: number) => ctx.rules.get(k)?.threshold_days ?? fallback;

  // Reihenfolge = Reihenfolge der Spec; die erste passende, aktive Regel gewinnt.
  const candidates: (() => Signal | null)[] = [
    () => (key === "reklamation" ? make("reklamation", days, `Reklamation seit ${tage(days)} offen.`) : null),
    () => (key === "freigabe" && days > thr("freigabe_offen", 5)
      ? make("freigabe_offen", days, `Seit ${tage(days)} wartet das Layout auf die Freigabe des Kunden.`) : null),
    () => (key === "abholung" && days > thr("abholung", 7)
      ? make("abholung", days, `Seit ${tage(days)} fertig zur Abholung.`) : null),
    () => (key === "anfragen" && !lastSent ? make("anfrage_ohne_angebot", days, `Anfrage seit ${tage(days)} ohne versendetes Angebot.`) : null),
    () => (key === "anfragen" && lastSent
      ? make("anfrage_status_alt", days, `Angebot ist schon versendet, der Status steht noch auf „${stepName}“.`, { offerDate: lastSent.created }) : null),
    () => (key === "angebot" || (!lastSent && unsent.length > 0 && !hasAb && key !== "warten_auftrag" && key !== "anfragen")
      ? make("angebot_entwurf", days, `Angebot ist noch nicht fertig versendet (seit ${tage(days)} im Status „${stepName}“).`) : null),
    // Stufe 3: 30 Tage nach Angebotsversand „Angebot verloren?“ (Vorschlag: archivieren).
    () => (key === "warten_auftrag" && lastSent && offerDays >= thr("nachfassen_verloren", 30)
      ? make("nachfassen_verloren", offerDays, `Angebot vor ${tage(offerDays)} versendet und nie beantwortet – verloren?`, { offerDate: lastSent.created }) : null),
    // Stufe 2: 7 Tage nach der Nachfass-Mail anrufen.
    () => (key === "warten_auftrag" && lastSent && stage1 && !stage2 && daysBetween(stage1.sent_at, ctx.now) >= thr("nachfassen_anruf", 7)
      ? make("nachfassen_anruf", daysBetween(stage1.sent_at, ctx.now), `Nachfass-Mail vor ${tage(daysBetween(stage1.sent_at, ctx.now))} gesendet, keine Antwort – bitte anrufen.`, { offerDate: lastSent.created }) : null),
    // Stufe 1: Mail 7 Tage nach Angebotsversand (nur, solange noch keine Nachfass-Mail zu diesem Angebot raus ist).
    () => (key === "warten_auftrag" && lastSent && !stage1 && offerDays >= thr("nachfassen", 7)
      ? make("nachfassen", offerDays, `Angebot vor ${tage(offerDays)} versendet, noch keine Antwort.`, { offerDate: lastSent.created }) : null),
    () => ((key === "planung" || key === "material") && !hasAb && days > thr("ab_fehlt", 2)
      ? make("ab_fehlt", days, `Seit ${tage(days)} im Status „${stepName}“, aber keine Auftragsbestätigung.`) : null),
    () => ((key === "planung" || key === "material") && hasAb && days > thr("termine_fehlen", 7)
      ? make("termine_fehlen", days, `Seit ${tage(days)} im Status „${stepName}“ mit AB, Termine fehlen noch.`) : null),
    () => (!RULE_STEP_KEYS.has(key) && days > target
      ? make("haengt", days, `Seit ${tage(days)} im Status „${stepName}“ (Sollzeit ${target} Tage).`) : null),
  ];
  for (const c of candidates) {
    const s = c();
    if (s) return s;
  }
  // Auffangnetz: ausserhalb der Sollzeit, aber keine Regel greift -> „Nächsten Schritt planen“.
  if (days > target) return make("waise", days, `Seit ${tage(days)} im Status „${stepName}“ ohne nächsten Schritt.`);
  return null;
}

/** Ausserhalb der Sollzeit? (Grundlage des Waisen-Checks.) */
export function outsideTarget(p: ProjectRow, ctx: EvalContext): boolean {
  const step = p.step_id != null ? ctx.steps.get(p.step_id) : undefined;
  if (step?.excluded) return false;
  return daysBetween(p.step_since ?? p.hero_created, ctx.now) > (step?.target_days ?? 7);
}
