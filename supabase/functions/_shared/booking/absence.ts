// Abwesenheiten (Urlaub, Krankheit) aus HERO in sperrbare Zeitraeume.
//
// Eigene Datei, damit die eine Regel, die hier leicht falsch wird, pruefbar
// ist: HERO nennt als `end` den LETZTEN Tag der Abwesenheit, nicht den ersten
// Tag danach. Wer das Datum als Ende nimmt, laesst den letzten Urlaubstag
// buchbar — und genau dieser Tag ist der, an dem jemand anruft.

import { DateTime } from "luxon";

const TZ = "Europe/Berlin";

/**
 * Welche Abwesenheiten sperren.
 *
 * `approved` ist klar. `submitted` (beantragt, noch nicht genehmigt) sperrt
 * ebenfalls: einen Termin in einen beantragten Urlaub zu legen macht mehr
 * Arbeit als eine Zeit zu viel zu sperren. `draft` (noch im Eintippen),
 * `rejected` und `deleted` sperren nicht — wird ein Antrag abgelehnt, fliegt
 * die Sperre beim naechsten Abgleich von selbst wieder raus.
 */
export const ABSENCE_STATUSES = ["approved", "submitted"];

/** Praefix im `source_ref`, damit Abwesenheit und Termin sich nie beissen. */
export const ABSENCE_REF = "abs-";

/**
 * Datumsspanne einer Abwesenheit -> echter Zeitraum zum Sperren.
 *
 * Gesperrt wird von 00:00 des ersten bis 23:59:59 des LETZTEN Tages, in
 * Ortszeit gerechnet (sonst fehlt im Sommer die erste Stunde). Halbe Tage
 * (`start_budget`/`end_budget` in HERO) werden absichtlich als ganzer Tag
 * gesperrt: eine Stunde zu viel gesperrt kostet nichts, ein Termin mitten im
 * Urlaub schon.
 *
 * `null` bei unbrauchbaren Werten — dann wird nichts gesperrt, statt eine
 * kaputte Zeile zu schreiben.
 */
export function absenceSpan(
  start: string | null | undefined,
  end?: string | null,
): { startsAt: string; endsAt: string } | null {
  const von = String(start ?? "").slice(0, 10);
  const bis = String(end || start || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) return null;
  if (bis < von) return null;

  const ab = DateTime.fromISO(von, { zone: TZ }).startOf("day");
  const zu = DateTime.fromISO(bis, { zone: TZ }).endOf("day");
  if (!ab.isValid || !zu.isValid || zu <= ab) return null;

  return { startsAt: ab.toUTC().toISO()!, endsAt: zu.toUTC().toISO()! };
}
