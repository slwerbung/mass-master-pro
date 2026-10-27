// Wie lange dauert dieser EINE Termin?
//
// Eine Terminart hat eine Standarddauer. Manche Terminarten („Montage vor Ort")
// dauern aber von Auftrag zu Auftrag anders lang, deshalb darf die Dauer beim
// Erstellen des Links festgelegt werden und steht dann IM Link:
//   * aus der App:        ...?art=montage_vor_ort&d=240
//   * HERO-Mailvorlage:   .../montage_vor_ort/d240   (alles im Pfad, weil der
//     Vorlagen-Editor hinter einem `&` abschneidet — siehe docs/terminbuchung.md)
//
// Ein Link ist von Hand aenderbar. Deshalb entscheidet NIE der Link allein,
// sondern immer diese Datei gegen die Terminart:
//   * Terminart nicht einstellbar  -> Standarddauer, Wunsch wird ignoriert
//   * Wunsch unlesbar              -> Standarddauer
//   * Wunsch ausserhalb der Grenzen-> geklemmt (nicht abgelehnt)
//
// Warum klemmen und nicht ablehnen: ein Link lebt Wochen. Senkt jemand im
// Adminmenue das Maximum, oder vertippt sich eine Mailvorlage, waere der Link
// sonst tot und der Kunde koennte gar nichts buchen. Geklemmt bucht er eine
// erlaubte Laenge — und sieht sie auf der Seite, weil die Buchungsseite die
// Dauer anzeigt, die hier herauskommt.

/** Die Felder der Terminart, auf die es hier ankommt. */
export interface DurationRule {
  duration_minutes: number;
  duration_choosable?: boolean | null;
  duration_min_minutes?: number | null;
  duration_max_minutes?: number | null;
}

/** Wie die Dauer in einem Pfadsegment steht: `d240`. */
const SEGMENT = /^[dD](\d{1,4})$/;

/** Obergrenze, falls die Terminart keine nennt: ein voller Arbeitstag plus Luft. */
const OBERGRENZE = 12 * 60;

/**
 * Eine Dauer aus einem Pfadsegment lesen. `null`, wenn das Segment keine ist.
 *
 * Gebraucht fuer die Vorlagenform, in der alles im Pfad steht. Das `d` ist
 * Pflicht: ohne Praefix waere `240` nicht von einer Projektnummer zu
 * unterscheiden, und genau das stand schon einmal im Pfad.
 */
export function durationFromSegment(segment: string | null | undefined): number | null {
  const m = SEGMENT.exec(String(segment ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Ist dieses Segment eine Dauerangabe? (Fuer das Zerlegen des Pfads.) */
export const istDauerSegment = (segment: string | null | undefined): boolean =>
  durationFromSegment(segment) != null;

/** So schreibt sich eine Dauer in einen Link. */
export const durationToSegment = (minuten: number): string => `d${Math.round(minuten)}`;

/**
 * Erlaubter Bereich. Ohne Grenzen in der Terminart ist die Standarddauer
 * gleichzeitig die Grenze — eine nicht einstellbare Terminart hat damit genau
 * eine erlaubte Dauer.
 */
export function durationBounds(rule: DurationRule): { min: number; max: number } {
  const standard = Math.max(1, Math.round(Number(rule.duration_minutes) || 0));
  if (!rule.duration_choosable) return { min: standard, max: standard };

  const rohMin = Number(rule.duration_min_minutes);
  const rohMax = Number(rule.duration_max_minutes);
  let min = Number.isFinite(rohMin) && rohMin > 0 ? Math.round(rohMin) : Math.min(standard, 15);
  let max = Number.isFinite(rohMax) && rohMax > 0 ? Math.round(rohMax) : Math.max(standard, OBERGRENZE);
  // Die Standarddauer muss im Bereich liegen, sonst waere die Vorgabe selbst
  // nicht buchbar.
  min = Math.min(min, standard);
  max = Math.max(max, standard);
  if (max < min) max = min;
  return { min, max };
}

export interface DurationResult {
  /** Die Dauer, mit der gerechnet und gebucht wird. */
  minutes: number;
  /**
   * Woher sie kommt:
   *   `standard`  — Vorgabe der Terminart (kein oder kein brauchbarer Wunsch)
   *   `link`      — so wie im Link gewuenscht
   *   `geklemmt`  — Wunsch lag ausserhalb der Grenzen und wurde angepasst
   *   `fest`      — es gab einen Wunsch, aber die Terminart ist nicht einstellbar
   */
  source: "standard" | "link" | "geklemmt" | "fest";
  min: number;
  max: number;
}

/**
 * Die Dauer dieses Termins. Einzige Stelle, die darueber entscheidet —
 * `booking-api` (Verfuegbarkeit und Buchen) und `booking-invite` (Linkbau)
 * rufen alle hier an, damit im Link, im Kalender und in der Mail dieselbe
 * Zahl steht.
 */
export function effectiveDuration(rule: DurationRule, wunsch: unknown): DurationResult {
  const { min, max } = durationBounds(rule);
  const standard = Math.max(1, Math.round(Number(rule.duration_minutes) || 0));

  const roh = typeof wunsch === "string" ? wunsch.trim() : wunsch;
  const zahl = typeof roh === "number" ? roh : (roh === "" || roh == null ? NaN : Number(roh));
  if (!Number.isFinite(zahl) || zahl <= 0) {
    return { minutes: standard, source: "standard", min, max };
  }
  if (!rule.duration_choosable) {
    return { minutes: standard, source: "fest", min, max };
  }

  const gewuenscht = Math.round(zahl as number);
  if (gewuenscht < min) return { minutes: min, source: "geklemmt", min, max };
  if (gewuenscht > max) return { minutes: max, source: "geklemmt", min, max };
  return { minutes: gewuenscht, source: "link", min, max };
}

/**
 * Dauer als Text, wie sie Kunde und Mitarbeiter lesen: „90 Minuten",
 * „4 Stunden", „3,5 Stunden". Deutsch, mit Komma.
 */
export function durationLabel(minuten: number): string {
  const m = Math.max(0, Math.round(minuten));
  if (m < 60) return `${m} Minuten`;
  const stunden = m / 60;
  const text = Number.isInteger(stunden)
    ? String(stunden)
    : stunden.toFixed(1).replace(".", ",");
  const rest = m % 60;
  if (rest !== 0 && rest !== 30) return `${Math.floor(m / 60)} Std. ${rest} Min.`;
  return `${text} ${stunden === 1 ? "Stunde" : "Stunden"}`;
}
