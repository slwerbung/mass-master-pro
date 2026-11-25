import { describe, expect, it } from "vitest";
import { parseDraftFromEditHtml } from "./parse.ts";

const page = (store: string) => `<html><script>window.X={"features":{"a":true},"DocumentStore":${store},"other":{"x":1}};</script></html>`;
const store = JSON.stringify({ draft: { id: 1, customer_document_id: 22589010, status_code: 0, data: { subject: 'Klammer } und { im "Text"', items: [] } } });

describe("parseDraftFromEditHtml", () => {
  it("liest den Draft, Klammern und Anführungszeichen in Strings stören nicht", () => {
    const d = parseDraftFromEditHtml(page(store), 22589010);
    expect(d.id).toBe(1);
    expect(d.data.subject).toBe('Klammer } und { im "Text"');
  });
  it("falsches Dokument wird abgelehnt", () => {
    expect(() => parseDraftFromEditHtml(page(store), 1)).toThrow(/erwartet/);
  });
  it("leere Hülle (mit X-Requested-With) -> klare Fehlermeldung", () => {
    expect(() => parseDraftFromEditHtml('<div id="EditorApp"></div>')).toThrow(/keinen DocumentStore/);
  });
  it("abgeschnittenes JSON und fehlender draft", () => {
    expect(() => parseDraftFromEditHtml('"DocumentStore":{"draft":{"id":1')).toThrow(/nicht abgeschlossen|nicht lesbar/);
    expect(() => parseDraftFromEditHtml(page('{"foo":1}'))).toThrow(/ohne draft/);
  });
});
