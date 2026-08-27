// Terminbuchungs-Engine — Domänentypen (M2).
// Reine Typen, keine Laufzeit-Abhängigkeiten. Werden sowohl von der Engine
// (Deno/Edge) als auch von den Unit-Tests (Node/Vitest) importiert.

export type AssignmentMode = "fixed" | "round_robin" | "collective" | "by_skill";

export interface Geo {
  lat: number;
  lng: number;
}

/** Fahrzeit-Anbieter (§8.3). Interface bewusst schmal + austauschbar. */
export interface TravelTimeProvider {
  /** Fahrzeit in Minuten zwischen zwei Punkten. Null/undefined → 0. */
  minutesBetween(from: Geo | null | undefined, to: Geo | null | undefined): number | Promise<number>;
}

export interface Staff {
  id: string;
  skills: string[];
  homeBase?: Geo | null;
}

/** Zeiten als "HH:MM" (lokale Zeit in `timezone`). weekday 0=So … 6=Sa. */
export interface WorkingHours {
  staffId: string;
  weekday: number;
  start: string;
  end: string;
}

/** date als "YYYY-MM-DD". isAvailable=false ⇒ frei (ganztägig, wenn ohne Zeit;
 *  mit Zeiten ⇒ dieser Bereich fällt weg). isAvailable=true ⇒ Zusatzfenster. */
export interface WorkingHoursException {
  staffId: string;
  date: string;
  isAvailable: boolean;
  start?: string | null;
  end?: string | null;
}

/** Belegter Block. Nur solche mit blocks_availability=true übergeben. */
export interface BusyBlock {
  staffId: string;
  startsAt: string | Date;
  endsAt: string | Date;
  geo?: Geo | null;
}

/** Kern-Konfiguration eines Regelsets (Teilmenge von rule_set, §4). */
export interface RuleSetConfig {
  durationMinutes: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  travelBuffer: boolean;
  minNoticeMin: number;
  bookingWindowDays: number;
  slotGranularityMin: number;
  maxPerDayGlobal?: number | null;
  maxPerDayPerStaff?: number | null;
  assignmentMode: AssignmentMode;
  requiredSkills: string[];
  /** für assignment_mode='fixed' */
  fixedStaffId?: string | null;
  /** config.reserve_slots: ISO-Startzeiten, die NICHT öffentlich angeboten werden */
  reserveSlots?: string[];
}

export interface Slot {
  /** ISO-8601 (UTC) */
  startsAt: string;
  endsAt: string;
  /** gesetzt außer bei 'collective' */
  assignedStaffId?: string;
  /** nur bei 'collective' */
  staffIds?: string[];
}

export interface ComputeInput {
  ruleSet: RuleSetConfig;
  staffPool: Staff[];
  workingHours: WorkingHours[];
  exceptions: WorkingHoursException[];
  /** nur relevante Blocks (blocks_availability = true) */
  busyBlocks: BusyBlock[];
  /** staffId → "YYYY-MM-DD" (in tz) → Anzahl bereits bestehender Buchungen */
  existingBookingsCountPerDay?: Record<string, Record<string, number>>;
  /** "YYYY-MM-DD" (in tz) → Anzahl (für max_per_day_global) */
  globalBookingsCountPerDay?: Record<string, number>;
  range: { from: string | Date; to: string | Date };
  now: string | Date;
  /** Zieladresse des Termins (für Fahrzeit-Puffer) */
  address?: Geo | null;
  /** IANA-Zone, default "Europe/Berlin" */
  timezone?: string;
  travelProvider?: TravelTimeProvider;
}
