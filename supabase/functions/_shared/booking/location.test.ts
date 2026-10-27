import { describe, expect, it } from "vitest";
import {
  asLocationMode, brauchtAdresse, brauchtAnfahrt, brauchtTelefon, brauchtVideoLink,
  formatOffice, JITSI_DEFAULT, jitsiUrl, LOCATION_LABEL, treffpunktText,
} from "./location.ts";

const BUERO = "Otto-Hahn-Straße 3, 71364 Winnenden";

describe("asLocationMode", () => {
  it("laesst bekannte Arten durch", () => {
    expect(asLocationMode("buero")).toBe("buero");
    expect(asLocationMode("telefon")).toBe("telefon");
    expect(asLocationMode("online")).toBe("online");
    expect(asLocationMode("vor_ort")).toBe("vor_ort");
  });

  it("faellt bei Unbekanntem auf den Termin beim Kunden zurueck", () => {
    // Die sichere Richtung: lieber Anfahrt einrechnen als sie zu verschlucken.
    for (const v of [null, undefined, "", "zoom", 7, {}]) {
      expect(asLocationMode(v)).toBe("vor_ort");
    }
  });
});

describe("Was folgt aus der Art", () => {
  it("rechnet Anfahrt nur beim Kunden", () => {
    expect(brauchtAnfahrt("vor_ort")).toBe(true);
    expect(brauchtAnfahrt("buero")).toBe(false);
    expect(brauchtAnfahrt("telefon")).toBe(false);
    expect(brauchtAnfahrt("online")).toBe(false);
  });

  it("fragt nur beim Kunden nach einer Adresse", () => {
    expect(brauchtAdresse("vor_ort")).toBe(true);
    expect(brauchtAdresse("online")).toBe(false);
  });

  it("macht die Rufnummer nur beim Telefontermin zur Pflicht", () => {
    expect(brauchtTelefon("telefon")).toBe(true);
    expect(brauchtTelefon("vor_ort")).toBe(false);
    expect(brauchtTelefon("online")).toBe(false);
  });

  it("erzeugt einen Videoraum nur beim Onlinetermin", () => {
    expect(brauchtVideoLink("online")).toBe(true);
    expect(brauchtVideoLink("telefon")).toBe(false);
  });

  it("hat fuer jede Art eine Bezeichnung", () => {
    expect(LOCATION_LABEL.buero).toBe("Bei uns im Büro");
    expect(LOCATION_LABEL.telefon).toBe("Telefontermin");
    expect(LOCATION_LABEL.online).toBe("Onlinetermin");
  });
});

describe("formatOffice", () => {
  it("setzt die Adresse aus legal_info zusammen", () => {
    expect(formatOffice({ street: "Otto-Hahn-Straße 3", zip: "71364", city: "Winnenden" })).toBe(BUERO);
  });

  it("vertraegt Lueckenhaftes", () => {
    expect(formatOffice({ city: "Winnenden" })).toBe("Winnenden");
    expect(formatOffice(null)).toBe("");
    expect(formatOffice({})).toBe("");
  });
});

describe("jitsiUrl", () => {
  it("baut einen Raum auf dem Standarddienst", () => {
    const url = jitsiUrl(null, "Onlinetermin");
    expect(url.startsWith(`${JITSI_DEFAULT}/onlinetermin-`)).toBe(true);
  });

  it("nimmt einen eigenen Dienst und vertraegt einen Schraegstrich am Ende", () => {
    expect(jitsiUrl("https://meet.slwerbung.de/", "Beratung")).toMatch(
      /^https:\/\/meet\.slwerbung\.de\/beratung-[0-9a-f]{16}$/,
    );
  });

  it("gibt jedem Termin einen eigenen Raum", () => {
    // Zwei Kunden im selben Raum waere der Fehler, der hier wehtut.
    const a = jitsiUrl(null, "Montage vor Ort");
    const b = jitsiUrl(null, "Montage vor Ort");
    expect(a).not.toBe(b);
  });

  it("macht aus Umlauten und Leerzeichen einen brauchbaren Raumnamen", () => {
    expect(jitsiUrl(null, "Beratung über Maße")).toMatch(/\/beratung-ueber-masse-[0-9a-f]{16}$/);
  });

  it("ist nicht erratbar", () => {
    const url = jitsiUrl(null, "termin");
    // 16 Hex-Zeichen Zufall: nichts, was man im zweiten Versuch tippt.
    expect(url).toMatch(/-[0-9a-f]{16}$/);
  });
});

describe("treffpunktText", () => {
  it("nennt beim Kunden die Kundenadresse", () => {
    expect(treffpunktText({ mode: "vor_ort", customerAddress: "Lange Straße 42, 71563 Affalterbach" }))
      .toBe("Lange Straße 42, 71563 Affalterbach");
  });

  it("nennt im Buero unsere Adresse", () => {
    expect(treffpunktText({ mode: "buero", office: BUERO, customerAddress: "Egal 1" }))
      .toBe(`Bei uns im Büro, ${BUERO}`);
  });

  it("nennt beim Telefontermin die Rufnummer", () => {
    expect(treffpunktText({ mode: "telefon", phone: "07151 1234" }))
      .toBe("Telefontermin, wir rufen an unter 07151 1234");
    expect(treffpunktText({ mode: "telefon" })).toBe("Telefontermin, wir rufen Sie an");
  });

  it("nennt beim Onlinetermin den Link", () => {
    expect(treffpunktText({ mode: "online", meetingUrl: "https://meet.jit.si/abc-1" }))
      .toBe("Onlinetermin: https://meet.jit.si/abc-1");
    expect(treffpunktText({ mode: "online" })).toBe("Onlinetermin, den Link schicken wir per E-Mail");
  });

  it("nimmt bei Buero und Telefon NIE die Kundenadresse", () => {
    for (const mode of ["buero", "telefon", "online"]) {
      expect(treffpunktText({ mode, customerAddress: "Geheimstraße 1" })).not.toContain("Geheimstraße");
    }
  });
});
