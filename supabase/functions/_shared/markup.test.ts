import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { containRect, markupToDrawOps, numberTopLevel, simplifyPath, validateMarkup, validateMediaRef } from "./markup.ts";

describe("markup.ts", () => {
  it("Kopie in src/lib/markup.ts ist identisch", () => {
    const root = join(__dirname, "../../..");
    expect(readFileSync(join(root, "src/lib/markup.ts"), "utf8")).toBe(readFileSync(join(root, "supabase/functions/_shared/markup.ts"), "utf8"));
  });

  it("gültige Markierung, Rundungsausreißer werden geklemmt", () => {
    const r = validateMarkup({ v: 1, color: "#E11D48", shapes: [{ t: "rect", x: -0.01, y: 0.2, w: 0.5, h: 1.02 }, { t: "pin", x: 1.01, y: 0.5 }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.markup.shapes[0]).toEqual({ t: "rect", x: 0, y: 0.2, w: 0.5, h: 0.8 });
      expect(r.markup.shapes[1]).toEqual({ t: "pin", x: 1, y: 0.5 });
    }
  });

  it("ungültig: Koordinate 5, zu viele Punkte, zu viele Formen, Farbe, leer, Text leer", () => {
    expect(validateMarkup({ v: 1, color: "#E11D48", shapes: [{ t: "pin", x: 5, y: 0 }] }).ok).toBe(false);
    const many = Array.from({ length: 10000 }, (_, i) => [i / 10000, 0.5]);
    expect(validateMarkup({ v: 1, color: "#E11D48", shapes: [{ t: "path", pts: many }] }).ok).toBe(false);
    expect(validateMarkup({ v: 1, color: "#E11D48", shapes: Array.from({ length: 31 }, () => ({ t: "pin", x: 0.1, y: 0.1 })) }).ok).toBe(false);
    expect(validateMarkup({ v: 1, color: "red", shapes: [{ t: "pin", x: 0.1, y: 0.1 }] }).ok).toBe(false);
    expect(validateMarkup({ v: 1, color: "#E11D48", shapes: [] }).ok).toBe(false);
    expect(validateMarkup({ v: 1, color: "#E11D48", shapes: [{ t: "text", x: 0.1, y: 0.1, text: "  " }] }).ok).toBe(false);
    expect(validateMarkup({ v: 2, color: "#E11D48", shapes: [{ t: "pin", x: 0.1, y: 0.1 }] }).ok).toBe(false);
    expect(validateMarkup({ v: 1, color: "#E11D48", shapes: [{ t: "pin", x: NaN, y: 0.1 }] }).ok).toBe(false);
  });

  it("validateMediaRef", () => {
    expect(validateMediaRef({ kind: "pdf", storagePath: "a/b.pdf", page: 2 })).toEqual({ ok: true, ref: { kind: "pdf", storagePath: "a/b.pdf", page: 2 } });
    expect(validateMediaRef({ kind: "pdf", storagePath: "a/b.pdf", page: 0 }).ok).toBe(false);
    expect(validateMediaRef({ kind: "image", storagePath: "" }).ok).toBe(false);
    expect(validateMediaRef({ kind: "video", storagePath: "x" }).ok).toBe(false);
  });

  it("Douglas-Peucker: gerade Linie schrumpft auf Endpunkte, Ecke bleibt", () => {
    const line: [number, number][] = Array.from({ length: 50 }, (_, i) => [i / 49, 0.5]);
    expect(simplifyPath(line)).toEqual([[0, 0.5], [1, 0.5]]);
    const corner: [number, number][] = [[0, 0], [0.25, 0], [0.5, 0], [0.5, 0.25], [0.5, 0.5]];
    expect(simplifyPath(corner)).toEqual([[0, 0], [0.5, 0], [0.5, 0.5]]);
  });

  it("containRect: Hochformat in Querformat-Container (Letterbox seitlich)", () => {
    const r = containRect({ w: 1000, h: 500 }, { w: 210, h: 297 });
    expect(r.h).toBeCloseTo(500); expect(r.y).toBeCloseTo(0);
    expect(r.w).toBeCloseTo(210 * 500 / 297); expect(r.x).toBeCloseTo(500 - (210 * 500 / 297) / 2);
    expect(containRect({ w: 400, h: 400 }, { w: 800, h: 400 })).toEqual({ x: 0, y: 100, w: 400, h: 200 });
  });

  it("markupToDrawOps rechnet ins Zielrechteck und legt den Badge an den Anker", () => {
    const ops = markupToDrawOps({ v: 1, color: "#E11D48", shapes: [{ t: "rect", x: 0.5, y: 0.5, w: 0.25, h: 0.5 }] }, { x: 100, y: 0, w: 200, h: 400 }, { label: "3", done: false });
    expect(ops[0]).toEqual({ op: "rect", x: 200, y: 200, w: 50, h: 200, color: "#E11D48" });
    expect(ops[1]).toEqual({ op: "badge", x: 200, y: 200, label: "3", color: "#E11D48", done: false });
    const arrow = markupToDrawOps({ v: 1, color: "#000000", shapes: [{ t: "arrow", x1: 0, y1: 0, x2: 1, y2: 0 }] }, { x: 0, y: 0, w: 100, h: 100 });
    expect(arrow.filter((o) => o.op === "line")).toHaveLength(3);
  });

  it("numberTopLevel: älteste zuerst, Antworten ohne Nummer", () => {
    const n = numberTopLevel([
      { id: "b", parent_id: null, created_at: "2026-11-02" },
      { id: "r", parent_id: "a", created_at: "2026-11-03" },
      { id: "a", parent_id: null, created_at: "2026-11-01" },
    ]);
    expect([...n]).toEqual([["a", 1], ["b", 2]]);
  });
});
