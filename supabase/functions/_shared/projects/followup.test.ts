import { describe, expect, it } from "vitest";
import { berlinDayStartIso, effectiveAutopilot, fmtDateDe, inSendWindow, parseWindow, pickRecipient, renderTemplate, DEFAULT_WINDOW, checkTemplateText } from "./followup.ts";

describe("Autopilot", () => {
  it("Projekt schlaegt Regel, ungueltiges faellt auf off", () => {
    expect(effectiveAutopilot("suggest", "auto")).toBe("auto");
    expect(effectiveAutopilot("auto", "off")).toBe("off");
    expect(effectiveAutopilot("auto", undefined)).toBe("auto");
    expect(effectiveAutopilot("auto", null)).toBe("auto");
    expect(effectiveAutopilot("quatsch", undefined)).toBe("off");
  });
});

describe("Versandfenster", () => {
  const w = parseWindow('{"days":[1,2,3,4,5],"from":8,"to":17}');
  it("Werktag, Berliner Ortszeit, Ende exklusiv", () => {
    expect(inSendWindow(new Date("2026-11-12T08:00:00Z"), w)).toBe(true);  // Do 09:00 Berlin
    expect(inSendWindow(new Date("2026-11-12T06:59:00Z"), w)).toBe(false); // Do 07:59
    expect(inSendWindow(new Date("2026-11-12T15:59:00Z"), w)).toBe(true);  // Do 16:59
    expect(inSendWindow(new Date("2026-11-12T16:00:00Z"), w)).toBe(false); // Do 17:00
  });
  it("Sommerzeit wird beachtet", () => {
    expect(inSendWindow(new Date("2026-07-15T06:00:00Z"), w)).toBe(true);  // Mi 08:00 MESZ
    expect(inSendWindow(new Date("2026-07-15T05:59:00Z"), w)).toBe(false);
  });
  it("Wochenende zu", () => {
    expect(inSendWindow(new Date("2026-11-14T10:00:00Z"), w)).toBe(false); // Sa
    expect(inSendWindow(new Date("2026-11-15T10:00:00Z"), w)).toBe(false); // So
    expect(inSendWindow(new Date("2026-11-15T10:00:00Z"), parseWindow({ days: [0], from: 8, to: 17 }))).toBe(true);
  });
  it("kaputte Einstellung = Standardfenster", () => {
    expect(parseWindow("kein json")).toEqual(DEFAULT_WINDOW);
    expect(parseWindow({ days: [], from: "x" })).toEqual(DEFAULT_WINDOW);
  });
  it("Tagesbeginn in Berlin", () => {
    expect(berlinDayStartIso(new Date("2026-11-12T10:00:00Z"))).toBe("2026-11-11T23:00:00.000Z");
    expect(berlinDayStartIso(new Date("2026-07-15T10:00:00Z"))).toBe("2026-07-14T22:00:00.000Z");
  });
});

describe("Vorlage und Empfaenger", () => {
  it("setzt Platzhalter ein und laesst Unbekanntes stehen", () => {
    const t = "Betreff {projekt} vom {angebot_datum} {foo} {kunde}";
    expect(renderTemplate(t, { projekt: "Schild", angebot_datum: "01.11.2026" })).toBe("Betreff Schild vom 01.11.2026 {foo} ");
  });
  it("Datum deutsch", () => {
    expect(fmtDateDe("2026-11-01T23:30:00Z")).toBe("02.11.2026"); // schon Montag in Berlin
    expect(fmtDateDe(null)).toBe("");
  });
  it("Empfaenger: letzte Kundenmail vor Projekt-E-Mail, nie eine eigene Adresse", () => {
    const own = ["info@slwerbung.de"];
    expect(pickRecipient("Kunde@Firma.de", "x@y.de", own)).toBe("kunde@firma.de");
    expect(pickRecipient("info@slwerbung.de", "x@y.de", own)).toBe("x@y.de");
    expect(pickRecipient("kaputt", "", own)).toBeNull();
    expect(pickRecipient(null, " a@b.de ", own)).toBe("a@b.de");
  });
});

describe("Nachfass-Vorlagen: neutral, Gruss, keine Firma", () => {
  const ok = "Hallo,\nkurze Nachfrage zu unserem Angebot „{projekt}“.\nPasst alles?\nBeste Grüße";
  it("neutrale Vorlage mit Beste Grüße ist in Ordnung", () => {
    expect(checkTemplateText("Angebot: {projekt}", ok)).toBeNull();
  });
  it("Sie- und Du-Formen werden abgelehnt (auch im Betreff), „sie“ als Pronomen nicht", () => {
    const withLine = (line: string) => `Hallo,\n${line}\nBeste Grüße`;
    for (const line of ["Haben Sie Fragen?", "Wir melden uns bei Ihnen.", "Passt Ihre Zeit?", "Hast du kurz Zeit?", "Das ist dein Angebot.", "Gib uns Bescheid, wenn dir etwas fehlt."]) {
      expect(checkTemplateText("Angebot", withLine(line)), line).toMatch(/neutral/);
    }
    expect(checkTemplateText("Ihr Angebot: {projekt}", ok)).toMatch(/neutral/);
    expect(checkTemplateText("Angebot", withLine("Wenn sie noch Fragen haben, gern melden."))).toBeNull();
  });
  it("Firmenname und falscher Gruss werden abgelehnt, der Gruss muss die letzte Zeile sein", () => {
    expect(checkTemplateText("Angebot", "Hallo,\nkurze Nachfrage.\nBeste Grüße\nSL WERBUNG")).toMatch(/Firmennennung/);
    expect(checkTemplateText("Angebot", "Hallo,\nkurze Nachfrage.\nViele Grüße")).toMatch(/Beste Grüße/);
    expect(checkTemplateText("Angebot", "Hallo,\nkurze Nachfrage.\nBeste Grüße\n\n")).toBeNull(); // Leerzeilen am Ende stoeren nicht
  });
});
