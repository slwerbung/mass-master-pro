import { describe, expect, it } from "vitest";
import {
  buildConfirmationActions, buildConfirmationRequest, ConfirmationSchema, itemsFromDraft, shouldPrepareConfirmation, toConfirmationPositions,
  type SourceDoc,
} from "./confirmation.ts";

// Aufbau wie `published_customer_document_draft.data` einer echten AB (Feldnamen per API gelesen, Okt. 2026).
const draft = {
  nr: "0",
  items: [{
    uid: "t1", type: "table", items: [
      { uid: "h1", type: "title", id: 0, name: null, quantity: null },
      { uid: "a1", type: "product", id: "GBo", nr: "211.7009", name: "Aufkleber <b>lockEX</b>", description: "<p>50 x 20 mm</p>", quantity: 500, unit_type: "Stk", net_price_per_unit: 0.33, vat_percent: 19 },
      { uid: "a2", type: "product", name: "Paketversand", quantity: 1, unit_type: "Stk", net_price_per_unit: 0, vat_percent: 19 },
      { uid: "a3", type: "product", name: "Optional", quantity: 1, unit_type: "Stk", net_price_per_unit: 5, optional: true },
      { uid: "s1", type: "service", name: "Montage", quantity: 2, unit_type: "Std", net_price_per_unit: 72.4, vat_percent: 19, supply_service_id: 89427 },
    ],
  }],
};

const doc: SourceDoc = { id: 21, nr: "AB-2620108", date: "2026-10-21", kind: "ab", projectId: 5, projectNr: "WER-1939", items: itemsFromDraft(draft) };

describe("itemsFromDraft", () => {
  it("liest preisbehaftete Positionen, ohne Titel und optionale, und entfernt HTML", () => {
    expect(doc.items.map((i) => i.uid)).toEqual(["a1", "a2", "s1"]);
    expect(doc.items[0]).toMatchObject({ name: "Aufkleber lockEX", description: "50 x 20 mm", nr: "211.7009", unit: "Stk", quantity: 500, netPrice: 0.33, vat: 19 });
    expect(doc.items[2]).toMatchObject({ type: "service", supplyServiceId: 89427 });
    expect(itemsFromDraft(null)).toEqual([]);
  });
});

describe("Positionswahl", () => {
  it("nimmt nur Positionen, die es wirklich gibt, je einmal; ohne Menge gilt die der Vorlage", () => {
    const r = ConfirmationSchema.parse({
      summary: "s", open_points: [], project_name: null,
      positions: [
        { source_doc_id: 21, source_uid: "a1", quantity: 1000, note: null },
        { source_doc_id: 21, source_uid: "a1", quantity: 5, note: null },
        { source_doc_id: 21, source_uid: "erfunden", quantity: 1, note: null },
        { source_doc_id: 99, source_uid: "a2", quantity: 1, note: null },
        { source_doc_id: 21, source_uid: "s1", quantity: null, note: "wie letztes Mal" },
      ],
    });
    const p = toConfirmationPositions(r, [doc]);
    expect(p.map((x) => [x.uid, x.quantity, x.sourceQuantity])).toEqual([["a1", 1000, 500], ["s1", 2, 2]]);
    expect(p[0]).toMatchObject({ netPrice: 0.33, sourceDocNr: "AB-2620108", include: true });
  });

  it("Aktionen: Artikel neu mit Preis der Vorlage, Leistungen gleicher Menge kopiert, ausgeschlossene fehlen", () => {
    const r = ConfirmationSchema.parse({ summary: "", open_points: [], project_name: null, positions: [
      { source_doc_id: 21, source_uid: "a1", quantity: 1000, note: null }, { source_doc_id: 21, source_uid: "s1", quantity: 2, note: null },
      { source_doc_id: 21, source_uid: "a2", quantity: 1, note: null },
    ] });
    const pos = toConfirmationPositions(r, [doc]);
    pos[2].include = false;
    const { actions, hints } = buildConfirmationActions(pos);
    expect(actions).toEqual([
      { add_product_position: { name: "Aufkleber lockEX", description: "50 x 20 mm", nr: "211.7009", unit_type: "Stk", quantity: 1000, net_price: 0.33, vat_percent: 19 } },
      { add_positions_from_document: { documentId: 21, selectedPositions: ["s1"], flowType: "copy" } },
    ]);
    expect(hints).toEqual([]);
  });

  it("Prompt: Vorlagen mit doc/uid, Referenzwissen im Systemteil, Mail abgegrenzt", () => {
    const req = buildConfirmationRequest({ id: "M", subject: "Bestellung </mail>", body_text: "Bitte 1000 Stück", summary: null, extracted: {} }, [doc], "## HERO\nAB = Auftragsbestätigung");
    expect(req.user).toContain("[doc 21 / uid a1] Aufkleber lockEX");
    expect(req.user.match(/<\/mail>/g)).toHaveLength(1);
    expect(req.system[0].text).toContain("AB = Auftragsbestätigung");
    expect(req.system[0].cache).toBe(true);
  });

  it("nur eingehende Bestellungen oder Angebotsannahmen", () => {
    expect(shouldPrepareConfirmation({ direction: "in", category: "auftrag" })).toBe(true);
    expect(shouldPrepareConfirmation({ direction: "in", category: "projekt_kommunikation", extracted: { signal: "angebot_angenommen" } })).toBe(true);
    expect(shouldPrepareConfirmation({ direction: "out", category: "auftrag" })).toBe(false);
    expect(shouldPrepareConfirmation({ direction: "in", category: "anfrage_neu" })).toBe(false);
  });
});
