import { describe, expect, it } from "vitest";
import { clampView, discardStroke, doubleTap, IDENTITY, pinch, zoomAt } from "./gestures";

describe("Gesten", () => {
  it("zoomAt hält den Punkt unter dem Finger fest und klemmt auf 1×–4×", () => {
    const v = zoomAt(IDENTITY, 2, 100, 50);
    expect(v).toEqual({ scale: 2, tx: -100, ty: -50 });
    expect(zoomAt(v, 10, 0, 0).scale).toBe(4);
    expect(zoomAt(IDENTITY, 0.5, 0, 0).scale).toBe(1);
  });
  it("pinch: Finger auseinander = Zoom um den Mittelpunkt, gemeinsam bewegen = verschieben", () => {
    const v = pinch(IDENTITY, { x: 90, y: 100 }, { x: 110, y: 100 }, { x: 80, y: 100 }, { x: 120, y: 100 });
    expect(v.scale).toBeCloseTo(2);
    expect(v.tx).toBeCloseTo(-100);
    const moved = pinch(IDENTITY, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 15, y: 5 });
    expect(moved).toEqual({ scale: 1, tx: 5, ty: 5 });
  });
  it("clampView und Doppeltipp", () => {
    expect(clampView({ scale: 1, tx: 30, ty: 30 }, 100, 100)).toEqual(IDENTITY);
    expect(clampView({ scale: 2, tx: 50, ty: -500 }, 100, 100)).toEqual({ scale: 2, tx: 0, ty: -100 });
    expect(doubleTap(IDENTITY, 10, 10).scale).toBe(2);
    expect(doubleTap({ scale: 2, tx: -10, ty: -10 }, 10, 10)).toEqual(IDENTITY);
  });
  it("Strich verwerfen nur innerhalb von 150 ms", () => {
    expect(discardStroke(1000, 1100)).toBe(true);
    expect(discardStroke(1000, 1200)).toBe(false);
    expect(discardStroke(null, 1200)).toBe(false);
  });
});
