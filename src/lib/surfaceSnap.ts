// Semi-automatic surface snapping (prototype).
//
// Idea: the user taps INSIDE a rectangular surface (a shop window, a panel).
// We cast rays outward to the nearest strong edges to get a rough box, then
// refine each of the four sides into a straight line (sampling the edge at many
// points and robustly fitting a line) so the result follows the photo's
// perspective. The four line intersections are the snapped quad corners.
//
// Pure JS / Canvas, no dependencies, runs offline. This is deliberately a
// classic-CV approach (fast, explainable) to evaluate how well edge-snap works
// on real job photos before investing in anything heavier.

export interface Pt { x: number; y: number }
export interface Prepared {
  w: number;
  h: number;
  gx: Float32Array; // horizontal gradient (marks vertical edges)
  gy: Float32Array; // vertical gradient (marks horizontal edges)
  mag: Float32Array;
  meanMag: number;
}
export interface SnapOptions {
  /** Edge strength threshold; if omitted, derived from the image. */
  threshold?: number;
  /** Perpendicular search half-window when refining a side (px). */
  refineWindow?: number;
}
export interface SnapResult {
  corners: [Pt, Pt, Pt, Pt]; // TL, TR, BR, BL
  approx: boolean;           // true => only the axis-aligned fallback box
}

/** Grayscale + Sobel gradients. Compute once per image, reuse for every tap. */
export function prepare(img: ImageData): Prepared {
  const { width: w, height: h, data } = img;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    // Rec. 601 luma.
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = gray[i - w - 1], b = gray[i - w], c = gray[i - w + 1];
      const d = gray[i - 1], f = gray[i + 1];
      const g = gray[i + w - 1], hh = gray[i + w], k = gray[i + w + 1];
      const sx = (c + 2 * f + k) - (a + 2 * d + g);
      const sy = (g + 2 * hh + k) - (a + 2 * b + c);
      gx[i] = sx;
      gy[i] = sy;
      const m = Math.abs(sx) + Math.abs(sy);
      mag[i] = m;
      sum += m;
    }
  }
  return { w, h, gx, gy, mag, meanMag: sum / (w * h) };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Scan from (sx,sy) stepping by (dx,dy); return the distance to the nearest
 *  strong edge of the requested orientation, or -1. `vertical` picks |gx|
 *  (vertical edges) vs |gy| (horizontal edges). */
function scan(p: Prepared, sx: number, sy: number, dx: number, dy: number, vertical: boolean, T: number): number {
  const { w, h } = p;
  const grad = vertical ? p.gx : p.gy;
  const minDist = 6;
  let x = sx, y = sy, dist = 0;
  let best = -1;
  while (true) {
    x += dx; y += dy; dist++;
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) break;
    const i = (y | 0) * w + (x | 0);
    const s = Math.abs(grad[i]);
    if (dist >= minDist && s > T) {
      // Walk to the local ridge maximum a couple of px further.
      best = dist;
      break;
    }
  }
  return best;
}

/** Robustly fit a line to sampled edge points.
 *  mode "v": x = a*y + b (near-vertical). mode "h": y = a*x + b (near-horizontal). */
function fitLine(pts: Pt[], mode: "v" | "h"): { a: number; b: number } | null {
  if (pts.length < 4) return null;
  const xs = pts.map((p) => (mode === "v" ? p.y : p.x));
  const ys = pts.map((p) => (mode === "v" ? p.x : p.y));
  const fit = (idx: number[]) => {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const i of idx) { const X = xs[i], Y = ys[i]; n++; sx += X; sy += Y; sxx += X * X; sxy += X * Y; }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-6) return null;
    const a = (n * sxy - sx * sy) / denom;
    const b = (sy - a * sx) / n;
    return { a, b };
  };
  let idx = pts.map((_, i) => i);
  let line = fit(idx);
  if (!line) return null;
  // One reweighting pass: drop points more than 3px off the line.
  const keep: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(ys[i] - (line.a * xs[i] + line.b)) <= 3) keep.push(i);
  }
  if (keep.length >= 4) { const l2 = fit(keep); if (l2) line = l2; }
  return line;
}

/** Refine one side into a line by searching for the strongest edge near an
 *  initial guess across many samples along the side. */
function refineSide(
  p: Prepared, T: number, win: number,
  vertical: boolean, guess: number, from: number, to: number,
): { a: number; b: number } | null {
  const { w, h } = p;
  const grad = vertical ? p.gx : p.gy;
  const pts: Pt[] = [];
  const N = 24;
  for (let s = 0; s <= N; s++) {
    const along = from + ((to - from) * s) / N; // y for vertical side, x for horizontal
    let bestMag = T, bestAt = -1;
    for (let d = -win; d <= win; d++) {
      const perp = guess + d;
      const x = vertical ? perp : along;
      const y = vertical ? along : perp;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const m = Math.abs(grad[(y | 0) * w + (x | 0)]);
      if (m > bestMag) { bestMag = m; bestAt = perp; }
    }
    if (bestAt >= 0) pts.push(vertical ? { x: bestAt, y: along } : { x: along, y: bestAt });
  }
  return fitLine(pts, vertical ? "v" : "h");
}

function intersect(vLine: { a: number; b: number }, hLine: { a: number; b: number }): Pt {
  // vertical: x = a*y + b ; horizontal: y = a*x + b
  const y = (hLine.a * vLine.b + hLine.b) / (1 - hLine.a * vLine.a);
  const x = vLine.a * y + vLine.b;
  return { x, y };
}

export function detect(p: Prepared, tap: Pt, opts: SnapOptions = {}): SnapResult | null {
  const { w, h } = p;
  const T = opts.threshold ?? clamp(p.meanMag * 3.0, 24, 160);
  const win = opts.refineWindow ?? Math.round(Math.min(w, h) * 0.05);
  const tx = clamp(tap.x, 1, w - 2);
  const ty = clamp(tap.y, 1, h - 2);

  // 1) Rays to the nearest strong edges → rough axis-aligned box.
  const dl = scan(p, tx, ty, -1, 0, true, T);
  const dr = scan(p, tx, ty, +1, 0, true, T);
  const dtp = scan(p, tx, ty, 0, -1, false, T);
  const db = scan(p, tx, ty, 0, +1, false, T);
  if (dl < 0 || dr < 0 || dtp < 0 || db < 0) return null;

  const xL = tx - dl, xR = tx + dr, yT = ty - dtp, yB = ty + db;
  if (xR - xL < 12 || yB - yT < 12) return null;

  const boxCorners: [Pt, Pt, Pt, Pt] = [
    { x: xL, y: yT }, { x: xR, y: yT }, { x: xR, y: yB }, { x: xL, y: yB },
  ];

  // 2) Refine each side into a line (handles perspective/tilt).
  const padY = (yB - yT) * 0.12, padX = (xR - xL) * 0.12;
  const left = refineSide(p, T, win, true, xL, yT + padY, yB - padY);
  const right = refineSide(p, T, win, true, xR, yT + padY, yB - padY);
  const top = refineSide(p, T, win, false, yT, xL + padX, xR - padX);
  const bottom = refineSide(p, T, win, false, yB, xL + padX, xR - padX);

  if (!left || !right || !top || !bottom) return { corners: boxCorners, approx: true };

  const TL = intersect(left, top);
  const TR = intersect(right, top);
  const BR = intersect(right, bottom);
  const BL = intersect(left, bottom);
  const corners: [Pt, Pt, Pt, Pt] = [TL, TR, BR, BL];

  // 3) Sanity: finite, inside a small margin, sensible area & convexity.
  const m = 40;
  const ok = corners.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)
    && c.x > -m && c.y > -m && c.x < w + m && c.y < h + m);
  if (!ok) return { corners: boxCorners, approx: true };

  const area = polyArea(corners);
  const imgArea = w * h;
  if (area < imgArea * 0.005 || area > imgArea * 0.98 || !isConvex(corners)) {
    return { corners: boxCorners, approx: true };
  }
  return { corners, approx: false };
}

function polyArea(c: Pt[]): number {
  let a = 0;
  for (let i = 0; i < c.length; i++) {
    const j = (i + 1) % c.length;
    a += c[i].x * c[j].y - c[j].x * c[i].y;
  }
  return Math.abs(a) / 2;
}

function isConvex(c: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length], d = c[(i + 2) % c.length];
    const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (Math.abs(cross) < 1e-3) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}
