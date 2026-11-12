import { describe, expect, it } from "vitest";
import { hexColor, markupItemsFor, pdfMarkupOps, type FeedbackRow } from "./markupPdf.ts";

const row = (o: Partial<FeedbackRow>): FeedbackRow => ({
  id: "a", location_id: "L", message: "x", author_name: "K", status: "open", created_at: "2026-11-01T10:00:00Z", parent_id: null, markup: null, media_ref: null, ...o,
});

describe("Aufmass-PDF: Markierungen", () => {
  const rect = { v: 1 as const, color: "#2563EB", shapes: [{ t: "rect" as const, x: 0.1, y: 0.2, w: 0.5, h: 0.25 }] };
  const rows = [
    row({ id: "1", created_at: "2026-11-01T10:00:00Z", markup: rect, media_ref: { kind: "pdf", storagePath: "p.pdf", page: 2 } }),
    row({ id: "2", created_at: "2026-11-01T11:00:00Z", markup: rect, media_ref: { kind: "pdf", storagePath: "p.pdf", page: 1 }, status: "done" }),
    row({ id: "3", created_at: "2026-11-01T12:00:00Z", parent_id: "1", markup: null }),
    row({ id: "4", created_at: "2026-11-01T13:00:00Z", markup: rect, media_ref: { kind: "image", storagePath: "f.jpg" } }),
  ];
  it("waehlt nur Markierungen des Mediums und nummeriert wie in der App", () => {
    const p1 = markupItemsFor(rows, (r) => r.kind === "pdf" && r.storagePath === "p.pdf" && r.page === 1);
    expect(p1).toEqual([{ markup: rect, number: 2, done: true }]);
    expect(markupItemsFor(rows, (r) => r.kind === "image").map((i) => i.number)).toEqual([3]);
  });
  it("spiegelt y in PDF-Koordinaten (unten links)", () => {
    const ops = pdfMarkupOps([{ markup: rect, number: 1, done: false }], { x: 100, y: 50, w: 200, h: 400 });
    const r = ops.find((o) => o.op === "rect") as any;
    // oben 0.2·400 = 80 → Oberkante bei 50+400-80 = 370, Unterkante 370-100 = 270
    expect(r).toMatchObject({ x: 120, y: 270, w: 100, h: 100 });
    expect(ops.find((o) => o.op === "badge")).toMatchObject({ label: "1", done: false });
  });
  it("Farbe aus Hex, kaputte Farbe faellt auf Rot zurueck", () => {
    const rgb = (r: number, g: number, b: number) => [r, g, b];
    expect(hexColor(rgb, "#ff0000")).toEqual([1, 0, 0]);
    expect((hexColor(rgb, "kaputt") as number[])[0]).toBeCloseTo(0xe1 / 255);
  });
});
