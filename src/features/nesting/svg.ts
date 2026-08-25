// SVG generation in millimetres so CorelDRAW imports 1:1 to scale.
// Y conversion: the algorithm uses Y-up-negative; SVG uses Y-down. teil.y is
// the top edge (<= 0), first row at y = 0, so in SVG: sy = -teil.y.

import type { NestingOptions, PackResult } from "./types";

/** Round to 3 decimals, always "." as separator, deterministic. */
function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildSvg(result: PackResult, opt: NestingOptions): string {
  const { folienbreite, teile } = result;
  const { rand, textAbstand, schriftgroesse, projektnummer } = opt;

  let maxLabelBottom = 0;
  const rects: string[] = [];
  const labels: string[] = [];

  for (const t of teile) {
    const sx = t.x;
    const sy = -t.y;                                 // top edge in SVG
    const labelY = sy + t.pHoehe + textAbstand;      // label below the part
    maxLabelBottom = Math.max(maxLabelBottom, labelY + schriftgroesse * 0.3);
    // Oversized parts (do not fit the foil width even rotated) are outlined red.
    const strokeAttr = t.zuGross ? ' stroke="#e00000"' : "";
    rects.push(
      `    <rect x="${fmt(sx)}" y="${fmt(sy)}" width="${fmt(t.pBreite)}" height="${fmt(t.pHoehe)}"${strokeAttr}/>`,
    );
    // Beschriftung: ONLY the area label (no measure), so it can be toggled in Corel.
    labels.push(`    <text x="${fmt(sx)}" y="${fmt(labelY)}">${escapeXml(t.label)}</text>`);
  }

  const hasProjekt = !!(projektnummer && projektnummer.trim());
  // Canvas height = content + room for the lowest label line + a project line.
  const gesamtHoeheMm = maxLabelBottom + (hasProjekt ? 22 : 6);
  const projektY = gesamtHoeheMm - 6;

  const projektGroup = hasProjekt
    ? `  <g id="projekt" font-family="Arial" font-size="14" fill="#000000">\n` +
      `    <text x="${fmt(folienbreite - rand)}" y="${fmt(projektY)}" text-anchor="end">${escapeXml(projektnummer!.trim())}</text>\n` +
      `  </g>\n`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(folienbreite)}mm" height="${fmt(gesamtHoeheMm)}mm" viewBox="0 0 ${fmt(folienbreite)} ${fmt(gesamtHoeheMm)}">
  <g id="schnitt" fill="none" stroke="#000000" stroke-width="0.25">
${rects.join("\n")}
  </g>
  <g id="beschriftung" font-family="Arial" font-size="${fmt(schriftgroesse)}" fill="#000000">
${labels.join("\n")}
  </g>
${projektGroup}</svg>
`;
}
