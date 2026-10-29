// Themen: ein Gespraechsverlauf (email_threads) ist ein Thema. Reine Logik, ohne Datenbank (topicsDb.ts).
//
// Regeln:
//  * Jede relevante eingehende Mail wird EINMAL vorgelegt, bis sie entschieden ist (`decided_at`). Relevant ist alles
//    ausser den ausgeschlossenen Kategorien (Standard: Werbung/Spam, Newsletter) und an Lexware weitergeleiteten Belegen.
//  * Abgeschlossen = wird nicht weiter verfolgt. Nur eine neue Mail legt es wieder vor.
//  * Wiedervorlage = ruht bis zum Datum, dann wieder „Zu entscheiden“ (eine neue Mail legt es sofort vor).
//  * Laeuft = wird ueberwacht: Kundenmail unbeantwortet seit `unanswered_days` oder keine Bewegung seit
//    `followup_days` -> wieder „Zu entscheiden“. Jede Entscheidung setzt die Frist neu (`reviewed_at`).

import { INBOX_CATEGORIES, type TopicReason, type TopicState } from "./types.ts";

export interface TopicConfig {
  /** Kategorien, die nie vorgelegt werden */
  skip_categories: string[];
  /** Kundenmail unbeantwortet -> nach so vielen Tagen wieder vorlegen */
  unanswered_days: number;
  /** keine Bewegung im Thema -> nach so vielen Tagen wieder vorlegen */
  followup_days: number;
}

export const TOPIC_DEFAULTS: TopicConfig = { skip_categories: ["werbung_spam", "newsletter"], unanswered_days: 2, followup_days: 7 };

const days = (v: unknown, def: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 90 ? n : def;
};

export function normalizeTopicConfig(raw: unknown): TopicConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    skip_categories: Array.isArray(r.skip_categories) ? r.skip_categories.map(String).slice(0, 20) : TOPIC_DEFAULTS.skip_categories,
    unanswered_days: days(r.unanswered_days, TOPIC_DEFAULTS.unanswered_days),
    followup_days: days(r.followup_days, TOPIC_DEFAULTS.followup_days),
  };
}

export interface TopicMessage {
  direction: "in" | "out";
  category: string | null;
  status: string | null;
  beleg_state: string | null;
}

/** Muss diese Mail vorgelegt werden? Unverarbeitete Mails noch nicht – gescheiterte (ohne Kategorie) schon. */
export function isRelevant(m: TopicMessage, cfg: TopicConfig): boolean {
  if (m.direction !== "in") return false;
  if (m.category == null) return m.status === "fehler";
  if (cfg.skip_categories.includes(m.category)) return false;
  return m.beleg_state !== "weitergeleitet";
}

export const isCustomerCategory = (c: string | null) => !!c && (INBOX_CATEGORIES as string[]).includes(c);

export interface TopicFacts {
  state: TopicState;
  snoozedUntil: string | null;
  reviewedAt: string | null;
  /** juengste relevante eingehende Mail */
  lastIn: string | null;
  /** juengste ausgehende Mail */
  lastOut: string | null;
  /** relevante eingehende Mails ohne Entscheidung */
  undecided: number;
  /** schon einmal eine relevante Mail entschieden (fuer „wieder offen“) */
  hadDecided: boolean;
  openSuggestions: number;
  /** mindestens eine Kundenmail im Thema */
  customer: boolean;
}

export interface TopicStatus {
  due: boolean;
  reason: TopicReason | null;
  /** wann die Ueberwachung das Thema wieder vorlegt (laufende Themen) bzw. das Datum der Wiedervorlage */
  nextCheck: string | null;
  /** seit so vielen Tagen unbeantwortet / ohne Bewegung */
  days: number | null;
}

const DAY = 86_400_000;
const t = (s: string | null) => (s ? Date.parse(s) : NaN);
const maxTime = (...xs: (string | null)[]) => Math.max(...xs.map(t).filter((n) => !Number.isNaN(n)), 0);

export function topicStatus(f: TopicFacts, cfg: TopicConfig, now: Date): TopicStatus {
  const nowMs = now.getTime();
  if (f.undecided > 0) {
    return { due: true, reason: f.state === "erledigt" && f.hadDecided ? "wieder_offen" : "neu", nextCheck: null, days: null };
  }
  if (f.state === "erledigt") return { due: false, reason: null, nextCheck: null, days: null };
  if (f.state === "wiedervorlage") {
    const until = t(f.snoozedUntil);
    if (Number.isNaN(until) || until <= nowMs) return { due: true, reason: "wiedervorlage", nextCheck: f.snoozedUntil, days: null };
    return { due: false, reason: null, nextCheck: f.snoozedUntil, days: null };
  }
  if (f.openSuggestions > 0) return { due: true, reason: "vorschlag", nextCheck: null, days: null };

  // Laeuft: ueberwachen.
  const unanswered = f.customer && t(f.lastIn) > (t(f.lastOut) || 0);
  const limit = unanswered ? cfg.unanswered_days : cfg.followup_days;
  const quietSince = unanswered ? t(f.lastIn) : maxTime(f.lastIn, f.lastOut);
  const anchor = Math.max(quietSince || 0, t(f.reviewedAt) || 0);
  if (!anchor) return { due: false, reason: null, nextCheck: null, days: null };
  const next = anchor + limit * DAY;
  const quietDays = Math.floor((nowMs - (quietSince || anchor)) / DAY);
  if (next <= nowMs) return { due: true, reason: unanswered ? "unbeantwortet" : "nachfassen", nextCheck: new Date(next).toISOString(), days: quietDays };
  return { due: false, reason: null, nextCheck: new Date(next).toISOString(), days: null };
}

/** Datum (YYYY-MM-DD) einer Wiedervorlage pruefen: ab morgen, hoechstens zwei Jahre. */
export function validSnoozeDate(date: unknown, today: string): string | null {
  const d = String(date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T12:00:00Z`))) return null;
  if (d <= today) return null;
  const max = new Date(Date.parse(`${today}T12:00:00Z`) + 730 * DAY).toISOString().slice(0, 10);
  return d > max ? null : d;
}

/** Kurzbeschreibung des Grundes fuer die Karte („Seit 3 Tagen unbeantwortet“). */
export function reasonText(s: TopicStatus, note: string | null): string {
  switch (s.reason) {
    case "unbeantwortet": return `Kundenmail seit ${s.days ?? "?"} Tagen unbeantwortet`;
    case "nachfassen": return `Seit ${s.days ?? "?"} Tagen keine Bewegung – nachfassen oder abschließen?`;
    case "wiedervorlage": return note ? `Wiedervorlage: ${note}` : "Wiedervorlage";
    case "wieder_offen": return "Neue Mail in einem abgeschlossenen Thema";
    case "vorschlag": return "Vorschlag offen";
    case "neu": return "Neue Mail";
    default: return "";
  }
}
