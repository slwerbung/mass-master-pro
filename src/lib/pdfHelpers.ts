/**
 * PDF layout helpers – A4 Hochformat (portrait), modernes karten-basiertes
 * Layout im Stil der App. Eine Standortseite besteht aus einer Akzent-Kopf-
 * leiste, einer Medien-Karte (Produktionsdatei als Hauptbild + Foto als
 * Thumbnail – genau wie in der Kunden-/Mitarbeiteransicht) und einer
 * Detail-Karte mit den Feldwerten.
 *
 * Nur Export.tsx nutzt diese Helfer.
 */
import jsPDF from "jspdf";

// ─── Seitenmaße (A4 Hochformat in mm) ────────────────────────────────────────
export const PAGE_W = 210;
export const PAGE_H = 297;
export const MARGIN = 14;
export const CONTENT_W = PAGE_W - 2 * MARGIN;
export const HEADER_H = 20; // Höhe der Akzent-Kopfleiste
const FOOTER_Y = PAGE_H - 13;

// ─── Design-Tokens (entsprechen der App) ──────────────────────────────────────
type RGB = { r: number; g: number; b: number };
export const BRAND: RGB = { r: 14, g: 115, b: 232 };   // #0E73E8 (--primary)
const BRAND_DK: RGB = { r: 8, g: 80, b: 180 };
const INK: RGB = { r: 15, g: 23, b: 42 };              // slate-900
const MUTED: RGB = { r: 100, g: 116, b: 139 };         // slate-500
const BORDER: RGB = { r: 226, g: 232, b: 240 };        // slate-200
const SURFACE: RGB = { r: 248, g: 250, b: 252 };       // slate-50
const WHITE: RGB = { r: 255, g: 255, b: 255 };
const BRAND_SOFT: RGB = { r: 191, g: 219, b: 254 };    // blue-200 (on brand)
const GREEN: RGB = { r: 22, g: 163, b: 74 };
const AMBER: RGB = { r: 217, g: 119, b: 6 };

// ─── Low-level Helfer ─────────────────────────────────────────────────────────

export const getImageDimensions = (dataURI: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve({ width: 800, height: 600 });
    img.src = dataURI;
  });

function imgFormat(dataUri: string): "JPEG" | "PNG" | "WEBP" {
  if (dataUri.startsWith("data:image/jpeg") || dataUri.startsWith("data:image/jpg")) return "JPEG";
  if (dataUri.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
}

const fill = (pdf: jsPDF, c: RGB) => pdf.setFillColor(c.r, c.g, c.b);
const stroke = (pdf: jsPDF, c: RGB) => pdf.setDrawColor(c.r, c.g, c.b);
const ink = (pdf: jsPDF, c: RGB) => pdf.setTextColor(c.r, c.g, c.b);

function trunc(pdf: jsPDF, text: string, maxMm: number): string {
  if (pdf.getTextWidth(text) <= maxMm) return text;
  let t = text;
  while (t.length > 1 && pdf.getTextWidth(t + "…") > maxMm) t = t.slice(0, -1);
  return t + "…";
}

/** Karte mit abgerundeten Ecken (Fläche + optionaler Rand). */
function card(pdf: jsPDF, x: number, y: number, w: number, h: number, opts?: { fill?: RGB; border?: RGB; r?: number }) {
  const r = opts?.r ?? 3;
  if (opts?.fill) fill(pdf, opts.fill);
  if (opts?.border) { stroke(pdf, opts.border); pdf.setLineWidth(0.3); }
  const style = opts?.fill && opts?.border ? "FD" : opts?.fill ? "F" : "S";
  pdf.roundedRect(x, y, w, h, r, r, style);
}

/** Bild proportional (object-contain) in eine Box; gibt das platzierte Rechteck zurück. */
export async function placeImageContain(
  pdf: jsPDF, dataUri: string, x: number, y: number, w: number, h: number,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const dims = await getImageDimensions(dataUri);
  const ratio = Math.min(w / dims.width, h / dims.height);
  const iw = dims.width * ratio;
  const ih = dims.height * ratio;
  const ix = x + (w - iw) / 2;
  const iy = y + (h - ih) / 2;
  try { pdf.addImage(dataUri, imgFormat(dataUri), ix, iy, iw, ih); } catch { /* ignore */ }
  return { x: ix, y: iy, w: iw, h: ih };
}

function drawLogoInBox(pdf: jsPDF, logoDataUri: string, x: number, y: number, maxW: number, maxH: number) {
  try {
    const fmt = logoDataUri.startsWith("data:image/png") ? "PNG"
      : logoDataUri.startsWith("data:image/svg") ? "PNG" : "JPEG";
    const props = pdf.getImageProperties(logoDataUri);
    const ratio = Math.min(maxW / props.width, maxH / props.height);
    const lw = props.width * ratio;
    const lh = props.height * ratio;
    pdf.addImage(logoDataUri, fmt, x + (maxW - lw) / 2, y + (maxH - lh) / 2, lw, lh);
  } catch { /* still fail */ }
}

/** Kleines Pill/Chip. Gibt die Breite zurück. */
function chip(
  pdf: jsPDF, x: number, y: number, text: string,
  o: { bg: RGB; fg: RGB; dot?: RGB; border?: RGB; size?: number },
): number {
  const size = o.size ?? 7.5;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(size);
  const tw = pdf.getTextWidth(text);
  const h = size * 0.34 + 3.4;
  const padX = 2.6;
  const dotW = o.dot ? 3.2 : 0;
  const w = padX * 2 + dotW + tw;
  fill(pdf, o.bg);
  if (o.border) { stroke(pdf, o.border); pdf.setLineWidth(0.3); pdf.roundedRect(x, y, w, h, h / 2, h / 2, "FD"); }
  else pdf.roundedRect(x, y, w, h, h / 2, h / 2, "F");
  let tx = x + padX;
  if (o.dot) { fill(pdf, o.dot); pdf.circle(x + padX + 1.1, y + h / 2, 1.1, "F"); tx += dotW; }
  ink(pdf, o.fg);
  pdf.text(text, tx, y + h / 2 + size * 0.16 + 0.4);
  return w;
}

export type PillKind = "approved" | "correction" | "open" | "info";
function pillColors(kind: PillKind): { fg: RGB; dot: RGB; label: string } {
  switch (kind) {
    case "approved": return { fg: GREEN, dot: GREEN, label: "Freigegeben" };
    case "correction": return { fg: AMBER, dot: AMBER, label: "Korrektur" };
    case "info": return { fg: BRAND, dot: BRAND, label: "" };
    default: return { fg: MUTED, dot: MUTED, label: "Offen" };
  }
}

// ─── Kopfleiste & Fußzeile ──────────────────────────────────────────────────--

export function drawHeaderBand(
  pdf: jsPDF, opts: { title: string; sub?: string; pill?: { kind: PillKind; label?: string } },
) {
  fill(pdf, BRAND);
  pdf.rect(0, 0, PAGE_W, HEADER_H, "F");
  fill(pdf, BRAND_DK);
  pdf.rect(0, 0, PAGE_W, 1.8, "F");

  ink(pdf, WHITE);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(trunc(pdf, opts.title, CONTENT_W - 45), MARGIN, opts.sub ? 9.5 : 12);
  if (opts.sub) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    ink(pdf, BRAND_SOFT);
    pdf.text(trunc(pdf, opts.sub, CONTENT_W - 45), MARGIN, 14.5);
  }

  if (opts.pill) {
    const pc = pillColors(opts.pill.kind);
    const label = opts.pill.label || pc.label;
    if (label) {
      // rechtsbündig: Breite vorab messen
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      const tw = pdf.getTextWidth(label);
      const w = 2.6 * 2 + 3.2 + tw;
      chip(pdf, PAGE_W - MARGIN - w, HEADER_H / 2 - 3, label, { bg: WHITE, fg: pc.fg, dot: pc.dot });
    }
  }
  ink(pdf, INK);
}

function drawFooter(pdf: jsPDF, opts: { left?: string; pageNumber?: number }) {
  stroke(pdf, BORDER);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, FOOTER_Y, PAGE_W - MARGIN, FOOTER_Y);
  ink(pdf, MUTED);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  const left = opts.left ? `${opts.left}  ·  ` : "";
  pdf.text(`${left}Erstellt mit Captfix`, MARGIN, FOOTER_Y + 5);
  if (opts.pageNumber) pdf.text(`Seite ${opts.pageNumber}`, PAGE_W - MARGIN, FOOTER_Y + 5, { align: "right" });
}

// ─── Feld-Raster ───────────────────────────────────────────────────────────--

export interface FieldRow { label: string; value: string; full?: boolean }

function drawFieldGrid(pdf: jsPDF, x: number, y: number, w: number, rows: FieldRow[]) {
  const colGap = 8;
  const colW = (w - colGap) / 2;
  const lineH = 4.3;
  const gap = 3.4;
  let leftY = y, rightY = y;

  const entry = (ex: number, ey: number, ew: number, row: FieldRow): number => {
    ink(pdf, MUTED);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.text(row.label.toUpperCase(), ex, ey);
    ink(pdf, INK);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    const maxLines = row.full ? 4 : 2;
    const lines = (pdf.splitTextToSize(row.value || "–", ew) as string[]).slice(0, maxLines);
    pdf.text(lines, ex, ey + 4.1);
    return 4.1 + lines.length * lineH + gap;
  };

  for (const row of rows) {
    if (row.full) {
      const y0 = Math.max(leftY, rightY);
      const h = entry(x, y0, w, row);
      leftY = rightY = y0 + h;
    } else if (leftY <= rightY) {
      leftY += entry(x, leftY, colW, row);
    } else {
      rightY += entry(x + colW + colGap, rightY, colW, row);
    }
  }
}

// ─── Deckblatt ───────────────────────────────────────────────────────────────

export async function drawCoverPage(pdf: jsPDF, opts: {
  logoDataUri?: string | null;
  title: string;
  subtitle?: string;
  projectNumber: string;
  customerName?: string;
  dateStr: string;
  locationCount: number;
  floorPlanCount?: number;
  locations: { number: string; name?: string; pageLink?: number }[];
}) {
  const blockH = 104;
  fill(pdf, BRAND);
  pdf.rect(0, 0, PAGE_W, blockH, "F");
  fill(pdf, BRAND_DK);
  pdf.rect(0, 0, PAGE_W, 2.2, "F");

  // Logo in weißem Chip oben rechts
  if (opts.logoDataUri) {
    const lw = 48, lh = 24;
    fill(pdf, WHITE);
    pdf.roundedRect(PAGE_W - MARGIN - lw, MARGIN + 2, lw, lh, 3, 3, "F");
    drawLogoInBox(pdf, opts.logoDataUri, PAGE_W - MARGIN - lw + 3, MARGIN + 5, lw - 6, lh - 6);
  }

  ink(pdf, BRAND_SOFT);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("CAPTFIX · AUFMASS", MARGIN, MARGIN + 12);

  ink(pdf, WHITE);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(28);
  pdf.text(opts.title, MARGIN, MARGIN + 28);
  if (opts.subtitle) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(12);
    ink(pdf, BRAND_SOFT);
    pdf.text(opts.subtitle, MARGIN, MARGIN + 38);
  }

  // Schwebende Info-Karte über die Blockkante hinaus
  const cardY = blockH - 16;
  const cardH = 60;
  card(pdf, MARGIN, cardY, CONTENT_W, cardH, { fill: WHITE, border: BORDER, r: 4 });
  fill(pdf, BRAND);
  pdf.roundedRect(MARGIN, cardY, 3, cardH, 1.5, 1.5, "F");

  const meta: [string, string][] = [
    ["Projektnummer", opts.projectNumber],
    ["Kunde", opts.customerName || "—"],
    ["Datum", opts.dateStr],
    ["Standorte", opts.floorPlanCount
      ? `${opts.locationCount} · ${opts.floorPlanCount} Grundriss(e)`
      : String(opts.locationCount)],
  ];
  const mcolW = (CONTENT_W - 16) / 2;
  meta.forEach(([label, value], i) => {
    const mx = MARGIN + 10 + (i % 2) * mcolW;
    const myy = cardY + 14 + Math.floor(i / 2) * 26;
    ink(pdf, MUTED);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.text(label.toUpperCase(), mx, myy);
    ink(pdf, INK);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(13);
    pdf.text(trunc(pdf, value, mcolW - 6), mx, myy + 7);
  });

  // Standort-Übersicht
  if (opts.locations.length > 0) {
    let oy = cardY + cardH + 16;
    ink(pdf, INK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text("Übersicht Standorte", MARGIN, oy);
    oy += 8;

    const colCount = 2;
    const colGap = 10;
    const colW = (CONTENT_W - colGap) / 2;
    const rowH = 7;
    const maxRows = Math.floor((FOOTER_Y - 6 - oy) / rowH);
    const capacity = maxRows * colCount;
    const show = opts.locations.slice(0, capacity);

    show.forEach((loc, i) => {
      const col = Math.floor(i / maxRows);
      const r = i % maxRows;
      const x = MARGIN + col * (colW + colGap);
      const yy = oy + r * rowH;
      card(pdf, x, yy - 4.4, colW, 6, { fill: SURFACE, r: 2 });
      ink(pdf, BRAND);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      const num = loc.number || "–";
      pdf.text(num, x + 3, yy);
      const numW = pdf.getTextWidth(num) + 4;
      ink(pdf, INK);
      pdf.setFont("helvetica", "normal");
      if (loc.name) pdf.text(trunc(pdf, loc.name, colW - numW - 5), x + 3 + numW, yy);
      // klickbarer Sprung zur Standortseite (gesamte Zeile)
      if (loc.pageLink) pdf.link(x, yy - 4.4, colW, 6, { pageNumber: loc.pageLink });
    });

    if (opts.locations.length > show.length) {
      ink(pdf, MUTED);
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(8.5);
      pdf.text(`… und ${opts.locations.length - show.length} weitere`, MARGIN, oy + maxRows * rowH + 2);
    }
  }

  drawFooter(pdf, {});
  ink(pdf, MUTED);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.text(opts.dateStr, PAGE_W - MARGIN, FOOTER_Y + 5, { align: "right" });
}

// ─── Standortseite ────────────────────────────────────────────────────────────

export async function drawLocationPage(pdf: jsPDF, opts: {
  number: string;
  name?: string;
  projectNumber: string;
  pill?: { kind: PillKind; label?: string };
  mainImage?: string;
  mainLabel: string;
  thumbImage?: string;
  thumbLabel?: string;
  fields: FieldRow[];
  pageNumber: number;
  companyName?: string;
}) {
  drawHeaderBand(pdf, {
    title: `Standort ${opts.number}`,
    sub: opts.name ? `${opts.name}  ·  Projekt ${opts.projectNumber}` : `Projekt ${opts.projectNumber}`,
    pill: opts.pill,
  });

  const top = HEADER_H + 7;
  const mediaH = 148;
  card(pdf, MARGIN, top, CONTENT_W, mediaH, { fill: SURFACE, border: BORDER, r: 4 });
  const pad = 5;
  if (opts.mainImage) {
    await placeImageContain(pdf, opts.mainImage, MARGIN + pad, top + pad, CONTENT_W - 2 * pad, mediaH - 2 * pad);
  } else {
    ink(pdf, MUTED);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.text("Kein Bild vorhanden", PAGE_W / 2, top + mediaH / 2, { align: "center" });
  }

  // Label-Chip oben links
  chip(pdf, MARGIN + pad + 1.5, top + pad + 1.5, trunc(pdf, opts.mainLabel, 80),
    { bg: WHITE, fg: BRAND, dot: BRAND, border: BORDER });

  // Foto-Thumbnail unten rechts (wenn Produktionsdatei das Hauptbild ist)
  if (opts.thumbImage) {
    const tw = 40, th = 40;
    const tx = MARGIN + CONTENT_W - pad - tw;
    const ty = top + mediaH - pad - th;
    fill(pdf, WHITE);
    stroke(pdf, BORDER);
    pdf.setLineWidth(0.5);
    pdf.roundedRect(tx - 1.5, ty - 1.5, tw + 3, th + 3, 2.5, 2.5, "FD");
    await placeImageContain(pdf, opts.thumbImage, tx, ty, tw, th);
    if (opts.thumbLabel) {
      chip(pdf, tx, ty - 0.5, opts.thumbLabel, { bg: WHITE, fg: INK, border: BORDER, size: 6.5 });
    }
  }

  // Detail-Karte mit Feldwerten
  const fy = top + mediaH + 6;
  const fh = FOOTER_Y - 4 - fy;
  card(pdf, MARGIN, fy, CONTENT_W, fh, { fill: WHITE, border: BORDER, r: 4 });
  ink(pdf, MUTED);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("DETAILS", MARGIN + 7, fy + 8.5);
  stroke(pdf, BORDER);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN + 7, fy + 11, PAGE_W - MARGIN - 7, fy + 11);
  drawFieldGrid(pdf, MARGIN + 7, fy + 18, CONTENT_W - 14, opts.fields);

  drawFooter(pdf, { left: opts.companyName, pageNumber: opts.pageNumber });
}

// ─── Voll-Medienseite (zusätzliche Produktionsseiten) ──────────────────────────

export async function drawMediaPage(pdf: jsPDF, opts: {
  title: string;
  sub?: string;
  image: string;
  label?: string;
  pageNumber: number;
  companyName?: string;
}) {
  drawHeaderBand(pdf, { title: opts.title, sub: opts.sub });
  const top = HEADER_H + 7;
  const h = FOOTER_Y - 4 - top;
  card(pdf, MARGIN, top, CONTENT_W, h, { fill: SURFACE, border: BORDER, r: 4 });
  await placeImageContain(pdf, opts.image, MARGIN + 5, top + 5, CONTENT_W - 10, h - 10);
  if (opts.label) {
    chip(pdf, MARGIN + 6.5, top + 6.5, trunc(pdf, opts.label, 100), { bg: WHITE, fg: BRAND, dot: BRAND, border: BORDER });
  }
  drawFooter(pdf, { left: opts.companyName, pageNumber: opts.pageNumber });
}

// ─── Grundrissseite (mit klickbaren Markern) ──────────────────────────────────

export async function drawFloorPlanPage(pdf: jsPDF, opts: {
  name: string;
  projectNumber: string;
  image: string;
  markers: { x: number; y: number; short: string; pageLink?: number }[];
  pageNumber: number;
  companyName?: string;
}) {
  drawHeaderBand(pdf, { title: "Grundriss", sub: `${opts.name}  ·  Projekt ${opts.projectNumber}` });
  const top = HEADER_H + 7;
  const h = FOOTER_Y - 4 - top;
  card(pdf, MARGIN, top, CONTENT_W, h, { fill: SURFACE, border: BORDER, r: 4 });
  const placed = await placeImageContain(pdf, opts.image, MARGIN + 5, top + 5, CONTENT_W - 10, h - 10);

  for (const m of opts.markers) {
    const mx = placed.x + m.x * placed.w;
    const my = placed.y + m.y * placed.h;
    if (m.pageLink) pdf.link(mx - 4, my - 4, 8, 8, { pageNumber: m.pageLink });
    fill(pdf, WHITE);
    pdf.circle(mx, my, 3.4, "F");
    fill(pdf, BRAND);
    pdf.circle(mx, my, 2.8, "F");
    ink(pdf, WHITE);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6);
    pdf.text(m.short, mx, my + 0.9, { align: "center" });
  }
  drawFooter(pdf, { left: opts.companyName, pageNumber: opts.pageNumber });
}

// ─── Detailbild-Seite ─────────────────────────────────────────────────────────

export async function drawDetailPage(pdf: jsPDF, opts: {
  number: string;
  name?: string;
  projectNumber: string;
  images: { src: string; caption?: string }[];
  pageNumber: number;
  companyName?: string;
}) {
  drawHeaderBand(pdf, {
    title: `Detailbilder · Standort ${opts.number}`,
    sub: opts.name ? `${opts.name}  ·  Projekt ${opts.projectNumber}` : `Projekt ${opts.projectNumber}`,
  });
  const top = HEADER_H + 7;
  const colGap = 6;
  const cellW = (CONTENT_W - colGap) / 2;
  const cellH = 78;
  let i = 0;
  for (const img of opts.images.slice(0, 6)) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * (cellW + colGap);
    const y = top + row * (cellH + colGap);
    card(pdf, x, y, cellW, cellH, { fill: SURFACE, border: BORDER, r: 3 });
    await placeImageContain(pdf, img.src, x + 3, y + 3, cellW - 6, cellH - (img.caption ? 11 : 6));
    if (img.caption) {
      ink(pdf, MUTED);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.text(trunc(pdf, img.caption, cellW - 8), x + 4, y + cellH - 3.5);
    }
    i++;
  }
  drawFooter(pdf, { left: opts.companyName, pageNumber: opts.pageNumber });
}
