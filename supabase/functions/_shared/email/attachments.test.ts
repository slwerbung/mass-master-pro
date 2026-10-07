import { describe, expect, it } from "vitest";
import { buildUploadItems, type AttachmentRow } from "./attachments.ts";

const dt = { layouts: 1, aufmasse: 2, druckdaten: 3, fahrzeugdaten: 4, allgemein: 5 };
const a = (o: Partial<AttachmentRow>): AttachmentRow => ({ id: "a", filename: "f.pdf", mime: "application/pdf", size: 50000, role: "sonstiges", storage_path: "p", is_ignored: false, ...o });

describe("buildUploadItems", () => {
  it("Rolle -> Dokumenttyp laut Konzept", () => {
    const items = buildUploadItems([
      a({ id: "1", role: "logo" }), a({ id: "2", role: "skizze" }), a({ id: "3", role: "foto" }), a({ id: "4", role: "druckdaten" }),
      a({ id: "5", role: "fahrzeugbild" }), a({ id: "6", role: "sonstiges" }),
    ], dt);
    expect(items.map((i) => [i.attachmentId, i.docKey, i.documentTypeId])).toEqual([
      ["1", "layouts", 1], ["2", "layouts", 1], ["3", "aufmasse", 2], ["4", "druckdaten", 3], ["5", "fahrzeugdaten", 4], ["6", "allgemein", 5],
    ]);
  });
  it("ueberspringt Ignoriertes, Ungespeichertes, schon Hochgeladenes und Rechnungen", () => {
    const items = buildUploadItems([
      a({ id: "1", is_ignored: true }), a({ id: "2", storage_path: null }), a({ id: "3", hero_uploaded_at: "2026-01-01" }),
      a({ id: "4", role: "rechnung" }), a({ id: "5" }),
    ], dt);
    expect(items.map((i) => i.attachmentId)).toEqual(["5"]);
  });
  it("Rolle unbekannt/leer -> Allgemein; ohne konfigurierten Typ kein Vorschlag", () => {
    expect(buildUploadItems([a({ role: null })], dt)[0].docKey).toBe("allgemein");
    expect(buildUploadItems([a({ role: "komisch" })], dt)[0].docKey).toBe("allgemein");
    expect(buildUploadItems([a({ role: "logo" })], { allgemein: 5 })).toEqual([]);
  });
});
