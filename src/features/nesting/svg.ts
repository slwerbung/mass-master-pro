// SVG generation in millimetres so CorelDRAW imports 1:1 to scale.
// Y conversion: the algorithm uses Y-up-negative; SVG uses Y-down. teil.y is
// the top edge (<= 0), first row at y = 0, so a single column would use sy = -teil.y.
//
// Column wrapping: a project with many areas produces one very long column,
// which CorelDRAW squeezes onto a page. To avoid that, rows are grouped into
// columns of at most maxLaengeMm and the columns are laid out side by side
// (each still one foil width). Rows are never split across columns.

import type { NestingOptions, PackResult, PlatziertesTeil } from "./types";

/** Round to 3 decimals, always "." as separator, deterministic. */
function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Group id from a label: CorelDRAW uses it as the object name. Keep it close
 *  to the label but as a valid XML name (no spaces, no leading digit/dot). */
function idFor(label: string): string {
  let s = String(label).replace(/[^A-Za-z0-9_.-]/g, "_");
  if (!s) s = "Flaeche";
  if (/^[0-9.\-]/.test(s)) s = "F" + s;
  return s;
}

interface Reihe { teile: PlatziertesTeil[]; height: number; }
interface Placed { t: PlatziertesTeil; drawX: number; drawTop: number; }

export interface NestLayout {
  placed: Placed[];
  numCols: number;
  canvasBreite: number;
  spaltenLaengenMm: number[]; // content height of each column
}

/** Rebuild rows from placed parts (all parts in a row share the same y). */
function baueReihen(teile: PlatziertesTeil[]): Reihe[] {
  const map = new Map<number, PlatziertesTeil[]>();
  for (const t of teile) {
    const key = Math.round(t.y * 1000);
    const arr = map.get(key);
    if (arr) arr.push(t); else map.set(key, [t]);
  }
  // Top to bottom: y descending (0, then more negative).
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, ts]) => ({ teile: ts, height: Math.max(...ts.map((t) => t.pHoehe)) }));
}

/** Groups rows into side-by-side columns of at most maxLaengeMm (rows kept whole). */
export function computeLayout(result: PackResult, opt: NestingOptions): NestLayout {
  const { folienbreite, teile } = result;
  const { reihenAbstand, spaltenAbstand } = opt;
  const maxLen = opt.maxLaengeMm && opt.maxLaengeMm > 0 ? opt.maxLaengeMm : Infinity;

  const rows = baueReihen(teile);
  const placed: Placed[] = [];
  const spaltenLaengenMm: number[] = [];
  let col = 0;
  let colHeight = 0; // current column's used height (top of next row = colHeight + reihenAbstand)
  for (const row of rows) {
    if (colHeight > 0 && colHeight + reihenAbstand + row.height > maxLen + 1e-6) {
      spaltenLaengenMm[col] = colHeight;
      col++;
      colHeight = 0;
    }
    const rowTop = colHeight === 0 ? 0 : colHeight + reihenAbstand;
    const xOffset = col * (folienbreite + spaltenAbstand);
    for (const t of row.teile) placed.push({ t, drawX: t.x + xOffset, drawTop: rowTop });
    colHeight = rowTop + row.height;
  }
  spaltenLaengenMm[col] = colHeight;
  const numCols = col + 1;
  const canvasBreite = numCols * folienbreite + (numCols - 1) * spaltenAbstand;
  return { placed, numCols, canvasBreite, spaltenLaengenMm };
}

export function buildSvg(result: PackResult, opt: NestingOptions): string {
  const { rand, textAbstand, schriftgroesse, projektnummer } = opt;
  const { placed, canvasBreite } = computeLayout(result, opt);

  // One group per area: the cut rectangle + its label belong together, so in
  // CorelDRAW each Fläche can be selected/moved as a unit and is named by its
  // Bezeichnung. Oversized (split-off) parts stay red.
  let maxLabelBottom = 0;
  const pieceGroups: string[] = [];
  const usedIds = new Set<string>();
  for (const p of placed) {
    const sx = p.drawX;
    const sy = p.drawTop;
    const labelY = sy + p.t.pHoehe + textAbstand;
    maxLabelBottom = Math.max(maxLabelBottom, labelY + schriftgroesse * 0.3);
    const stroke = p.t.zuGross ? "#e00000" : "#000000";
    let id = idFor(p.t.label);
    while (usedIds.has(id)) id += "_";
    usedIds.add(id);
    pieceGroups.push(
      `  <g id="${id}">\n` +
      `    <title>${escapeXml(p.t.label)}</title>\n` +
      `    <rect x="${fmt(sx)}" y="${fmt(sy)}" width="${fmt(p.t.pBreite)}" height="${fmt(p.t.pHoehe)}" fill="none" stroke="${stroke}" stroke-width="0.25"/>\n` +
      `    <text x="${fmt(sx)}" y="${fmt(labelY)}" font-family="Arial" font-size="${fmt(schriftgroesse)}" fill="#000000">${escapeXml(p.t.label)}</text>\n` +
      `  </g>`,
    );
  }

  const hasProjekt = !!(projektnummer && projektnummer.trim());
  const gesamtHoeheMm = maxLabelBottom + (hasProjekt ? 22 : 6);
  const projektY = gesamtHoeheMm - 6;

  const projektGroup = hasProjekt
    ? `  <g id="projekt">\n` +
      `    <text x="${fmt(canvasBreite - rand)}" y="${fmt(projektY)}" text-anchor="end" font-family="Arial" font-size="14" fill="#000000">${escapeXml(projektnummer!.trim())}</text>\n` +
      `  </g>\n`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(canvasBreite)}mm" height="${fmt(gesamtHoeheMm)}mm" viewBox="0 0 ${fmt(canvasBreite)} ${fmt(gesamtHoeheMm)}">
${pieceGroups.join("\n")}
${projektGroup}</svg>
`;
}
