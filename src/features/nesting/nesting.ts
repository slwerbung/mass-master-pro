// Shelf / row packing (first-fit). A single pack() produces the placement and
// is reused for both output and the auto-width simulation.
//
// Coordinate system: X to the right, Y upward-negative (each new row is lower).
// SVG export converts to Y-down (see svg.ts).

import type { NestingOptions, PackResult, PlatziertesTeil, Teil } from "./types";

export const DEFAULT_OPTIONS: NestingOptions = {
  folienbreite: 1370,
  autoBreite: true,
  breitenKandidaten: [1000, 1370, 1520],
  zugabe: 0,
  rand: 20,
  abstand: 5,
  reihenAbstand: 40,
  textAbstand: 25,
  schriftgroesse: 20,
  sortieren: true,
  optimierung: "laenge",
  projektnummer: "",
};

export function pack(teile: Teil[], folienbreite: number, opt: NestingOptions): PackResult {
  const { rand, abstand, reihenAbstand, zugabe, sortieren } = opt;

  const usable = folienbreite - 2 * rand;   // usable width
  const right = folienbreite - rand;        // right boundary (symmetric margins)

  // Apply Zugabe
  const mitZugabe = teile.map((t) => ({
    ...t,
    breite: t.breite + zugabe * 2,
    hoehe: t.hoehe + zugabe * 2,
  }));

  // Sort by height descending
  const work = sortieren
    ? [...mitZugabe].sort((a, b) => b.hoehe - a.hoehe)
    : mitZugabe;

  const out: PlatziertesTeil[] = [];
  let x = rand;
  let y = 0;
  let reihenHoehe = 0;

  for (const t of work) {
    let b = t.breite, h = t.hoehe, gedreht = false, zuGross = false;

    // Rotate only when needed (so the part fits the width)
    if (b > usable) { [b, h] = [h, b]; gedreht = true; }
    // Does not fit even rotated -> flag
    if (b > usable) zuGross = true;

    // No more room in the row -> new row
    if (x + b > right) {
      x = rand;
      y = y - reihenHoehe - reihenAbstand;
      reihenHoehe = 0;
    }

    out.push({ ...t, x, y, pBreite: b, pHoehe: h, gedreht, zuGross });

    x += b + abstand;
    if (h > reihenHoehe) reihenHoehe = h;
  }

  const laengeMm = Math.abs(y - reihenHoehe);
  return {
    teile: out,
    laengeMm,
    folienbreite,
    flaecheM2: (folienbreite / 1000) * (laengeMm / 1000),
  };
}

/**
 * Picks the best candidate width. "flaeche" minimises the used foil area (m²);
 * "laenge" minimises the required length, with area as the tie-breaker so a
 * tie between widths still prefers the narrower (less-waste) foil.
 */
function besteBreite(teile: Teil[], opt: NestingOptions): PackResult {
  let best: PackResult | null = null;
  for (const w of opt.breitenKandidaten) {
    const r = pack(teile, w, opt);
    if (!best) { best = r; continue; }
    if (opt.optimierung === "laenge") {
      if (r.laengeMm < best.laengeMm - 1e-9) best = r;
      else if (Math.abs(r.laengeMm - best.laengeMm) <= 1e-9 && r.flaecheM2 < best.flaecheM2) best = r;
    } else {
      if (r.flaecheM2 < best.flaecheM2 - 1e-9) best = r;
      else if (Math.abs(r.flaecheM2 - best.flaecheM2) <= 1e-9 && r.laengeMm < best.laengeMm) best = r;
    }
  }
  return best!;
}

export function nesting(teile: Teil[], opt: NestingOptions): PackResult {
  return opt.autoBreite ? besteBreite(teile, opt) : pack(teile, opt.folienbreite, opt);
}
