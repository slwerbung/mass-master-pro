import { describe, expect, it } from "vitest";
import {
  durationBounds, durationFromSegment, durationLabel, durationToSegment,
  effectiveDuration, istDauerSegment,
} from "./duration.ts";

const montage = {
  duration_minutes: 480,
  duration_choosable: true,
  duration_min_minutes: 60,
  duration_max_minutes: 600,
};
const aufmass = { duration_minutes: 90, duration_choosable: false };

describe("durationFromSegment", () => {
  it("liest die Dauer aus einem Pfadsegment", () => {
    expect(durationFromSegment("d240")).toBe(240);
    expect(durationFromSegment("D240")).toBe(240);
    expect(durationFromSegment(" d90 ")).toBe(90);
  });

  it("haelt eine Projektnummer NICHT fuer eine Dauer", () => {
    // Der Grund fuer das `d`: ohne Praefix waere das eine Projektnummer.
    expect(durationFromSegment("1916")).toBeNull();
    expect(durationFromSegment("WER-1916")).toBeNull();
    expect(durationFromSegment("montage_vor_ort")).toBeNull();
    expect(durationFromSegment("")).toBeNull();
    expect(durationFromSegment(null)).toBeNull();
    expect(durationFromSegment("d0")).toBeNull();
    expect(durationFromSegment("d99999")).toBeNull();
  });

  it("schreibt und liest dasselbe", () => {
    expect(durationFromSegment(durationToSegment(240))).toBe(240);
    expect(istDauerSegment(durationToSegment(90))).toBe(true);
    expect(istDauerSegment("montage_vor_ort")).toBe(false);
  });
});

describe("durationBounds", () => {
  it("gibt bei fester Terminart genau eine erlaubte Dauer", () => {
    expect(durationBounds(aufmass)).toEqual({ min: 90, max: 90 });
  });

  it("nimmt die Grenzen der Terminart", () => {
    expect(durationBounds(montage)).toEqual({ min: 60, max: 600 });
  });

  it("schliesst die Standarddauer immer ein", () => {
    // Grenzen, die die Vorgabe aussperren, waeren eine unbuchbare Terminart.
    const krumm = { duration_minutes: 480, duration_choosable: true, duration_min_minutes: 600, duration_max_minutes: 660 };
    const b = durationBounds(krumm);
    expect(b.min).toBeLessThanOrEqual(480);
    expect(b.max).toBeGreaterThanOrEqual(480);
  });

  it("findet ohne Grenzen brauchbare Werte", () => {
    const offen = { duration_minutes: 480, duration_choosable: true };
    expect(durationBounds(offen)).toEqual({ min: 15, max: 720 });
  });
});

describe("effectiveDuration", () => {
  it("nimmt ohne Wunsch die Standarddauer", () => {
    expect(effectiveDuration(montage, null).minutes).toBe(480);
    expect(effectiveDuration(montage, "").source).toBe("standard");
    expect(effectiveDuration(montage, undefined).source).toBe("standard");
  });

  it("nimmt den Wunsch aus dem Link", () => {
    const r = effectiveDuration(montage, 180);
    expect(r.minutes).toBe(180);
    expect(r.source).toBe("link");
  });

  it("nimmt den Wunsch auch als Text (so kommt er aus der URL)", () => {
    expect(effectiveDuration(montage, "240").minutes).toBe(240);
  });

  it("ignoriert den Wunsch bei einer festen Terminart", () => {
    // Sonst liesse sich ein Aufmass per Hand am Link auf 10 Minuten kuerzen.
    const r = effectiveDuration(aufmass, 10);
    expect(r.minutes).toBe(90);
    expect(r.source).toBe("fest");
  });

  it("klemmt statt abzulehnen", () => {
    expect(effectiveDuration(montage, 5)).toMatchObject({ minutes: 60, source: "geklemmt" });
    expect(effectiveDuration(montage, 5000)).toMatchObject({ minutes: 600, source: "geklemmt" });
  });

  it("faellt bei Unsinn im Link auf die Standarddauer zurueck", () => {
    for (const unsinn of ["abc", "-30", "0", "{{Dauer}}", {}, []]) {
      expect(effectiveDuration(montage, unsinn).minutes).toBe(480);
    }
  });

  it("rundet auf ganze Minuten", () => {
    expect(effectiveDuration(montage, 90.6).minutes).toBe(91);
  });
});

describe("durationLabel", () => {
  it("schreibt Minuten und Stunden, wie man sie liest", () => {
    expect(durationLabel(45)).toBe("45 Minuten");
    expect(durationLabel(60)).toBe("1 Stunde");
    expect(durationLabel(90)).toBe("1,5 Stunden");
    expect(durationLabel(240)).toBe("4 Stunden");
    expect(durationLabel(480)).toBe("8 Stunden");
    expect(durationLabel(100)).toBe("1 Std. 40 Min.");
  });
});
