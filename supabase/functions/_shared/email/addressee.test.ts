import { describe, expect, it } from "vitest";
import { addresseeOf } from "./addressee.ts";

const users = [
  { id: "s", name: "Silas Werner", emails: ["info@slwerbung.de"] },
  { id: "j", name: "Jonas Lang", emails: ["jl@slwerbung.de"] },
  { id: "m", name: "Maria Jonas-Berg", emails: [] },
];

describe("Wer bekommt die Mail zur Entscheidung", () => {
  it("Anrede mit Vorname oder Nachname", () => {
    expect(addresseeOf({ body_text: "Hallo Silas,\n\nanbei die Daten." }, users)?.id).toBe("s");
    expect(addresseeOf({ body_text: "Sehr geehrter Herr Lang,\nwir bestellen…" }, users)?.id).toBe("j");
    expect(addresseeOf({ body_text: "Guten Morgen Maria!\n…" }, users)?.id).toBe("m");
    expect(addresseeOf({ body_text: "\n\nLiebe Maria Jonas-Berg,\n…" }, users)?.id).toBe("m");
  });

  it("allgemein oder nicht eindeutig = alle", () => {
    expect(addresseeOf({ body_text: "Sehr geehrte Damen und Herren,\n…" }, users)).toBeNull();
    expect(addresseeOf({ body_text: "Hallo zusammen,\n…" }, users)).toBeNull();
    expect(addresseeOf({ body_text: "Hallo Jonas,\n…" }, users)).toBeNull(); // Jonas Lang oder Maria Jonas-Berg
    expect(addresseeOf({ body_text: "Hallo Peter,\n…" }, users)).toBeNull();
    expect(addresseeOf({ body_text: "Wir haben noch eine Frage. Hallo Silas, …" }, users)).toBeNull(); // nicht am Anfang
  });

  it("eigene Adresse im An-Feld, z. Hd. im Betreff", () => {
    expect(addresseeOf({ to_addrs: ["jl@slwerbung.de"], body_text: "Hallo zusammen" }, users)?.id).toBe("j");
    expect(addresseeOf({ to_addrs: ["jl@slwerbung.de", "info@slwerbung.de"], body_text: "Hallo Silas" }, users)).toBeNull();
    expect(addresseeOf({ subject: "Angebot z. Hd. Herrn Lang", body_text: "Guten Tag," }, users)?.id).toBe("j");
  });

  it("nur ein Mitarbeiter mit Zugriff: keine Einschraenkung", () => {
    expect(addresseeOf({ body_text: "Hallo Silas" }, [users[0]])).toBeNull();
  });
});
