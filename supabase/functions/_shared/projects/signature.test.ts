import { describe, expect, it } from "vitest";
import { pickSignature } from "./signature.ts";

const accs = [
  { address: "info@slwerbung.de", signature_html: "<p>Info</p>" },
  { address: "jl@slwerbung.de", signature_html: " <p>Langner</p> " },
  { address: "sl@slwerbung.de", signature_html: "<p>Layer</p>" },
  { address: "leer@slwerbung.de", signature_html: "  " },
];

describe("pickSignature", () => {
  it("nimmt die Signatur des zustaendigen Mitarbeiters (Adresse = Postfach), nicht die des Postfachs der Mail", () => {
    expect(pickSignature(["jl@slwerbung.de"], "sl@slwerbung.de", accs)).toEqual({ html: "<p>Langner</p>", address: "jl@slwerbung.de" });
  });
  it("erster Zustaendiger mit Signatur gewinnt; Gross/Klein und Leerzeichen sind egal", () => {
    expect(pickSignature(["unbekannt@x.de", " SL@slwerbung.DE "], null, accs)?.address).toBe("sl@slwerbung.de");
  });
  it("ohne Zustaendige zaehlt, wer klickt", () => {
    expect(pickSignature([], "jl@slwerbung.de", accs)?.html).toBe("<p>Langner</p>");
  });
  it("ohne passendes Postfach, bei leerer Signatur oder ohne Angaben: null (nie eine fremde Signatur)", () => {
    expect(pickSignature(["niemand@x.de"], "auch-niemand@x.de", accs)).toBeNull();
    expect(pickSignature(["leer@slwerbung.de"], null, accs)).toBeNull();
    expect(pickSignature([], null, accs)).toBeNull();
  });
});
