// Nachfassen: reine Hilfen (Vorlagen, Versandfenster, Empfaenger, Autopilot-Vorrang). Kein Netz, keine Datenbank.

export type AutopilotMode = "off" | "suggest" | "auto";
export const isMode = (m: unknown): m is AutopilotMode => m === "off" || m === "suggest" || m === "auto";

/** Autopilot: die Einstellung am Projekt schlaegt die der Regel. */
export function effectiveAutopilot(rule: unknown, project?: unknown): AutopilotMode {
  if (isMode(project)) return project;
  return isMode(rule) ? rule : "off";
}

export interface SendWindow { days: number[]; from: number; to: number }
export const DEFAULT_WINDOW: SendWindow = { days: [1, 2, 3, 4, 5], from: 8, to: 17 };

/** app_config.projects_followup_hours: {"days":[1..5],"from":8,"to":17}, 1 = Montag … 7 (oder 0) = Sonntag, Stunden Ortszeit. */
export function parseWindow(raw: unknown): SendWindow {
  try {
    const j = typeof raw === "string" ? JSON.parse(raw) : raw;
    const days = Array.isArray((j as any)?.days) ? (j as any).days.map(Number).filter((d: number) => d >= 0 && d <= 7) : DEFAULT_WINDOW.days;
    const from = Number((j as any)?.from), to = Number((j as any)?.to);
    return { days: days.length ? days : DEFAULT_WINDOW.days, from: Number.isFinite(from) ? from : DEFAULT_WINDOW.from, to: Number.isFinite(to) ? to : DEFAULT_WINDOW.to };
  } catch {
    return DEFAULT_WINDOW;
  }
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Berliner Wochentag (1 = Mo … 7 = So), Stunde und Datum "YYYY-MM-DD" fuer einen Zeitpunkt. */
export function berlinParts(now: Date): { weekday: number; hour: number; date: string } {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now)) p[x.type] = x.value;
  return { weekday: WEEKDAY[p.weekday] ?? 0, hour: Number(p.hour), date: `${p.year}-${p.month}-${p.day}` };
}

/** Darf jetzt automatisch gesendet werden? (Berliner Ortszeit; `to` ist exklusiv.) */
export function inSendWindow(now: Date, w: SendWindow): boolean {
  const { weekday, hour } = berlinParts(now);
  const dayOk = w.days.includes(weekday) || (weekday === 7 && w.days.includes(0));
  return dayOk && hour >= w.from && hour < w.to;
}

/** Beginn des Berliner Tages als ISO-Zeitpunkt (fuer „heute bereits gesendet“). */
export function berlinDayStartIso(now: Date): string {
  const { date } = berlinParts(now);
  for (const off of ["+01:00", "+02:00"]) {
    const d = new Date(`${date}T00:00:00${off}`);
    if (berlinParts(d).date === date && berlinParts(d).hour === 0) return d.toISOString();
  }
  return new Date(`${date}T00:00:00Z`).toISOString();
}

export const fmtDateDe = (iso: string | null | undefined): string => {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const p = berlinParts(new Date(t));
  return `${p.date.slice(8, 10)}.${p.date.slice(5, 7)}.${p.date.slice(0, 4)}`;
};

export interface TemplateVars { kunde?: string; projekt?: string; angebot_nr?: string; angebot_datum?: string }

/** Platzhalter {kunde} {projekt} {angebot_nr} {angebot_datum} einsetzen; unbekannte bleiben unveraendert. */
export function renderTemplate(text: string, vars: TemplateVars): string {
  return String(text ?? "").replace(/\{(kunde|projekt|angebot_nr|angebot_datum)\}/g, (_m, k: keyof TemplateVars) => vars[k] ?? "");
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
export const looksLikeEmail = (s: string) => EMAIL.test(String(s || "").trim());

/**
 * Empfaenger: zuerst die Absenderadresse der letzten Kundenmail zu diesem Projekt (Antwort im selben Thread),
 * sonst die E-Mail des Projektkunden. Eigene Adressen (Postfaecher) und Unbrauchbares sind nie Empfaenger.
 */
export function pickRecipient(lastIncomingFrom: string | null | undefined, kundeEmail: string | null | undefined, own: string[]): string | null {
  const mine = new Set(own.map((a) => a.trim().toLowerCase()));
  for (const c of [lastIncomingFrom, kundeEmail]) {
    const v = String(c || "").trim().toLowerCase();
    if (v && looksLikeEmail(v) && !mine.has(v)) return v;
  }
  return null;
}

export const FOLLOWUP_GREETING = "Beste Grüße";
// Anrede-Woerter, die Du ODER Sie verraten (gross geschrieben, wie am Satzanfang bzw. in der Hoeflichkeitsform; „sie“ = die Leute bleibt erlaubt).
const FORMAL = /\b(Sie|Ihnen|Ihr|Ihre|Ihrem|Ihren|Ihrer|Ihres)\b/;
const INFORMAL = /\b(du|dir|dich|dein|deine|deinem|deinen|deiner|deines)\b/i;

/**
 * Regeln fuer Nachfass-Vorlagen: neutral (weder Du noch Sie), Gruss genau „Beste Grüße“ als letzte Zeile, keine Firmennennung.
 * Die Signatur des Mitarbeiters haengt beim Senden automatisch an. null = in Ordnung, sonst die Fehlermeldung.
 */
export function checkTemplateText(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`;
  if (FORMAL.test(text) || INFORMAL.test(text)) return "Bitte neutral formulieren – weder „Du“ noch „Sie“ (auch nicht „Ihr/Ihre“, „dein/deine“).";
  if (/SL\s*WERBUNG/i.test(text)) return "Keine Firmennennung im Text – die Signatur des Mitarbeiters hängt automatisch an.";
  const last = body.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  if (last !== FOLLOWUP_GREETING) return `Die letzte Zeile muss „${FOLLOWUP_GREETING}“ sein (danach folgt automatisch die Signatur).`;
  return null;
}
