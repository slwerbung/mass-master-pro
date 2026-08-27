import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { computeSlots } from "./engine.ts";
import type { ComputeInput, TravelTimeProvider } from "./types.ts";

const TZ = "Europe/Berlin";
const localHours = (isos: string[]) => isos.map((s) => DateTime.fromISO(s, { zone: "utc" }).setZone(TZ).hour);

// 2026-06-01 = Montag (Sommerzeit, Berlin = UTC+2). weekday(0=So)=1.
function base(over: Partial<ComputeInput> = {}): ComputeInput {
  return {
    ruleSet: {
      durationMinutes: 60, bufferBeforeMin: 0, bufferAfterMin: 0, travelBuffer: false,
      minNoticeMin: 0, bookingWindowDays: 60, slotGranularityMin: 60,
      assignmentMode: "round_robin", requiredSkills: [],
      ...(over.ruleSet || {}),
    },
    staffPool: over.staffPool ?? [{ id: "a", skills: [] }],
    workingHours: over.workingHours ?? [{ staffId: "a", weekday: 1, start: "08:00", end: "12:00" }],
    exceptions: over.exceptions ?? [],
    busyBlocks: over.busyBlocks ?? [],
    existingBookingsCountPerDay: over.existingBookingsCountPerDay,
    globalBookingsCountPerDay: over.globalBookingsCountPerDay,
    range: over.range ?? { from: "2026-06-01T00:00:00Z", to: "2026-06-01T23:59:59Z" },
    now: over.now ?? "2026-05-25T00:00:00Z",
    address: over.address,
    timezone: TZ,
    travelProvider: over.travelProvider,
  };
}

describe("computeSlots — Grundlagen", () => {
  it("erzeugt Slots im Arbeitsfenster (Berlin-Sommer → UTC+2)", async () => {
    const slots = await computeSlots(base());
    expect(slots.map((s) => s.startsAt)).toEqual([
      "2026-06-01T06:00:00.000Z", // 08:00 local
      "2026-06-01T07:00:00.000Z",
      "2026-06-01T08:00:00.000Z",
      "2026-06-01T09:00:00.000Z", // 11:00–12:00 local
    ]);
    expect(slots.every((s) => s.assignedStaffId === "a")).toBe(true);
  });

  it("verwirft Slots, die einen belegten Block schneiden (berührend ist ok)", async () => {
    const slots = await computeSlots(base({
      busyBlocks: [{ staffId: "a", startsAt: "2026-06-01T08:00:00Z", endsAt: "2026-06-01T08:30:00Z" }], // 10:00–10:30 local
    }));
    // 10:00-Slot fällt weg; 09:00–10:00 berührt nur → bleibt.
    expect(localHours(slots.map((s) => s.startsAt))).toEqual([8, 9, 11]);
  });

  it("berücksichtigt Puffer vor/nach", async () => {
    const slots = await computeSlots(base({
      ruleSet: { durationMinutes: 60, bufferBeforeMin: 0, bufferAfterMin: 30, travelBuffer: false, minNoticeMin: 0, bookingWindowDays: 60, slotGranularityMin: 60, assignmentMode: "round_robin", requiredSkills: [] },
      busyBlocks: [{ staffId: "a", startsAt: "2026-06-01T08:00:00Z", endsAt: "2026-06-01T08:30:00Z" }], // 10:00–10:30 local
    }));
    // 09:00–10:00 + 30 Puffer → bis 10:30, schneidet Busy → weg.
    expect(localHours(slots.map((s) => s.startsAt))).toEqual([8, 11]);
  });
});

describe("computeSlots — Grenzen & Filter", () => {
  it("respektiert Mindest-Vorlaufzeit", async () => {
    const slots = await computeSlots(base({
      now: "2026-06-01T06:00:00Z", // 08:00 local
      ruleSet: { durationMinutes: 60, bufferBeforeMin: 0, bufferAfterMin: 0, travelBuffer: false, minNoticeMin: 180, bookingWindowDays: 60, slotGranularityMin: 60, assignmentMode: "round_robin", requiredSkills: [] },
    }));
    // now+180min = 11:00 local → nur der 11:00-Slot bleibt.
    expect(localHours(slots.map((s) => s.startsAt))).toEqual([11]);
  });

  it("filtert nach Qualifikation (required_skills ⊆ staff.skills)", async () => {
    const withSkill = await computeSlots(base({
      ruleSet: { durationMinutes: 60, bufferBeforeMin: 0, bufferAfterMin: 0, travelBuffer: false, minNoticeMin: 0, bookingWindowDays: 60, slotGranularityMin: 60, assignmentMode: "by_skill", requiredSkills: ["montage"] },
      staffPool: [{ id: "a", skills: ["montage"] }],
    }));
    expect(withSkill.length).toBe(4);
    const without = await computeSlots(base({
      ruleSet: { durationMinutes: 60, bufferBeforeMin: 0, bufferAfterMin: 0, travelBuffer: false, minNoticeMin: 0, bookingWindowDays: 60, slotGranularityMin: 60, assignmentMode: "by_skill", requiredSkills: ["montage"] },
      staffPool: [{ id: "a", skills: [] }],
    }));
    expect(without.length).toBe(0);
  });

  it("bietet an vollen Tagen (max_per_day_per_staff) nichts an", async () => {
    const slots = await computeSlots(base({
      ruleSet: { durationMinutes: 60, bufferBeforeMin: 0, bufferAfterMin: 0, travelBuffer: false, minNoticeMin: 0, bookingWindowDays: 60, slotGranularityMin: 60, assignmentMode: "round_robin", requiredSkills: [], maxPerDayPerStaff: 2 },
      existingBookingsCountPerDay: { a: { "2026-06-01": 2 } },
    }));
    expect(slots.length).toBe(0);
  });
});

describe("computeSlots — Zuweisung", () => {
  it("round_robin bevorzugt den am wenigsten ausgelasteten MA", async () => {
    const slots = await computeSlots(base({
      staffPool: [{ id: "a", skills: [] }, { id: "b", skills: [] }],
      workingHours: [
        { staffId: "a", weekday: 1, start: "08:00", end: "12:00" },
        { staffId: "b", weekday: 1, start: "08:00", end: "12:00" },
      ],
      existingBookingsCountPerDay: { a: { "2026-06-01": 1 } }, // a schon belastet
    }));
    // Erster Slot geht an b (Last 0 < a Last 1).
    expect(slots[0].assignedStaffId).toBe("b");
  });

  it("collective bietet nur an, wenn alle MA frei sind", async () => {
    const bothFree = await computeSlots(base({
      ruleSet: { durationMinutes: 60, bufferBeforeMin: 0, bufferAfterMin: 0, travelBuffer: false, minNoticeMin: 0, bookingWindowDays: 60, slotGranularityMin: 60, assignmentMode: "collective", requiredSkills: [] },
      staffPool: [{ id: "a", skills: [] }, { id: "b", skills: [] }],
      workingHours: [
        { staffId: "a", weekday: 1, start: "08:00", end: "12:00" },
        { staffId: "b", weekday: 1, start: "08:00", end: "12:00" },
      ],
    }));
    expect(bothFree[0].staffIds?.sort()).toEqual(["a", "b"]);
    // b ist 09:00–10:00 local (07:00Z) belegt → dieser Slot fällt weg.
    const oneBusy = await computeSlots(base({
      ruleSet: { durationMinutes: 60, bufferBeforeMin: 0, bufferAfterMin: 0, travelBuffer: false, minNoticeMin: 0, bookingWindowDays: 60, slotGranularityMin: 60, assignmentMode: "collective", requiredSkills: [] },
      staffPool: [{ id: "a", skills: [] }, { id: "b", skills: [] }],
      workingHours: [
        { staffId: "a", weekday: 1, start: "08:00", end: "12:00" },
        { staffId: "b", weekday: 1, start: "08:00", end: "12:00" },
      ],
      busyBlocks: [{ staffId: "b", startsAt: "2026-06-01T07:00:00Z", endsAt: "2026-06-01T08:00:00Z" }],
    }));
    expect(localHours(oneBusy.map((s) => s.startsAt))).not.toContain(9);
  });
});

describe("computeSlots — Fahrzeit", () => {
  it("verwirft Slots ohne ausreichende Anfahrtslücke", async () => {
    const provider: TravelTimeProvider = { minutesBetween: () => 30 };
    const slots = await computeSlots(base({
      ruleSet: { durationMinutes: 60, bufferBeforeMin: 0, bufferAfterMin: 0, travelBuffer: true, minNoticeMin: 0, bookingWindowDays: 60, slotGranularityMin: 60, assignmentMode: "round_robin", requiredSkills: [] },
      address: { lat: 48.8, lng: 9.2 },
      travelProvider: provider,
      busyBlocks: [{ staffId: "a", startsAt: "2026-06-01T08:00:00Z", endsAt: "2026-06-01T09:00:00Z", geo: { lat: 49.5, lng: 10.0 } }], // 10:00–11:00 local
    }));
    // 10:00 belegt; 09:00 (Lücke 0 zum Busy) und 11:00 (Lücke 0 nach Busy) brauchen 30min → weg.
    // 08:00 hat 60min bis zum nächsten Busy → bleibt.
    expect(localHours(slots.map((s) => s.startsAt))).toEqual([8]);
  });
});

describe("computeSlots — DST", () => {
  it("überspringt die nicht existierende Stunde bei Sommerzeit-Umstellung", async () => {
    // 2026-03-29 = Sonntag, Berlin springt 02:00 → 03:00.
    const slots = await computeSlots(base({
      workingHours: [{ staffId: "a", weekday: 0, start: "00:00", end: "05:00" }],
      range: { from: "2026-03-28T00:00:00Z", to: "2026-03-29T23:59:59Z" },
      now: "2026-03-01T00:00:00Z",
    }));
    // Lokale Stunden 0,1,3,4 — die 2 existiert nicht.
    expect(localHours(slots.map((s) => s.startsAt))).toEqual([0, 1, 3, 4]);
    // Instants strikt monoton & eindeutig.
    const ms = slots.map((s) => new Date(s.startsAt).getTime());
    expect(new Set(ms).size).toBe(ms.length);
    expect([...ms].sort((a, b) => a - b)).toEqual(ms);
  });
});

describe("computeSlots — Ausnahmen & Reserve", () => {
  it("Urlaub (ganztägig frei) blockiert den Tag", async () => {
    const slots = await computeSlots(base({
      exceptions: [{ staffId: "a", date: "2026-06-01", isAvailable: false }],
    }));
    expect(slots.length).toBe(0);
  });

  it("Notfall-Reserve blendet konkrete Slots aus", async () => {
    const all = await computeSlots(base());
    const reserved = all[1].startsAt;
    const slots = await computeSlots(base({
      ruleSet: { durationMinutes: 60, bufferBeforeMin: 0, bufferAfterMin: 0, travelBuffer: false, minNoticeMin: 0, bookingWindowDays: 60, slotGranularityMin: 60, assignmentMode: "round_robin", requiredSkills: [], reserveSlots: [reserved] },
    }));
    expect(slots.map((s) => s.startsAt)).not.toContain(reserved);
    expect(slots.length).toBe(all.length - 1);
  });
});
