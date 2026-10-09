import { describe, expect, it } from "vitest";
import { ABSENCE_REF, ABSENCE_STATUSES, absenceSpan } from "./absence.ts";

describe("absenceSpan", () => {
  it("sperrt den LETZTEN Urlaubstag mit (HERO zaehlt 12.–16.10. als 5 Tage)", () => {
    const span = absenceSpan("2026-10-12", "2026-10-16");
    // Sommerzeit: 00:00 Ortszeit = 22:00 UTC am Vortag.
    expect(span).toEqual({
      startsAt: "2026-10-11T22:00:00.000Z",
      endsAt: "2026-10-16T21:59:59.999Z",
    });
  });

  it("rechnet in Ortszeit, auch im Winter", () => {
    const span = absenceSpan("2026-12-28", "2026-12-31");
    expect(span).toEqual({
      startsAt: "2026-12-27T23:00:00.000Z",
      endsAt: "2026-12-31T22:59:59.999Z",
    });
  });

  it("deckt einen einzelnen Tag ganz ab", () => {
    const span = absenceSpan("2026-11-03", "2026-11-03");
    expect(span).toEqual({
      startsAt: "2026-11-02T23:00:00.000Z",
      endsAt: "2026-11-03T22:59:59.999Z",
    });
  });

  it("nimmt ohne Ende den Starttag", () => {
    expect(absenceSpan("2026-11-03", null)).toEqual(absenceSpan("2026-11-03", "2026-11-03"));
    expect(absenceSpan("2026-11-03")).toEqual(absenceSpan("2026-11-03", "2026-11-03"));
  });

  it("schneidet eine mitgelieferte Uhrzeit ab", () => {
    expect(absenceSpan("2026-10-12T00:00:00+00:00", "2026-10-16T00:00:00+00:00"))
      .toEqual(absenceSpan("2026-10-12", "2026-10-16"));
  });

  it("umschliesst die Umstellungsnacht vollstaendig", () => {
    // 25.10.2026 ist die Rueckstellung: der Tag hat 25 Stunden.
    const span = absenceSpan("2026-10-25", "2026-10-25")!;
    const dauer = Date.parse(span.endsAt) - Date.parse(span.startsAt);
    expect(Math.round(dauer / 3_600_000)).toBe(25);
  });

  it("liefert null bei unbrauchbaren Werten", () => {
    expect(absenceSpan(null)).toBeNull();
    expect(absenceSpan("")).toBeNull();
    expect(absenceSpan("irgendwas")).toBeNull();
    // Ende vor Beginn: lieber nichts sperren als eine kaputte Zeile schreiben.
    expect(absenceSpan("2026-10-16", "2026-10-12")).toBeNull();
  });
});

describe("Konstanten", () => {
  it("sperrt genehmigte und beantragte Abwesenheiten, nichts anderes", () => {
    expect(ABSENCE_STATUSES).toEqual(["approved", "submitted"]);
    expect(ABSENCE_STATUSES).not.toContain("draft");
    expect(ABSENCE_STATUSES).not.toContain("rejected");
    expect(ABSENCE_STATUSES).not.toContain("deleted");
  });

  it("haelt Abwesenheits-Refs von Termin-IDs getrennt", () => {
    // Eine HERO-Event-ID ist eine reine Zahl — mit Praefix kann sie nie
    // dieselbe Zeile treffen wie eine Abwesenheit.
    expect(`${ABSENCE_REF}374752`).not.toMatch(/^\d+$/);
  });
});
