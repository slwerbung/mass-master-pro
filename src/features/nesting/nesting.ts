// Shelf / row packing (first-fit). A single pack() produces the placement and
// is reused for both output and the auto-width simulation.
//
// Coordinate system: X to the right, Y upward-negative (each new row is lower).
// SVG export converts to Y-down (see svg.ts).

import type { NestingOptions, PackResult, PlatziertesTeil, Teil } from "./types";

export const DEFAULT_OPTIONS: NestingOptions = {
  folienbreite: 1200,
  autoBreite: true,
  breitenKandidaten: [1000, 1200, 1520],
  zugabe: 0,
  rand: 20,
  abstand: 5,
  reihenAbstand: 40,
  textAbstand: 25,
  schriftgroesse: 20,
  sortieren: true,
  optimierung: "laenge",
  stueckeln: true,
  stueckelModus: "gleich",
  maxLaengeMm: 15000,
  spaltenAbstand: 30,
  projektnummer: "",
};

/** Letter suffix for split strips: a, b, … z, then 27, 28, … */
function strapSuffix(i: number): string {
  return i < 26 ? String.fromCharCode(97 + i) : String(i + 1);
}

/**
 * Splits an oversized area into strips that fit the foil width. Only the parts
 * whose SMALLER edge exceeds the (zugabe-adjusted) usable width are split — that
 * edge is divided into strips and the larger edge runs along the foil length
 * (unlimited), which yields the fewest strips. Each strip keeps a seam allowance
 * via the normal Zugabe applied later in pack().
 *
 * @param eff usable width already reduced by 2×Zugabe, so a strip + Zugabe fits.
 */
export function splitTeil(t: Teil, eff: number, opt: NestingOptions): Teil[] {
  const minDim = Math.min(t.breite, t.hoehe);
  const maxDim = Math.max(t.breite, t.hoehe);
  // Fits already (in at least one orientation) or splitting disabled / impossible.
  if (!opt.stueckeln || eff <= 0 || minDim <= eff) return [t];

  const along = maxDim;
  let widths: number[];
  if (opt.stueckelModus === "rest") {
    const full = Math.floor(minDim / eff);
    const rest = minDim - full * eff;
    widths = Array(full).fill(eff);
    if (rest > 1e-6) widths.push(rest);
  } else {
    const n = Math.max(1, Math.ceil(minDim / eff));
    widths = Array(n).fill(minDim / n);
  }
  return widths.map((w, i) => ({
    label: `${t.label}${strapSuffix(i)}`,
    breite: w,
    hoehe: along,
    gestueckelt: true,
  }));
}

export function pack(teile: Teil[], folienbreite: number, opt: NestingOptions): PackResult {
  const { rand, abstand, reihenAbstand, zugabe, sortieren } = opt;

  const usable = folienbreite - 2 * rand;   // usable width
  const right = folienbreite - rand;        // right boundary (symmetric margins)

  // Split oversized areas into fitting strips FIRST (per foil width, so the
  // auto-width comparison sees each width's real splitting). eff leaves room
  // for the per-strip Zugabe added right after.
  const eff = usable - 2 * zugabe;
  const expanded: Teil[] = [];
  for (const t of teile) expanded.push(...splitTeil(t, eff, opt));

  // Apply Zugabe
  const mitZugabe = expanded.map((t) => ({
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

// ── Multi-width: assign each area to its best-fitting foil width ───────────

export interface NestGruppe {
  folienbreite: number;
  teile: Teil[];      // original parts assigned to this width (pre-split)
  result: PackResult; // packed layout (incl. any splitting)
}

/**
 * Width utilisation for a part placed across a foil: how much of the usable
 * width is filled once as many copies as fit share a row. Higher = less
 * width-waste. Accounts for multiple parts per row (e.g. two 500 mm parts fit
 * a 1200 mm foil but not a 1000 mm one).
 */
function auslastung(across: number, usable: number, abstand: number): number {
  if (across > usable || usable <= 0) return 0;
  const perRow = Math.floor((usable + abstand) / (across + abstand));
  return perRow > 0 ? (perRow * across) / usable : 0;
}

/**
 * "Mitdenken": splits the job across several foil widths, assigning each area
 * to the candidate width where it wastes the least width (narrower width wins
 * ties). Each used width is then nested separately. Returns one group per used
 * width. Reduces naturally to a single group when one width suits everything.
 */
export function nestingMulti(teile: Teil[], opt: NestingOptions): NestGruppe[] {
  if (teile.length === 0) return [];
  const widths = [...new Set(opt.breitenKandidaten)].filter((w) => w > 0).sort((a, b) => a - b);
  if (widths.length === 0) return [{ folienbreite: opt.folienbreite, teile, result: pack(teile, opt.folienbreite, opt) }];

  // Candidate A — assign each area to the width where it wastes the least width.
  const buckets = new Map<number, Teil[]>();
  for (const t of teile) {
    const across = Math.min(t.breite, t.hoehe) + 2 * opt.zugabe; // narrowest orientation
    let bestW = widths[widths.length - 1];
    let bestU = -1;
    for (const w of widths) {
      const u = auslastung(across, w - 2 * opt.rand, opt.abstand);
      if (u > bestU + 1e-9) { bestU = u; bestW = w; }
    }
    const arr = buckets.get(bestW);
    if (arr) arr.push(t); else buckets.set(bestW, [t]);
  }
  const partition: NestGruppe[] = [];
  for (const w of widths) {
    const g = buckets.get(w);
    if (g && g.length) partition.push({ folienbreite: w, teile: g, result: pack(g, w, opt) });
  }

  // "Mitdenken": compare the split against putting everything on each single
  // width, and keep the layout with the least total foil AREA (the fair
  // material metric across different widths). Splitting only wins when it
  // genuinely saves material; on a tie the single (narrower) width is kept, so
  // we never split for nothing.
  const area = (gs: NestGruppe[]) => gs.reduce((s, g) => s + g.result.flaecheM2, 0);
  const candidates: NestGruppe[][] = widths.map((w) => [{ folienbreite: w, teile, result: pack(teile, w, opt) }]);
  if (partition.length > 1) candidates.push(partition);

  let best = candidates[0];
  for (const c of candidates) if (area(c) < area(best) - 1e-9) best = c;
  return best;
}
