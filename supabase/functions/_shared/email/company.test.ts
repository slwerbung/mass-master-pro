import { describe, expect, it } from "vitest";
import { fillCompany, FIRMA_FALLBACK, parseCompanyName, senderName } from "./company.ts";
import { withCompany } from "./llm.ts";

describe("Firmenname aus legal_info", () => {
  it("liest JSON-Text und Objekt", () => {
    expect(parseCompanyName('{"companyName":" Muster GmbH "}')).toBe("Muster GmbH");
    expect(parseCompanyName({ companyName: "X" })).toBe("X");
    expect(parseCompanyName("kaputt")).toBe("");
    expect(parseCompanyName(null)).toBe("");
  });
  it("setzt den Namen in Anweisungen ein, ohne Namen einen neutralen Hinweis", () => {
    expect(fillCompany("Assistent der Firma {{FIRMA}}.", "Muster GmbH")).toBe("Assistent der Firma Muster GmbH.");
    expect(fillCompany("Assistent der Firma {{FIRMA}}.", "")).toBe(`Assistent der Firma ${FIRMA_FALLBACK}.`);
    const r = withCompany({ system: [{ text: "A {{FIRMA}}", cache: true }], user: "B {{FIRMA}}", schemaName: "s", jsonSchema: {} }, "M");
    expect(r.system[0]).toEqual({ text: "A M", cache: true });
    expect(r.user).toBe("B M");
  });
  it("Absendername: Firma, sonst Postfach-Bezeichnung", () => {
    expect(senderName("Muster GmbH", { label: "Info" })).toBe("Muster GmbH");
    expect(senderName("", { label: "Info" })).toBe("Info");
    expect(senderName("", {})).toBe("");
  });
});
