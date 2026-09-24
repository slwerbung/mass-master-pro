// Reine Abbildung DB-Zeilen → ComputeInput der Engine. KEIN Supabase/IO hier,
// damit die Verdrahtung (Kategorie-Filter §7, Tages-Buckets, Geo) unit-testbar
// bleibt. Die Edge Function lädt die Zeilen und ruft nur diese Funktion.

import { DateTime } from "luxon";
import type { BusyBlock, ComputeInput, Geo, RuleSetConfig, Staff, WorkingHours, WorkingHoursException } from "./types.ts";

export interface RuleSetRow {
  id: string;
  duration_minutes: number;
  duration_options?: number[] | null;
  buffer_before_min: number;
  buffer_after_min: number;
  travel_buffer: boolean;
  min_notice_min: number;
  booking_window_days: number;
  slot_granularity_min: number;
  max_per_day_global?: number | null;
  max_per_day_per_staff?: number | null;
  assignment_mode: RuleSetConfig["assignmentMode"];
  required_skills?: string[] | null;
  config?: Record<string, unknown> | null;
}
export interface StaffRow { id: string; skills?: string[] | null; home_base_lat?: number | null; home_base_lng?: number | null }
export interface WorkingHoursRow { staff_id: string; weekday: number; start_time: string; end_time: string }
export interface ExceptionRow { staff_id: string; date: string; is_available: boolean; start_time?: string | null; end_time?: string | null }
export interface BusyRow { staff_id: string; starts_at: string; ends_at: string; category_key?: string | null; geo_lat?: number | null; geo_lng?: number | null }
export interface BookingCountRow { staff_id: string; starts_at: string; status: string }

const hhmm = (t: string) => t.slice(0, 5); // "08:00:00" → "08:00"
const geoOf = (lat?: number | null, lng?: number | null): Geo | null =>
  (lat != null && lng != null) ? { lat, lng } : null;

export function ruleSetConfigFromRow(r: RuleSetRow): RuleSetConfig {
  const cfg = (r.config ?? {}) as Record<string, unknown>;
  return {
    durationMinutes: r.duration_minutes,
    bufferBeforeMin: r.buffer_before_min,
    bufferAfterMin: r.buffer_after_min,
    travelBuffer: r.travel_buffer,
    minNoticeMin: r.min_notice_min,
    bookingWindowDays: r.booking_window_days,
    slotGranularityMin: r.slot_granularity_min,
    maxPerDayGlobal: r.max_per_day_global ?? null,
    maxPerDayPerStaff: r.max_per_day_per_staff ?? null,
    assignmentMode: r.assignment_mode,
    requiredSkills: r.required_skills ?? [],
    fixedStaffId: (cfg.fixed_staff_id as string) ?? null,
    reserveSlots: (cfg.reserve_slots as string[]) ?? [],
  };
}

export interface BuildArgs {
  ruleSet: RuleSetRow;
  staff: StaffRow[];
  workingHours: WorkingHoursRow[];
  exceptions: ExceptionRow[];
  busy: BusyRow[];
  /** Buchungen (pending/confirmed) im Zeitraum — für Tageslimits/Fairness. */
  bookingCounts: BookingCountRow[];
  /** key → blocks_availability. Unbekannt/fehlt ⇒ blockiert (sicher, §7). */
  categoryBlocks: Record<string, boolean>;
  now: string | Date;
  from: string | Date;
  to: string | Date;
  address?: Geo | null;
  timezone?: string;
}

export function buildComputeInput(a: BuildArgs): ComputeInput {
  const tz = a.timezone || "Europe/Berlin";
  const staffPool: Staff[] = a.staff.map((s) => ({
    id: s.id,
    skills: s.skills ?? [],
    homeBase: geoOf(s.home_base_lat, s.home_base_lng),
  }));
  const workingHours: WorkingHours[] = a.workingHours.map((w) => ({
    staffId: w.staff_id, weekday: w.weekday, start: hhmm(w.start_time), end: hhmm(w.end_time),
  }));
  const exceptions: WorkingHoursException[] = a.exceptions.map((x) => ({
    staffId: x.staff_id, date: x.date, isAvailable: x.is_available,
    start: x.start_time ? hhmm(x.start_time) : null,
    end: x.end_time ? hhmm(x.end_time) : null,
  }));
  // Nur Blocks relevanter Kategorien (§7). category_key null ⇒ blockiert.
  const busyBlocks: BusyBlock[] = a.busy
    .filter((b) => b.category_key == null || a.categoryBlocks[b.category_key] !== false)
    .map((b) => ({ staffId: b.staff_id, startsAt: b.starts_at, endsAt: b.ends_at, geo: geoOf(b.geo_lat, b.geo_lng) }));

  const existing: Record<string, Record<string, number>> = {};
  const global: Record<string, number> = {};
  for (const b of a.bookingCounts) {
    if (b.status !== "pending" && b.status !== "confirmed") continue;
    const key = DateTime.fromISO(b.starts_at, { zone: "utc" }).setZone(tz).toFormat("yyyy-MM-dd");
    (existing[b.staff_id] ??= {})[key] = ((existing[b.staff_id] ??= {})[key] ?? 0) + 1;
    global[key] = (global[key] ?? 0) + 1;
  }

  return {
    ruleSet: ruleSetConfigFromRow(a.ruleSet),
    staffPool, workingHours, exceptions, busyBlocks,
    existingBookingsCountPerDay: existing,
    globalBookingsCountPerDay: global,
    range: { from: a.from, to: a.to },
    now: a.now,
    address: a.address ?? null,
    timezone: tz,
  };
}
