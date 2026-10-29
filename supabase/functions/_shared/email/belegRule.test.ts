import { describe, expect, it } from "vitest";
import { isLexwareBeleg } from "./belegRule.ts";

const m = (subject: string, category = "beleg") => ({ category, subject, extracted: { beleg: { is_booking_document: true } } });

describe("isLexwareBeleg", () => {
  it("Rechnungen, Gutschriften, Quittungen gehen an Lexware", () => {
    for (const s of ["Ihre IONOS Rechnung 100194883903 ist da", "Credit note from Anthropic, PBC", "Your refund from Anthropic", "RE 42612558 / 22-10-2026 / KU 18820", "Your receipt from GoCohort"]) {
      expect(isLexwareBeleg(m(s))).toBe(true);
    }
  });
  it("Auftragsbestaetigungen, Lieferscheine, Versandbestaetigungen nie", () => {
    for (const s of ["AB 82600491 / 20-10-2026 / KU 18820", "Auftragsbestätigung für Bestellung B-261022CVPB", "Ihr Lieferschein 4711", "Versandbestätigung Ihrer Bestellung", "Order confirmation #123"]) {
      expect(isLexwareBeleg(m(s))).toBe(false);
    }
  });
  it("andere Kategorie nur mit ausdruecklicher Rechnung im Betreff", () => {
    expect(isLexwareBeleg(m("Rechnung 1", "lieferant"))).toBe(true);
    expect(isLexwareBeleg(m("Ihre Bestellung 4711", "lieferant"))).toBe(false);
    expect(isLexwareBeleg({ ...m("Rechnung 1", "lieferant"), extracted: { beleg: { is_booking_document: false } } })).toBe(false);
  });
  it("ausdrueckliche Rechnung gewinnt", () => {
    expect(isLexwareBeleg(m("Rechnung und Lieferschein zu Auftrag 5"))).toBe(true);
  });
});
