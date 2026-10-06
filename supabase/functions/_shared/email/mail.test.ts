import { describe, expect, it } from "vitest";
import {
  cleanBody, displayName, emailDomain, extractProjectNumbers, htmlToText, isIgnorableAttachment, isNoReply,
  matchesPattern, normalizeSubject, parseMessageIds, projectRelativeId, safeFilename,
} from "./mail.ts";

describe("normalizeSubject", () => {
  it("entfernt Antwort-Praefixe in allen Spielarten", () => {
    expect(normalizeSubject("AW: Re: WG: Angebot Sprinter")).toBe("angebot sprinter");
    expect(normalizeSubject("RE[2]: Frage")).toBe("frage");
    expect(normalizeSubject("  Fwd: Hallo   Welt ")).toBe("hallo welt");
  });
  it("laesst Woerter, die nur so beginnen, in Ruhe", () => {
    expect(normalizeSubject("Reparatur der Folie")).toBe("reparatur der folie");
    expect(normalizeSubject("Awning Test")).toBe("awning test");
  });
});

describe("cleanBody", () => {
  it("schneidet zitierten Verlauf ab (Am … schrieb)", () => {
    const t = "Passt so, bitte umsetzen.\n\nAm 05.10.2026 um 10:00 schrieb Max <m@x.de>:\n> Hier das Layout\n> Gruss";
    expect(cleanBody(t)).toBe("Passt so, bitte umsetzen.");
  });
  it("schneidet bei Original Message und Outlook-Von/Gesendet", () => {
    expect(cleanBody("Danke!\n-----Original Message-----\nFrom: a@b.de\nHallo")).toBe("Danke!");
    expect(cleanBody("Danke!\n\nVon: Max <m@x.de>\nGesendet: Montag\nAn: info@x.de\nBetreff: X\n\nalt")).toBe("Danke!");
  });
  it("behaelt eine einzelne Von:-Zeile im eigenen Text", () => {
    expect(cleanBody("Hallo,\nVon: 8 bis 16 Uhr erreichbar.\nGruss")).toContain("Von: 8 bis 16 Uhr");
  });
  it("schneidet die Signatur ab und entfernt >-Zeilen", () => {
    expect(cleanBody("Hallo\n> zitiert\nGruss\n-- \nMax Mustermann\nTel 123")).toBe("Hallo\nGruss");
  });
  it("kuerzt lange Texte", () => {
    const out = cleanBody("a".repeat(9000), 6000);
    expect(out.length).toBeLessThanOrEqual(6002);
    expect(out.endsWith("…")).toBe(true);
  });
  it("verliert nichts, wenn der Verlauf gleich am Anfang steht", () => {
    expect(cleanBody("Am 01.01.2026 schrieb Max:\nHallo").length).toBeGreaterThan(0);
  });
});

describe("Projektnummern", () => {
  it("findet WER/TEX in allen Schreibweisen, ohne Dubletten", () => {
    expect(extractProjectNumbers("Betreff WER-1234, siehe wer 1234 und TEX-07")).toEqual(["WER-1234", "TEX-7"]);
  });
  it("ignoriert fremde Kuerzel und Zufallstreffer", () => {
    expect(extractProjectNumbers("ABC-123 und SWER-12 und POWER 55")).toEqual([]);
  });
  it("liefert die HERO-relative_id", () => {
    expect(projectRelativeId("WER-1744")).toBe(1744);
    expect(projectRelativeId("kaputt")).toBeNull();
  });
});

describe("Adressen", () => {
  it("passt Muster auf Adresse und Domain inkl. Unterdomain", () => {
    expect(matchesPattern("Info@Vercel.com", "@vercel.com")).toBe(true);
    expect(matchesPattern("x@mail.vercel.com", "@vercel.com")).toBe(true);
    expect(matchesPattern("x@evilvercel.com", "@vercel.com")).toBe(false);
    expect(matchesPattern("a@b.de", "a@b.de")).toBe(true);
    expect(matchesPattern("a@b.de", "c@b.de")).toBe(false);
  });
  it("erkennt Noreply-Absender", () => {
    expect(isNoReply("noreply@shop.de")).toBe(true);
    expect(isNoReply("no-reply@shop.de")).toBe(true);
    expect(isNoReply("MAILER-DAEMON@x.de")).toBe(true);
    expect(isNoReply("anna@shop.de")).toBe(false);
    expect(isNoReply("noreplyfan@shop.de")).toBe(false);
  });
  it("Domain und Anzeigename", () => {
    expect(emailDomain("A@B.De")).toBe("b.de");
    expect(displayName("", "a@b.de")).toBe("a@b.de");
    expect(displayName('"Max M"', "a@b.de")).toBe("Max M");
  });
});

describe("Sonstiges", () => {
  it("zieht Message-IDs aus References", () => {
    expect(parseMessageIds("<a@x> <b@y>\n <c@z>")).toEqual(["<a@x>", "<b@y>", "<c@z>"]);
    expect(parseMessageIds(undefined)).toEqual([]);
  });
  it("macht Dateinamen sicher", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("Größe: 5*5?.pdf")).toBe("Größe_ 5_5_.pdf");
    expect(safeFilename("")).toBe("datei");
  });
  it("ignoriert Signaturbilder und Winzdateien", () => {
    expect(isIgnorableAttachment({ size: 500, mime: "image/gif" })).toBe(true);
    expect(isIgnorableAttachment({ size: 50_000, mime: "image/png", inline: true })).toBe(true);
    expect(isIgnorableAttachment({ size: 50_000, mime: "application/pdf" })).toBe(false);
  });
  it("wandelt HTML in Text", () => {
    const t = htmlToText("<p>Hallo&nbsp;Welt</p><style>x{color:red}</style><p>Zwei</p>");
    expect(t).toContain("Hallo Welt");
    expect(t).toContain("Zwei");
    expect(t).not.toContain("color");
  });
});
