import { describe, expect, it } from "vitest";
import {
  buildConfirmationActions, buildConfirmationAttempts, buildConfirmationRequest, ConfirmationSchema, itemsFromDraft, positionsFromDoc,
  shouldPrepareConfirmation, toConfirmationPositions, type SourceDoc,
} from "./confirmation.ts";

// Aufbau wie `published_customer_document_draft.data` eines echten HERO-Dokuments (per API gelesen, Nov. 2026):
// JEDE Position traegt `type: "product"` – ob Leistung oder Artikel, steht nur in `atType`; `id` ist die Stammdaten-ID.
const draft = {
  nr: "0",
  items: [{
    uid: "t1", type: "table", items: [
      { uid: "h1", type: "title", id: 0, text: "PRODUKTION", quantity: null },
      { uid: "a1", type: "product", atType: "SupplyProduct", id: "GBo", nr: "211.7009", name: "Aufkleber <b>lockEX</b>", description: "<p>50 x 20 mm</p>", quantity: 500, unit_type: "Stk", net_price_per_unit: 0.33, vat_percent: 19 },
      { uid: "a2", type: "product", atType: "SupplyService", id: "702973", name: "Paketversand", quantity: 1, unit_type: "Stk", net_price_per_unit: 0, vat_percent: 19, supply_service_id: 0 },
      { uid: "a3", type: "product", name: "Optional", quantity: 1, unit_type: "Stk", net_price_per_unit: 5, optional: true },
      { uid: "h2", type: "title", id: 0, text: "MONTAGE", quantity: null },
      { uid: "s1", type: "product", atType: "SupplyService", id: "301906", name: "Montage", quantity: 2, unit_type: "Std", net_price_per_unit: 72.4, vat_percent: 19, supply_service_id: 89427 },
    ],
  }],
};

const doc: SourceDoc = { id: 21, nr: "AB-2620108", date: "2026-10-21", kind: "ab", projectId: 5, projectNr: "WER-1939", items: itemsFromDraft(draft) };

describe("itemsFromDraft", () => {
  it("liest preisbehaftete Positionen, ohne Titel und optionale, und entfernt HTML", () => {
    expect(doc.items.map((i) => i.uid)).toEqual(["a1", "a2", "s1"]);
    expect(doc.items[0]).toMatchObject({ name: "Aufkleber lockEX", description: "50 x 20 mm", nr: "211.7009", unit: "Stk", quantity: 500, netPrice: 0.33, vat: 19 });
    expect(doc.items[0]).toMatchObject({ kind: "product", catalogId: "GBo", sectionUid: "h1" });
    expect(doc.items[2]).toMatchObject({ kind: "service", catalogId: "301906", sectionUid: "h2", supplyServiceId: 89427 });
    expect(doc.items.map((i) => i.index)).toEqual([2, 3, 6]);
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

  it("Aktionen: Positionen werden aus der Vorlage KOPIERT (mit Abschnittstitel), nie per add_product_position neu angelegt", () => {
    const r = ConfirmationSchema.parse({ summary: "", open_points: [], project_name: null, positions: [
      { source_doc_id: 21, source_uid: "s1", quantity: 2, note: null }, { source_doc_id: 21, source_uid: "a1", quantity: 500, note: null },
      { source_doc_id: 21, source_uid: "a2", quantity: 1, note: null },
    ] });
    const pos = toConfirmationPositions(r, [doc]);
    pos[2].include = false;
    const { actions, hints } = buildConfirmationActions(pos, [{ id: 21, nr: "AB-2620108", kind: "ab" }]);
    // Reihenfolge wie in der Vorlage, nicht wie vom Modell geliefert; frühere AB = „copy“, keine Bezugsdokumente.
    expect(actions).toEqual([{ add_positions_from_document: { documentId: 21, selectedPositions: ["h1", "a1", "h2", "s1"], flowType: "copy" } }]);
    expect(hints).toEqual([]);
    expect(JSON.stringify(buildConfirmationAttempts(pos))).not.toContain("add_product_position\"");
  });

  it("Angebot in AB wandeln: Folgedokument mit allen Positionen, Bezug aufs Angebot und dessen Rabatt", () => {
    const offer: SourceDoc = { ...doc, id: 30, nr: "AG-2610283", kind: "angebot" };
    const attempts = buildConfirmationAttempts(positionsFromDoc(offer), [{ id: 30, nr: "AG-2610283", kind: "angebot" }]);
    expect(attempts[0].actions).toEqual([
      { add_positions_from_document: { documentId: 30, selectedPositions: ["h1", "a1", "a2", "h2", "s1"], flowType: "followup" } },
      { set_reference_documents: { referenceDocumentIds: [30], referenceDocuments: "AG-2610283" } },
      { copy_sales_metadata: { documentId: 30 } },
    ]);
    // Rueckfall 1: nur die Kopie; Rueckfall 2: Stammdaten (Leistung per ID, Artikel per ID)
    expect(attempts[1].actions).toEqual([attempts[0].actions[0]]);
    expect(attempts[2].actions).toEqual([
      { add_product_position_by_id: { product_id: "GBo", quantity: 500 } },
      { add_existing_service: { supplyServiceId: 702973, quantity: 1 } },
      { add_existing_service: { supplyServiceId: 301906, quantity: 2 } },
    ]);
    expect(attempts[2].hints[0]).toMatch(/Stammdaten.*AG-2610283/);
  });

  it("andere Menge: nach dem Kopieren per uid aendern; Rueckfall nennt die Menge als Hinweis", () => {
    const pos = positionsFromDoc(doc).map((p) => (p.uid === "s1" ? { ...p, quantity: 5 } : p.uid === "a1" ? { ...p, quantity: 1000 } : p));
    const attempts = buildConfirmationAttempts(pos, [{ id: 21, nr: "AB-2620108", kind: "ab" }]);
    expect(attempts[0].actions.slice(1)).toEqual([
      { update_supply_product: { uid: "a1", quantity: 1000 } },
      { update_supply_service: { uid: "s1", quantity: 5 } },
    ]);
    expect(attempts[1].actions).toHaveLength(1);
    expect(attempts[1].hints.join(" ")).toMatch(/Montage“: Menge in HERO auf 5 Std ändern/);
  });

  it("alte Vorschlaege ohne Art/Abschnitt: Kopie nur mit den Positions-uids; nichts ausgewaehlt = keine Versuche", () => {
    const old = positionsFromDoc(doc).map(({ kind: _k, catalogId: _c, sectionUid: _s, index: _i, ...rest }) => rest);
    const a = buildConfirmationAttempts(old);
    expect(a[0].actions).toEqual([{ add_positions_from_document: { documentId: 21, selectedPositions: ["a1", "a2", "s1"], flowType: "copy" } }]);
    expect(a).toHaveLength(1);
    expect(buildConfirmationAttempts(old.map((p) => ({ ...p, include: false })))).toEqual([]);
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
