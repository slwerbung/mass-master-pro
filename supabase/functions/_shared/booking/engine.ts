// Verfügbarkeits-Engine (§5). REINE Funktion, keine Seiteneffekte, keine
// DB-Zugriffe → voll unit-testbar. Zeitlogik durchgängig mit luxon; lokale
// Rechnung in der Ziel-Zone (Default Europe/Berlin), Vergleich in UTC. Damit
// sind DST-Grenzen korrekt (an der Frühjahrs-Lücke entstehen schlicht keine
// Slots, im Herbst keine doppelten).

import { DateTime } from "luxon";
import type { BusyBlock, ComputeInput, Geo, Slot, Staff, TravelTimeProvider, WorkingHours, WorkingHoursException } from "./types.ts";
import { HaversineHeuristicProvider } from "./travel.ts";

const DEFAULT_TZ = "Europe/Berlin";

function toMillis(v: string | Date): number {
  if (v instanceof Date) return v.getTime();
  return DateTime.fromISO(v, { zone: "utc" }).toMillis();
}
const hhmmToMin = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

interface Interval { s: number; e: number } // Minuten ab Mitternacht (lokal)

/** Effektive Arbeitsfenster eines MA an einem lokalen Tag (nach Ausnahmen). */
function windowsForDay(
  staffId: string, dayTz: DateTime,
  workingHours: WorkingHours[], exceptions: WorkingHoursException[],
): Interval[] {
  const weekday = dayTz.weekday % 7; // luxon: Mo=1..So=7 → So=0..Sa=6
  const dateStr = dayTz.toFormat("yyyy-MM-dd");

  let intervals: Interval[] = workingHours
    .filter((w) => w.staffId === staffId && w.weekday === weekday)
    .map((w) => ({ s: hhmmToMin(w.start), e: hhmmToMin(w.end) }))
    .filter((iv) => iv.e > iv.s);

  const exs = exceptions.filter((x) => x.staffId === staffId && x.date === dateStr);
  // Ganztägig frei?
  if (exs.some((x) => !x.isAvailable && (!x.start || !x.end))) return [];
  // Teil-Sperren abziehen.
  for (const x of exs) {
    if (x.isAvailable || !x.start || !x.end) continue;
    intervals = subtract(intervals, { s: hhmmToMin(x.start), e: hhmmToMin(x.end) });
  }
  // Zusatzfenster addieren.
  for (const x of exs) {
    if (!x.isAvailable || !x.start || !x.end) continue;
    intervals.push({ s: hhmmToMin(x.start), e: hhmmToMin(x.end) });
  }
  return normalize(intervals);
}

function subtract(list: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const iv of list) {
    if (cut.e <= iv.s || cut.s >= iv.e) { out.push(iv); continue; }      // kein Overlap
    if (cut.s > iv.s) out.push({ s: iv.s, e: cut.s });                    // linker Rest
    if (cut.e < iv.e) out.push({ s: cut.e, e: iv.e });                    // rechter Rest
  }
  return out;
}

function normalize(list: Interval[]): Interval[] {
  const sorted = [...list].filter((iv) => iv.e > iv.s).sort((a, b) => a.s - b.s);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e);
    else out.push({ ...iv });
  }
  return out;
}

interface Cand { staffId: string; startMs: number; endMs: number; startISO: string; endISO: string; dateKey: string }

const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

/** Fahrzeit-Prüfung: reicht die Lücke zum vorigen/nächsten belegten Termin? */
async function travelFits(
  slotStartMs: number, slotEndMs: number, dateKey: string, address: Geo | null | undefined,
  staffBusy: { s: number; e: number; geo?: Geo | null }[], homeBase: Geo | null | undefined,
  provider: TravelTimeProvider, tz: string,
): Promise<boolean> {
  if (!address) return true;
  const sameDay = staffBusy.filter((b) => DateTime.fromMillis(b.s).setZone(tz).toFormat("yyyy-MM-dd") === dateKey);
  // vorheriger Termin (endet vor Slot-Start)
  let prev: { s: number; e: number; geo?: Geo | null } | null = null;
  for (const b of sameDay) if (b.e <= slotStartMs && (!prev || b.e > prev.e)) prev = b;
  let next: { s: number; e: number; geo?: Geo | null } | null = null;
  for (const b of sameDay) if (b.s >= slotEndMs && (!next || b.s < next.s)) next = b;

  if (prev?.geo) {
    const need = await provider.minutesBetween(prev.geo, address);
    if ((slotStartMs - prev.e) / 60000 < need) return false;
  } else if (!prev && homeBase) {
    const need = await provider.minutesBetween(homeBase, address);
    if ((slotStartMs - slotStartMs) < 0) { /* n/a */ }
    // Anfahrt vom Standort: nur relevant, wenn der Slot nicht der Tagesbeginn
    // sein darf. Für v1 keine harte Sperre am Tagesanfang (kein früherer
    // Termin ⇒ genug Zeit), aber die Kante ist hier dokumentiert für v2.
    void need;
  }
  if (next?.geo) {
    const need = await provider.minutesBetween(address, next.geo);
    if ((next.s - slotEndMs) / 60000 < need) return false;
  }
  return true;
}

/**
 * computeSlots — pro Mitarbeiter Kandidaten bilden, dann mergen + zuweisen.
 * @returns distinkte Slots mit assignedStaffId (bzw. staffIds bei collective).
 */
export async function computeSlots(input: ComputeInput): Promise<Slot[]> {
  const tz = input.timezone || DEFAULT_TZ;
  const rs = input.ruleSet;
  const provider = input.travelProvider || new HaversineHeuristicProvider();
  const nowMs = toMillis(input.now);
  const rangeFromMs = Math.max(toMillis(input.range.from), nowMs);
  const rangeToMs = toMillis(input.range.to);
  const noticeMs = rs.minNoticeMin * 60000;
  const windowMaxMs = nowMs + rs.bookingWindowDays * 86400000;
  const existing = input.existingBookingsCountPerDay || {};
  const globalCounts = input.globalBookingsCountPerDay || {};

  // Busy-Blocks je MA (in UTC-Millis + Geo), einmalig aufbereitet.
  const busyByStaff = new Map<string, { s: number; e: number; geo?: Geo | null }[]>();
  for (const b of input.busyBlocks) {
    const arr = busyByStaff.get(b.staffId) || [];
    arr.push({ s: toMillis(b.startsAt), e: toMillis(b.endsAt), geo: b.geo });
    busyByStaff.set(b.staffId, arr);
  }

  const eligibleStaff = input.staffPool.filter((st) => subset(rs.requiredSkills, st.skills));

  const firstDay = DateTime.fromMillis(rangeFromMs).setZone(tz).startOf("day");
  const lastDay = DateTime.fromMillis(rangeToMs).setZone(tz).startOf("day");

  const candsByStaff = new Map<string, Cand[]>();

  for (const st of eligibleStaff) {
    const staffBusy = busyByStaff.get(st.id) || [];
    const cands: Cand[] = [];
    for (let day = firstDay; day <= lastDay; day = day.plus({ days: 1 })) {
      const dateKey = day.toFormat("yyyy-MM-dd");
      // Tageslimits (nur bestehende Buchungen; volle Tage werden gar nicht angeboten).
      if (rs.maxPerDayPerStaff != null && (existing[st.id]?.[dateKey] ?? 0) >= rs.maxPerDayPerStaff) continue;
      if (rs.maxPerDayGlobal != null && (globalCounts[dateKey] ?? 0) >= rs.maxPerDayGlobal) continue;

      for (const win of windowsForDay(st.id, day, input.workingHours, input.exceptions)) {
        let cur = day.set({ hour: Math.floor(win.s / 60), minute: win.s % 60, second: 0, millisecond: 0 });
        const winEnd = day.set({ hour: Math.floor(win.e / 60), minute: win.e % 60, second: 0, millisecond: 0 });
        while (true) {
          const slotEnd = cur.plus({ minutes: rs.durationMinutes });
          if (slotEnd.toMillis() > winEnd.toMillis()) break;
          const sMs = cur.toMillis();
          const eMs = slotEnd.toMillis();
          const step = () => { cur = cur.plus({ minutes: rs.slotGranularityMin }); };

          // Zeitfenster / Vorlaufzeit / Buchungsfenster
          if (sMs < rangeFromMs || sMs > rangeToMs) { step(); continue; }
          if (sMs < nowMs + noticeMs) { step(); continue; }
          if (sMs > windowMaxMs) { step(); continue; }

          // Belegung inkl. Puffer
          const bufS = sMs - rs.bufferBeforeMin * 60000;
          const bufE = eMs + rs.bufferAfterMin * 60000;
          if (staffBusy.some((b) => overlaps(bufS, bufE, b.s, b.e))) { step(); continue; }

          cands.push({ staffId: st.id, startMs: sMs, endMs: eMs, startISO: cur.toUTC().toISO()!, endISO: slotEnd.toUTC().toISO()!, dateKey });
          step();
        }
      }
    }
    candsByStaff.set(st.id, cands);
  }

  // Fahrzeit-Filter (async), nur wenn aktiviert.
  if (rs.travelBuffer && input.address) {
    for (const st of eligibleStaff) {
      const staffBusy = busyByStaff.get(st.id) || [];
      const kept: Cand[] = [];
      for (const c of candsByStaff.get(st.id) || []) {
        if (await travelFits(c.startMs, c.endMs, c.dateKey, input.address, staffBusy, st.homeBase, provider, tz)) kept.push(c);
      }
      candsByStaff.set(st.id, kept);
    }
  }

  // Merge über alle MA nach Slot-Startzeit.
  const groups = new Map<string, { endISO: string; startMs: number; dateKey: string; staff: string[] }>();
  for (const st of eligibleStaff) {
    for (const c of candsByStaff.get(st.id) || []) {
      const g = groups.get(c.startISO) || { endISO: c.endISO, startMs: c.startMs, dateKey: c.dateKey, staff: [] };
      g.staff.push(c.staffId);
      groups.set(c.startISO, g);
    }
  }

  const reserve = new Set((rs.reserveSlots || []).map((iso) => DateTime.fromISO(iso, { zone: "utc" }).toISO()));
  const running: Record<string, number> = {}; // Fairness-Zähler für round_robin/by_skill
  const out: Slot[] = [];

  for (const [startISO, g] of [...groups.entries()].sort((a, b) => a[1].startMs - b[1].startMs)) {
    if (reserve.has(startISO)) continue;               // Notfall-Reserve (§5.2)
    const eligible = [...new Set(g.staff)].sort();

    if (rs.assignmentMode === "collective") {
      // Team-Termin: alle qualifizierten MA müssen frei sein.
      if (eligible.length === eligibleStaff.length && eligibleStaff.length > 0) {
        out.push({ startsAt: startISO, endsAt: g.endISO, staffIds: eligible });
      }
      continue;
    }
    if (rs.assignmentMode === "fixed") {
      if (rs.fixedStaffId && eligible.includes(rs.fixedStaffId)) {
        out.push({ startsAt: startISO, endsAt: g.endISO, assignedStaffId: rs.fixedStaffId });
      }
      continue;
    }
    // round_robin / by_skill: am wenigsten ausgelasteten geeigneten MA wählen.
    const pick = eligible
      .map((id) => ({ id, load: (existing[id]?.[g.dateKey] ?? 0) + (running[id] ?? 0) }))
      .sort((a, b) => a.load - b.load || (a.id < b.id ? -1 : 1))[0];
    if (pick) {
      running[pick.id] = (running[pick.id] ?? 0) + 1;
      out.push({ startsAt: startISO, endsAt: g.endISO, assignedStaffId: pick.id });
    }
  }

  return out.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
}

function subset(need: string[], have: string[]): boolean {
  const set = new Set(have);
  return need.every((s) => set.has(s));
}

export { DEFAULT_TZ };
