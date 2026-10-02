// HERO rechnet nicht mit Zeitzonen: jede Zeit trägt "+00:00", gemeint ist die
// Uhrzeit, die in HERO auf dem Bildschirm steht. Diese beiden Helfer sind die
// einzige Stelle, an der das umgerechnet wird — und genau hier ist es schon
// einmal schiefgegangen: 14:00 gebucht, 12:00 in HERO eingetragen, und ein
// HERO-Termin um 14:00 blockierte bei uns 16:00.

import { describe, it, expect } from "vitest";
import { formatAddress, heroWallClock, toHeroTime } from "./hero";

describe("toHeroTime", () => {
  it("schickt die Berliner Wanduhrzeit, nicht UTC (Sommerzeit)", () => {
    // 12:00 UTC = 14:00 in Berlin → HERO muss 14:00 bekommen.
    expect(toHeroTime("2026-10-05T12:00:00Z")).toBe("2026-10-05T14:00:00+00:00");
  });

  it("nimmt einen Offset im Eingabewert richtig auf", () => {
    expect(toHeroTime("2026-10-05T14:00:00+02:00")).toBe("2026-10-05T14:00:00+00:00");
  });

  it("rechnet in der Winterzeit mit einer Stunde", () => {
    // 2026-12-01: Berlin ist UTC+1.
    expect(toHeroTime("2026-12-01T08:30:00Z")).toBe("2026-12-01T09:30:00+00:00");
  });

  it("bleibt über die Zeitumstellung hinweg richtig", () => {
    // Nacht der Umstellung: 2026-10-25, 00:30 UTC ist noch Sommerzeit (02:30).
    expect(toHeroTime("2026-10-25T00:30:00Z")).toBe("2026-10-25T02:30:00+00:00");
    // 01:30 UTC ist schon Winterzeit (02:30) — gleiche Wanduhrzeit, anderer Zeitpunkt.
    expect(toHeroTime("2026-10-25T01:30:00Z")).toBe("2026-10-25T02:30:00+00:00");
  });

  it("gibt unlesbare Werte unverändert zurück statt zu raten", () => {
    expect(toHeroTime("keine Zeit")).toBe("keine Zeit");
  });
});

describe("heroWallClock", () => {
  it("wirft den bedeutungslosen Offset weg", () => {
    expect(heroWallClock("2026-10-05T14:00:00+00:00")).toBe("2026-10-05T14:00:00");
  });

  it("verträgt einen leeren Wert", () => {
    expect(heroWallClock("")).toBe("");
  });

  it("ist das Gegenstück zu toHeroTime", () => {
    expect(heroWallClock(toHeroTime("2026-10-05T12:00:00Z"))).toBe("2026-10-05T14:00:00");
  });
});

describe("formatAddress", () => {
  it("setzt Straße, PLZ und Ort zusammen", () => {
    expect(formatAddress({ street: "Torstraße 10", zipcode: "71364", city: "Winnenden" }))
      .toBe("Torstraße 10, 71364 Winnenden");
  });

  it("lässt fehlende Teile einfach weg", () => {
    expect(formatAddress({ street: null, zipcode: "71364", city: "Winnenden" }))
      .toBe("71364 Winnenden");
    expect(formatAddress(null)).toBe("");
  });
});
