import { describe, it, expect } from "vitest";
import { buildComputeInput, ruleSetConfigFromRow, type RuleSetRow } from "./inputs.ts";

const rs: RuleSetRow = {
  id: "rs1", duration_minutes: 60, buffer_before_min: 0, buffer_after_min: 15,
  travel_buffer: true, min_notice_min: 120, booking_window_days: 60, slot_granularity_min: 30,
  assignment_mode: "round_robin", required_skills: ["montage"],
  config: { fixed_staff_id: "x", reserve_slots: ["2026-06-01T06:00:00Z"] },
};

describe("ruleSetConfigFromRow", () => {
  it("übernimmt fixed_staff_id und reserve_slots aus config", () => {
    const c = ruleSetConfigFromRow(rs);
    expect(c.fixedStaffId).toBe("x");
    expect(c.reserveSlots).toEqual(["2026-06-01T06:00:00Z"]);
    expect(c.requiredSkills).toEqual(["montage"]);
    expect(c.bufferAfterMin).toBe(15);
  });
});

describe("buildComputeInput", () => {
  const args = {
    ruleSet: rs,
    staff: [{ id: "a", skills: ["montage"], home_base_lat: 48.8, home_base_lng: 9.2 }],
    workingHours: [{ staff_id: "a", weekday: 1, start_time: "08:00:00", end_time: "12:00:00" }],
    exceptions: [{ staff_id: "a", date: "2026-06-02", is_available: false, start_time: null, end_time: null }],
    busy: [
      { staff_id: "a", starts_at: "2026-06-01T08:00:00Z", ends_at: "2026-06-01T09:00:00Z", category_key: "montage", geo_lat: 49.5, geo_lng: 10.0 },
      { staff_id: "a", starts_at: "2026-06-01T12:00:00Z", ends_at: "2026-06-01T13:00:00Z", category_key: "ignoriert", geo_lat: null, geo_lng: null },
      { staff_id: "a", starts_at: "2026-06-01T14:00:00Z", ends_at: "2026-06-01T15:00:00Z", category_key: null, geo_lat: null, geo_lng: null },
    ],
    bookingCounts: [
      { staff_id: "a", starts_at: "2026-06-01T06:00:00Z", status: "confirmed" },
      { staff_id: "a", starts_at: "2026-06-01T09:00:00Z", status: "pending" },
      { staff_id: "a", starts_at: "2026-06-01T09:00:00Z", status: "cancelled" }, // zählt nicht
    ],
    categoryBlocks: { montage: true, ignoriert: false }, // 'ignoriert' blockt nicht
    now: "2026-05-25T00:00:00Z", from: "2026-06-01T00:00:00Z", to: "2026-06-02T00:00:00Z",
    timezone: "Europe/Berlin",
  };

  it("mappt Geo/Skills/Arbeitszeiten und filtert Kategorien (§7)", () => {
    const input = buildComputeInput(args);
    expect(input.staffPool[0].homeBase).toEqual({ lat: 48.8, lng: 9.2 });
    expect(input.workingHours[0]).toEqual({ staffId: "a", weekday: 1, start: "08:00", end: "12:00" });
    // 'ignoriert' (blocks_availability=false) fliegt raus; 'montage' + null bleiben.
    expect(input.busyBlocks.length).toBe(2);
    expect(input.busyBlocks.find((b) => b.startsAt === "2026-06-01T08:00:00Z")?.geo).toEqual({ lat: 49.5, lng: 10.0 });
  });

  it("bucketet Tageszähler in der Zielzone und ignoriert stornierte", () => {
    const input = buildComputeInput(args);
    // 2 aktive Buchungen am 2026-06-01 (Berlin).
    expect(input.existingBookingsCountPerDay?.["a"]?.["2026-06-01"]).toBe(2);
    expect(input.globalBookingsCountPerDay?.["2026-06-01"]).toBe(2);
  });
});

describe("buildComputeInput – Feiertage", () => {
  const base = {
    ruleSet: rs,
    staff: [
      { id: "a", skills: ["montage"], home_base_lat: null, home_base_lng: null },
      { id: "b", skills: ["montage"], home_base_lat: null, home_base_lng: null },
    ],
    workingHours: [
      { staff_id: "a", weekday: 4, start_time: "08:00:00", end_time: "16:00:00" },
      { staff_id: "b", weekday: 4, start_time: "08:00:00", end_time: "16:00:00" },
    ],
    busy: [],
    bookingCounts: [],
    categoryBlocks: {},
    now: "2026-09-20T06:00:00Z",
    from: "2026-10-01T00:00:00Z",
    to:   "2026-10-05T00:00:00Z",
  };

  it("sperrt einen Feiertag fuer ALLE Mitarbeiter", () => {
    const input = buildComputeInput({ ...base, exceptions: [], holidays: ["2026-10-03"] });
    const off = input.exceptions.filter((x) => x.date === "2026-10-03" && x.isAvailable === false);
    expect(off.map((x) => x.staffId).sort()).toEqual(["a", "b"]);
  });

  it("laesst einen eingetragenen Sondereinsatz gewinnen", () => {
    // b arbeitet am Feiertag ausdruecklich – das darf der Feiertag nicht kippen.
    const input = buildComputeInput({
      ...base,
      exceptions: [{ staff_id: "b", date: "2026-10-03", is_available: true, start_time: "09:00:00", end_time: "13:00:00" }],
      holidays: ["2026-10-03"],
    });
    const forB = input.exceptions.filter((x) => x.staffId === "b" && x.date === "2026-10-03");
    expect(forB).toHaveLength(1);
    expect(forB[0].isAvailable).toBe(true);
    expect(forB[0].start).toBe("09:00");
    // a bleibt gesperrt
    const forA = input.exceptions.filter((x) => x.staffId === "a" && x.date === "2026-10-03");
    expect(forA).toEqual([{ staffId: "a", date: "2026-10-03", isAvailable: false, start: null, end: null }]);
  });

  it("ohne Feiertage bleibt die Ausnahmeliste unveraendert", () => {
    const input = buildComputeInput({ ...base, exceptions: [] });
    expect(input.exceptions).toEqual([]);
  });

  it("gibt den Fahrzeit-Anbieter durch", () => {
    const stub = { minutesBetween: () => 42 };
    const input = buildComputeInput({ ...base, exceptions: [], travelProvider: stub });
    expect(input.travelProvider).toBe(stub);
  });
});
