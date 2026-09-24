// Eine kaputte .ics-Datei faellt niemandem auf, bevor sie beim Kunden im
// Outlook landet und dort nichts passiert. Deshalb die haesslichen Faelle
// hier: Kommas und Semikolons im Text, Umlaute an der Faltgrenze, Absagen.

import { describe, expect, it } from "vitest";
import { buildIcs, foldLine, icsDate, icsEscape, toBase64 } from "./ics.ts";

const START = new Date("2026-09-24T07:45:00Z");
const END = new Date("2026-09-24T09:15:00Z");

const basis = {
  uid: "booking-123@captfix.app",
  start: START,
  end: END,
  summary: "Aufmass vor Ort",
  stamp: new Date("2026-09-20T06:00:00Z"),
};

const zeilen = (ics: string) => ics.split("\r\n");

describe("icsDate", () => {
  it("schreibt UTC im Basisformat", () => {
    expect(icsDate(START)).toBe("20260924T074500Z");
    expect(icsDate(new Date("2026-01-05T00:00:00Z"))).toBe("20260105T000000Z");
  });
});

describe("icsEscape", () => {
  it("escapet Backslash, Semikolon, Komma und Zeilenumbruch", () => {
    expect(icsEscape("Haupt, 1; A\\B")).toBe("Haupt\\, 1\\; A\\\\B");
    expect(icsEscape("Zeile1\nZeile2")).toBe("Zeile1\\nZeile2");
    expect(icsEscape("Zeile1\r\nZeile2")).toBe("Zeile1\\nZeile2");
  });

  it("escapet den Backslash zuerst", () => {
    // Sonst wuerde aus dem Escape von ";" ein doppelt escaptes "\\;".
    expect(icsEscape("a\\;b")).toBe("a\\\\\\;b");
  });

  it("haelt null und undefined aus", () => {
    expect(icsEscape(undefined as unknown as string)).toBe("");
    expect(icsEscape(null as unknown as string)).toBe("");
  });
});

describe("foldLine", () => {
  it("laesst kurze Zeilen in Ruhe", () => {
    expect(foldLine("SUMMARY:kurz")).toBe("SUMMARY:kurz");
  });

  it("faltet lange Zeilen mit fuehrendem Leerzeichen", () => {
    const lang = "DESCRIPTION:" + "x".repeat(200);
    const teile = foldLine(lang).split("\r\n");
    expect(teile.length).toBeGreaterThan(1);
    expect(teile[0].length).toBe(75);
    for (const t of teile.slice(1)) expect(t.startsWith(" ")).toBe(true);
    // Zusammengesetzt muss wieder das Original herauskommen.
    expect(teile[0] + teile.slice(1).map((t) => t.slice(1)).join("")).toBe(lang);
  });

  it("schneidet nicht mitten in einen Umlaut", () => {
    // 74 ASCII-Zeichen, danach nur noch Umlaute: die Grenze faellt genau in
    // ein Zweibyte-Zeichen.
    const lang = "DESCRIPTION:" + "a".repeat(62) + "ä".repeat(20);
    const gefaltet = foldLine(lang);
    expect(gefaltet).not.toContain("�");
    const teile = gefaltet.split("\r\n");
    expect(teile[0] + teile.slice(1).map((t) => t.slice(1)).join("")).toBe(lang);
    for (const t of teile) {
      expect(new TextEncoder().encode(t).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("buildIcs", () => {
  it("baut eine vollstaendige Einladung", () => {
    const ics = buildIcs({ ...basis, location: "Hauptstr. 1, 71332 Waiblingen", description: "Aufmass" });
    const l = zeilen(ics);
    expect(l[0]).toBe("BEGIN:VCALENDAR");
    expect(l).toContain("VERSION:2.0");
    expect(l).toContain("METHOD:REQUEST");
    expect(l).toContain("UID:booking-123@captfix.app");
    expect(l).toContain("DTSTART:20260924T074500Z");
    expect(l).toContain("DTEND:20260924T091500Z");
    expect(l).toContain("DTSTAMP:20260920T060000Z");
    expect(l).toContain("STATUS:CONFIRMED");
    expect(l).toContain("SEQUENCE:0");
    expect(l[l.length - 2]).toBe("END:VCALENDAR");
    // CRLF, nicht LF.
    expect(ics.includes("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("escapet die Adresse", () => {
    const ics = buildIcs({ ...basis, location: "Hauptstr. 1, 71332 Waiblingen" });
    expect(ics).toContain("LOCATION:Hauptstr. 1\\, 71332 Waiblingen");
  });

  it("macht aus METHOD:CANCEL auch STATUS:CANCELLED", () => {
    const l = zeilen(buildIcs({ ...basis, method: "CANCEL", sequence: 1 }));
    expect(l).toContain("METHOD:CANCEL");
    expect(l).toContain("STATUS:CANCELLED");
    expect(l).toContain("SEQUENCE:1");
    // Gleiche UID wie die Einladung, sonst findet der Kalender den Termin nicht.
    expect(l).toContain("UID:booking-123@captfix.app");
  });

  it("laesst optionale Felder weg statt sie leer zu schreiben", () => {
    const ics = buildIcs(basis);
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("ORGANIZER");
  });

  it("schreibt den Organisator mit Namen", () => {
    const ics = buildIcs({ ...basis, organizer: { name: "SL WERBUNG", email: "info@slwerbung.de" } });
    expect(ics).toContain("ORGANIZER;CN=SL WERBUNG:mailto:info@slwerbung.de");
  });

  it("faltet lange Beschreibungen, ohne sie zu verlieren", () => {
    const text = "Aufmass vor Ort. ".repeat(20);
    const ics = buildIcs({ ...basis, description: text });
    const entfaltet = ics.replace(/\r\n /g, "");
    expect(entfaltet).toContain(`DESCRIPTION:${icsEscape(text)}`);
  });
});

describe("toBase64", () => {
  it("kodiert auch Umlaute richtig", () => {
    const text = "Aufmaß vor Ort";
    const b64 = toBase64(text);
    const zurueck = new TextDecoder().decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    );
    expect(zurueck).toBe(text);
  });
});
