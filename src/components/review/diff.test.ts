import { describe, expect, it } from "vitest";
import { aspectDiffers, countChanged, diffMask, dilate, fitSize, maskToOverlay } from "./diff";

const img = (w: number, h: number, fill: [number, number, number]) => {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set([...fill, 255], i * 4);
  return a;
};

describe("Pixel-Vergleich (Spec D2)", () => {
  it("identische Bilder → 0 geänderte Pixel", () => {
    const a = img(8, 6, [10, 20, 30]);
    expect(countChanged(diffMask(a, a.slice(), 8, 6))).toBe(0);
  });
  it("eine geänderte Zeile → genau diese Zeile; kleine Abweichungen unter der Schwelle zählen nicht", () => {
    const w = 8, h = 6;
    const a = img(w, h, [200, 200, 200]);
    const b = a.slice();
    for (let x = 0; x < w; x++) b.set([0, 0, 0], (2 * w + x) * 4); // Zeile 2 schwarz
    b.set([210, 195, 205], (5 * w + 1) * 4);                      // Rauschen
    const m = diffMask(a, b, w, h, 40);
    expect(countChanged(m)).toBe(w);
    for (let x = 0; x < w; x++) expect(m[2 * w + x]).toBe(1);
  });
  it("Dilatation um 2 px macht aus einem Pixel ein 5×5-Quadrat (am Rand abgeschnitten)", () => {
    const w = 9, h = 9;
    const m = new Uint8Array(w * h); m[4 * w + 4] = 1;
    expect(countChanged(dilate(m, w, h, 2))).toBe(25);
    const c = new Uint8Array(w * h); c[0] = 1;
    expect(countChanged(dilate(c, w, h, 2))).toBe(9);
    expect(countChanged(dilate(m, w, h, 0))).toBe(1);
  });
  it("Overlay: nur geänderte Pixel rot halbtransparent", () => {
    const o = maskToOverlay(new Uint8Array([0, 1]));
    expect([...o.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...o.slice(4, 8)]).toEqual([225, 29, 72, 150]);
  });
  it("Rastergröße und Formatwechsel", () => {
    expect(fitSize(3000, 2000)).toEqual({ w: 1600, h: 1067 });
    expect(aspectDiffers({ w: 100, h: 50 }, { w: 200, h: 100 })).toBe(false);
    expect(aspectDiffers({ w: 100, h: 50 }, { w: 100, h: 100 })).toBe(true);
  });
});
