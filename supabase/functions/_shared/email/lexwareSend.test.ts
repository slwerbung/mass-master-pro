import { describe, expect, it } from "vitest";
import { vi } from "vitest";
// nodemailer wird nur zum Versenden gebraucht; der Test prueft die Empfaengerregel.
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: async () => {}, close: () => {} }) } }));
import { assertAllowedRecipient, SendRefused, sendToLexware } from "./lexwareSend.ts";

describe("assertAllowedRecipient – Versand nur an die Lexware-Adresse", () => {
  it("erlaubt genau die hinterlegte Adresse (Gross-/Kleinschreibung egal)", () => {
    expect(() => assertAllowedRecipient("Belege@Lexware.example", "belege@lexware.example")).not.toThrow();
  });
  it("verweigert jeden anderen Empfaenger", () => {
    for (const to of ["kunde@x.de", "belege@lexware.example.evil.com", "belege@lexware.example,kunde@x.de", ""]) {
      expect(() => assertAllowedRecipient(to, "belege@lexware.example")).toThrow(SendRefused);
    }
  });
  it("verweigert, wenn keine gueltige Adresse hinterlegt ist", () => {
    for (const a of ["", "kaputt", "a@b"]) expect(() => assertAllowedRecipient("a@b.de", a)).toThrow(/Belegadresse/);
  });
});

describe("sendToLexware", () => {
  const smtp = { host: "smtp.example", port: 465, user: "u", pass: "p" };
  it("verweigert fremde Empfaenger BEVOR eine Verbindung aufgebaut wird", async () => {
    await expect(sendToLexware(smtp, "info@x.de", "kunde@x.de", "belege@lexware.example", new Uint8Array([1]))).rejects.toBeInstanceOf(SendRefused);
  });
  it("verweigert ohne SMTP-Server", async () => {
    await expect(sendToLexware({ ...smtp, host: "" }, "info@x.de", "belege@lexware.example", "belege@lexware.example", new Uint8Array([1]))).rejects.toThrow(/SMTP/);
  });
  it("sendet an die erlaubte Adresse", async () => {
    await expect(sendToLexware(smtp, "info@x.de", "belege@lexware.example", "belege@lexware.example", new Uint8Array([1]))).resolves.toBeUndefined();
  });
});
