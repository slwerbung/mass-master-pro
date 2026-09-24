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
