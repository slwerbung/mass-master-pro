// "Layout Export": a simpler, separate arrangement from the nesting. Areas are
// placed left to right IN THEIR INPUT ORDER (no sorting, no rotation), with a
// configurable gap between them, and wrap to a new row once a configurable row
// width is reached. Zugabe inflates each rectangle; labels stay below each area
// (rendered by the shared renderSvg).

import type { Teil } from "./types";
import { type RenderPiece, renderSvg } from "./svg";

export interface LayoutOptions {
  /** Horizontal gap between areas in mm. */
  abstand: number;
  /** Vertical gap between rows in mm. */
  zeilenAbstand: number;
  /** Start a new row once the current row would exceed this width in mm. 0 = never wrap. */
  maxZeilenBreiteMm: number;
  /** Zugabe ringsum in mm (added twice to width and height). */
  zugabe: number;
  /** Outer margin in mm. */
  rand: number;
  /** Label font size (SVG units = mm). */
  schriftgroesse: number;
  /** Label baseline offset below the area in mm. */
  textAbstand: number;
  /** Project number, written once into the corner. */
  projektnummer?: string;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  abstand: 10,
  zeilenAbstand: 40,
  maxZeilenBreiteMm: 5000,
  zugabe: 0,
  rand: 0,
  schriftgroesse: 20,
  textAbstand: 25,
  projektnummer: "",
};

export interface LayoutResult {
  pieces: RenderPiece[];
  breiteMm: number;
  hoeheMm: number;
  zeilen: number;
}

export function layoutFlow(teile: Teil[], opt: LayoutOptions): LayoutResult {
  const gap = Math.max(0, opt.abstand);
  const rowGap = Math.max(0, opt.zeilenAbstand);
  const maxW = opt.maxZeilenBreiteMm > 0 ? opt.maxZeilenBreiteMm : Infinity;

  const pieces: RenderPiece[] = [];
  let x = opt.rand;
  let y = opt.rand;
  let rowH = 0;
  let maxRight = opt.rand;
  let zeilen = teile.length > 0 ? 1 : 0;

  for (const t of teile) {
    const b = t.breite + 2 * opt.zugabe;
    const h = t.hoehe + 2 * opt.zugabe;
    // Wrap to a new row when the current row already has a part and this one
    // would push its right edge past the max row width.
    if (x > opt.rand && (x + b - opt.rand) > maxW + 1e-6) {
      x = opt.rand;
      y += rowH + rowGap;
      rowH = 0;
      zeilen++;
    }
    pieces.push({ label: t.label, x, y, pBreite: b, pHoehe: h });
    if (x + b > maxRight) maxRight = x + b;
    x += b + gap;
    if (h > rowH) rowH = h;
  }

  return { pieces, breiteMm: maxRight + opt.rand, hoeheMm: y + rowH, zeilen };
}

export function buildLayoutSvg(teile: Teil[], opt: LayoutOptions): string {
  const { pieces, breiteMm } = layoutFlow(teile, opt);
  return renderSvg(pieces, breiteMm, opt);
}
