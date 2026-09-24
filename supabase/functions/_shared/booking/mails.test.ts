// Mails sind das Einzige an der Buchung, was der Kunde garantiert liest.
// Geprueft wird deshalb: steht der richtige Termin drin, zeigt der richtige
// Link auf die richtige Aktion, und ueberlebt ein Name mit Sonderzeichen den
// Weg ins HTML.

import { describe, expect, it } from "vitest";
import { buildBookingMail, dateText, escapeHtml, timeText, type MailInfo } from "./mails.ts";

// 24.09.2026 ist ein Donnerstag; Berlin liegt im Sommer bei UTC+2.
const info: MailInfo = {
  customerName: "Firma Müller & Co",
  projectNumber: "WER-1234",
  label: "Aufmass vor Ort",
  start: "2026-09-24T07:45:00Z",
  end: "2026-09-24T09:15:00Z",
  address: "Hauptstr. 1, 71332 Waiblingen",
  staffName: "Layer",
  cancelUrl: "https://captfix.app/termin/absagen/tok-abc",
  bookingUrl: "https://captfix.app/termin/p-1",
  staffCancelUrl: "https://captfix.app/termin/intern/tok-staff?mode=cancel",
  staffRescheduleUrl: "https://captfix.app/termin/intern/tok-staff?mode=reschedule",
};

describe("Datum und Uhrzeit", () => {
  it("schreibt deutsches Datum in Berliner Zeit", () => {
    expect(dateText(info.start)).toBe("Donnerstag, 24. September 2026");
  });

  it("rechnet UTC nach Berlin um", () => {
    // 07:45 UTC = 09:45 Berlin (Sommerzeit).
    expect(timeText(info.start, info.end)).toBe("09:45 - 11:15 Uhr");
  });

  it("beachtet die Winterzeit", () => {
    // 07:45 UTC im November = 08:45 Berlin.
    expect(timeText("2026-11-24T07:45:00Z", "2026-11-24T09:15:00Z")).toBe("08:45 - 10:15 Uhr");
  });
});

describe("escapeHtml", () => {
  it("entschaerft die gefaehrlichen Zeichen", () => {
    expect(escapeHtml('<b>"x"</b> & \'y\'')).toBe("&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; &#39;y&#39;");
  });
  it("macht aus null einen leeren String", () => {
    expect(escapeHtml(null)).toBe("");
  });
});

describe("Bestaetigung", () => {
  const mail = buildBookingMail("confirmation", info);

  it("nennt Termin und Uhrzeit im Betreff", () => {
    expect(mail.subject).toBe("Termin bestätigt: Aufmass vor Ort am 24.09.2026 09:45");
  });

  it("enthaelt Adresse, Projekt und Absage-Link", () => {
    expect(mail.html).toContain("Hauptstr. 1, 71332 Waiblingen");
    expect(mail.html).toContain("WER-1234");
    expect(mail.html).toContain("https://captfix.app/termin/absagen/tok-abc");
    expect(mail.html).toContain("09:45 - 11:15 Uhr");
  });

  it("escapet den Kundennamen", () => {
    expect(mail.html).toContain("Firma Müller &amp; Co");
    expect(mail.html).not.toContain("Müller & Co");
  });

  it("laesst den Absage-Knopf weg, wenn es keinen Link gibt", () => {
    const ohne = buildBookingMail("confirmation", { ...info, cancelUrl: undefined });
    expect(ohne.html).not.toContain("Termin absagen");
  });
});

describe("Interne Benachrichtigung", () => {
  it("bietet Umbuchen und Absagen an", () => {
    const mail = buildBookingMail("internal_new", info);
    expect(mail.subject).toContain("WER-1234");
    expect(mail.html).toContain("mode=reschedule");
    expect(mail.html).toContain("mode=cancel");
    expect(mail.html).toContain("Umbuchen lassen");
  });

  it("weist auf einen fehlgeschlagenen HERO-Eintrag hin", () => {
    const mail = buildBookingMail("internal_new", { ...info, heroError: "HTTP 500" });
    expect(mail.html).toContain("NICHT angelegt");
    expect(mail.html).toContain("HTTP 500");
    expect(mail.html).toContain("von Hand eintragen");
  });

  it("schweigt, wenn HERO geklappt hat", () => {
    expect(buildBookingMail("internal_new", info).html).not.toContain("NICHT angelegt");
  });
});

describe("Absage", () => {
  it("bestaetigt die Absage des Kunden, ohne sich zu entschuldigen", () => {
    const mail = buildBookingMail("cancellation", { ...info, cancelReason: "customer" });
    expect(mail.subject).toContain("Termin abgesagt");
    expect(mail.html).toContain("Ihre Absage ist angekommen");
    expect(mail.html).not.toContain("Entschuldigen");
  });

  it("entschuldigt sich, wenn WIR absagen", () => {
    const mail = buildBookingMail("cancellation", { ...info, cancelReason: "staff_cancel" });
    expect(mail.subject).toContain("entfallen");
    expect(mail.html).toContain("Entschuldigen");
    expect(mail.html).toContain("https://captfix.app/termin/p-1");
  });
});

describe("Umbuchung", () => {
  it("bittet um einen neuen Termin und verlinkt die Buchungsseite", () => {
    const mail = buildBookingMail("reschedule", info);
    expect(mail.subject).toContain("Bitte neuen Termin");
    expect(mail.html).toContain("wieder frei");
    expect(mail.html).toContain("https://captfix.app/termin/p-1");
  });
});

describe("Erinnerung", () => {
  it("nennt den Termin und den Absage-Weg", () => {
    const mail = buildBookingMail("reminder", info);
    expect(mail.subject).toContain("Erinnerung");
    expect(mail.html).toContain("24. September 2026");
    expect(mail.html).toContain("tok-abc");
  });
});
