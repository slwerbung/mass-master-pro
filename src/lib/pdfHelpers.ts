/**
 * PDF layout helpers – A4 Querformat
 * Layout: Foto füllt oberen Bereich, 3-spaltiger Footer mit Projektinfos + Logo
 */
import jsPDF from "jspdf";

// ─── Design-Tokens ────────────────────────────────────────────────────────────
export const PINK        = { r: 230, g: 0,   b: 126 }; // #E6007E
export const DARK        = { r: 26,  g: 26,  b: 26  }; // #1A1A1A
export const TEXT_MUTED  = { r: 100, g: 100, b: 100 };
export const BLUE        = { r: 37,  g: 99,  b: 235 }; // für Grundriss-Links
export const BORDER_GRAY = { r: 200, g: 200, b: 200 };
// App-Akzentfarbe (entspricht --primary der App, #0E73E8)
export const BRAND       = { r: 14,  g: 115, b: 232 };
export const BRAND_DARK  = { r: 8,   g: 80,  b: 180 };
export const SURFACE     = { r: 244, g: 247, b: 251 }; // dezenter Karten-Hintergrund
export const WHITE       = { r: 255, g: 255, b: 255 };

// Höhe der Akzent-Kopfleiste auf Standort-/Grundrissseiten (mm)
export const HEADER_BAND_H = 11;

// ─── Seitenmaße (A4 Querformat in mm) ────────────────────────────────────────
export const PAGE_W   = 297;
export const PAGE_H   = 210;
export const MARGIN   = 8;
export const FOOTER_H = 30;   // Höhe des Footer-Bereichs
export const LOGO_W   = 18;   // Logo-Breite im Footer
export const LOGO_GAP = 4;

// Spaltenbreiten
const COL_TOTAL = PAGE_W - 2 * MARGIN - LOGO_W - LOGO_GAP;
const COL_W     = COL_TOTAL / 3;
export const COL1_X = MARGIN;
export const COL2_X = MARGIN + COL_W;
export const COL3_X = MARGIN + COL_W * 2;
export const LOGO_X = PAGE_W - MARGIN - LOGO_W;

// Label-Offset innerhalb einer Spalte
const LABEL_W   = 16;  // max. Breite Label-Text in mm
const VAL_OFFSET = 18; // Abstand Spaltenbeginn → Wert
export const MAX_VAL_W = COL_W - VAL_OFFSET - 3; // max. Wert-Breite in mm

const FONT_SZ  = 7;    // pt
const LINE_H   = 5.5;  // Zeilenabstand in mm (≈ 4pt leading + 7pt font)

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

export const getImageDimensions = (dataURI: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve({ width: 800, height: 600 });
    img.src = dataURI;
  });
};

/** Kürzt Text auf maxBreite (in mm) mit aktuellem Font */
function truncateText(pdf: jsPDF, text: string, maxMm: number): string {
  while (pdf.getTextWidth(text) > maxMm && text.length > 3) {
    text = text.slice(0, -1);
  }
  return text;
}

// ─── Footer ───────────────────────────────────────────────────────────────────

export interface FooterRow {
  label: string;
  value: string;
  pink?: boolean;
  pageLink?: number; // interne Seitenverknüpfung
}

export interface FooterData {
  col1: FooterRow[];
  col2: FooterRow[];
  col3: FooterRow[];
  logoDataUri?: string | null; // base64 Firmenlogo
}

export function drawFooter(pdf: jsPDF, data: FooterData) {
  const fottoBottom = FOOTER_H; // Footer beginnt bei y = FOOTER_H von unten
  const footerTop   = PAGE_H - FOOTER_H;

  // Dünne Trennlinie nur über den Text-Spalten (nicht über Logo)
  pdf.setDrawColor(BORDER_GRAY.r, BORDER_GRAY.g, BORDER_GRAY.b);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, footerTop, LOGO_X - 2, footerTop);

  // Zeilen-Y-Positionen: 2mm unter der Linie, dann je LINE_H
  const ROW1   = footerTop + 3;
  const rows_y = [ROW1, ROW1 + LINE_H, ROW1 + LINE_H * 2, ROW1 + LINE_H * 3, ROW1 + LINE_H * 4];

  const drawRow = (colX: number, rowY: number, row: FooterRow) => {
    // Label
    pdf.setFontSize(FONT_SZ);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(DARK.r, DARK.g, DARK.b);
    const lbl = truncateText(pdf, row.label, LABEL_W);
    pdf.text(lbl, colX, rowY);

    // Wert
    pdf.setFont("helvetica", "normal");
    if (row.pink) {
      pdf.setTextColor(PINK.r, PINK.g, PINK.b);
    } else {
      pdf.setTextColor(DARK.r, DARK.g, DARK.b);
    }
    const val = truncateText(pdf, row.value, MAX_VAL_W);
    const vx = colX + VAL_OFFSET;
    if (row.pageLink) {
      pdf.textWithLink(val, vx, rowY, { pageNumber: row.pageLink });
    } else {
      pdf.text(val, vx, rowY);
    }
    pdf.setTextColor(DARK.r, DARK.g, DARK.b);
  };

  [data.col1, data.col2, data.col3].forEach((col, ci) => {
    const cx = [COL1_X, COL2_X, COL3_X][ci];
    col.slice(0, 5).forEach((row, ri) => {
      if (rows_y[ri] < PAGE_H - 1) drawRow(cx, rows_y[ri], row);
    });
  });

  // Logo – Dimensionen via getImageInfo (synchron in jsPDF verfügbar)
  if (data.logoDataUri) {
    try {
      const fmt = data.logoDataUri.startsWith("data:image/png") ? "PNG"
                : data.logoDataUri.startsWith("data:image/svg") ? "PNG"
                : "JPEG";
      const props = pdf.getImageProperties(data.logoDataUri);
      const maxW  = LOGO_W;
      const maxH  = FOOTER_H - 6;
      const ratio = Math.min(maxW / props.width, maxH / props.height);
      const lw    = props.width  * ratio;
      const lh    = props.height * ratio;
      const lx    = LOGO_X + (maxW - lw) / 2;
      const ly    = footerTop + (maxH - lh) / 2;
      pdf.addImage(data.logoDataUri, fmt, lx, ly, lw, lh);
    } catch {
      // Logo konnte nicht eingebettet werden – still fail
    }
  }
}

// ─── Logo-Helfer ───────────────────────────────────────────────────────────────

/** Bettet ein Logo in eine Box (x,y,maxW,maxH) ein, zentriert, ratio-erhaltend. */
function drawLogoInBox(pdf: jsPDF, logoDataUri: string, x: number, y: number, maxW: number, maxH: number) {
  try {
    const fmt = logoDataUri.startsWith("data:image/png") ? "PNG"
              : logoDataUri.startsWith("data:image/svg") ? "PNG"
              : "JPEG";
    const props = pdf.getImageProperties(logoDataUri);
    const ratio = Math.min(maxW / props.width, maxH / props.height);
    const lw = props.width * ratio;
    const lh = props.height * ratio;
    pdf.addImage(logoDataUri, fmt, x + (maxW - lw) / 2, y + (maxH - lh) / 2, lw, lh);
  } catch { /* Logo nicht einbettbar – still fail */ }
}

// ─── Akzent-Kopfleiste (Standort-/Grundrissseiten) ──────────────────────────────

export function drawPageHeaderBand(pdf: jsPDF, opts: { title: string; right?: string }) {
  pdf.setFillColor(BRAND.r, BRAND.g, BRAND.b);
  pdf.rect(0, 0, PAGE_W, HEADER_BAND_H, "F");
  // schmaler dunklerer Streifen ganz oben für Tiefe
  pdf.setFillColor(BRAND_DARK.r, BRAND_DARK.g, BRAND_DARK.b);
  pdf.rect(0, 0, PAGE_W, 1.4, "F");

  const baseY = HEADER_BAND_H / 2 + 2.2;
  pdf.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10.5);
  pdf.text(truncateText(pdf, opts.title, PAGE_W - 2 * MARGIN - 60), MARGIN, baseY);

  if (opts.right) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.text(opts.right, PAGE_W - MARGIN, baseY - 0.3, { align: "right" });
  }
  pdf.setTextColor(DARK.r, DARK.g, DARK.b);
}

// ─── Deckblatt ───────────────────────────────────────────────────────────────--

export async function drawCoverPage(params: {
  pdf: jsPDF;
  logoDataUri?: string | null;
  title: string;
  subtitle?: string;
  projectNumber: string;
  customerName?: string;
  dateStr: string;
  locationCount: number;
  locations: { number: string; name?: string }[];
  companyName?: string;
}) {
  const { pdf } = params;

  // Akzentleiste oben
  pdf.setFillColor(BRAND.r, BRAND.g, BRAND.b);
  pdf.rect(0, 0, PAGE_W, 4, "F");

  // Logo oben rechts
  if (params.logoDataUri) {
    drawLogoInBox(pdf, params.logoDataUri, PAGE_W - MARGIN - 42, MARGIN + 4, 42, 20);
  }

  // Titelblock
  let y = MARGIN + 22;
  pdf.setTextColor(BRAND.r, BRAND.g, BRAND.b);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(28);
  pdf.text(params.title, MARGIN, y);
  if (params.subtitle) {
    y += 8;
    pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(12);
    pdf.text(params.subtitle, MARGIN, y);
  }

  // Trennlinie
  y += 8;
  pdf.setDrawColor(BORDER_GRAY.r, BORDER_GRAY.g, BORDER_GRAY.b);
  pdf.setLineWidth(0.3);
  pdf.line(MARGIN, y, PAGE_W - MARGIN, y);

  // Info-Karte links
  const cardY = y + 8;
  const cardW = 92;
  const cardH = 58;
  pdf.setFillColor(SURFACE.r, SURFACE.g, SURFACE.b);
  pdf.roundedRect(MARGIN, cardY, cardW, cardH, 2.5, 2.5, "F");
  pdf.setFillColor(BRAND.r, BRAND.g, BRAND.b);
  pdf.rect(MARGIN, cardY, 2.5, cardH, "F");

  const meta: { label: string; value: string }[] = [
    { label: "Projektnummer", value: params.projectNumber },
    ...(params.customerName ? [{ label: "Kunde", value: params.customerName }] : []),
    { label: "Datum", value: params.dateStr },
    { label: "Standorte", value: String(params.locationCount) },
  ];
  let my = cardY + 11;
  for (const row of meta) {
    pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.text(row.label.toUpperCase(), MARGIN + 9, my);
    pdf.setTextColor(DARK.r, DARK.g, DARK.b);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    pdf.text(truncateText(pdf, row.value, cardW - 14), MARGIN + 9, my + 5);
    my += 13;
  }

  // Standort-Übersicht rechts
  if (params.locations.length > 0) {
    const listX = MARGIN + cardW + 10;
    const listW = PAGE_W - MARGIN - listX;
    pdf.setTextColor(DARK.r, DARK.g, DARK.b);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("Standorte", listX, cardY + 4);

    const colCount = 2;
    const colGap = 6;
    const colW = (listW - colGap * (colCount - 1)) / colCount;
    const rowH = 5.4;
    const startY = cardY + 12;
    const maxRows = Math.floor((cardH - 12) / rowH);
    const capacity = maxRows * colCount;
    const show = params.locations.slice(0, capacity);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    show.forEach((loc, i) => {
      const col = Math.floor(i / maxRows);
      const rowInCol = i % maxRows;
      const x = listX + col * (colW + colGap);
      const ry = startY + rowInCol * rowH;
      // Nummern-Badge
      pdf.setTextColor(BRAND.r, BRAND.g, BRAND.b);
      pdf.setFont("helvetica", "bold");
      const numLabel = loc.number || "–";
      pdf.text(numLabel, x, ry);
      const numW = pdf.getTextWidth(numLabel) + 2;
      // Name
      pdf.setTextColor(DARK.r, DARK.g, DARK.b);
      pdf.setFont("helvetica", "normal");
      const name = loc.name ? truncateText(pdf, loc.name, colW - numW - 1) : "";
      if (name) pdf.text(name, x + numW, ry);
    });

    if (params.locations.length > show.length) {
      pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(8);
      pdf.text(`… und ${params.locations.length - show.length} weitere`, listX, startY + maxRows * rowH + 2);
    }
  }

  // Fußzeile
  pdf.setDrawColor(BORDER_GRAY.r, BORDER_GRAY.g, BORDER_GRAY.b);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, PAGE_H - 14, PAGE_W - MARGIN, PAGE_H - 14);
  pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  const left = params.companyName ? params.companyName : "";
  if (left) pdf.text(left, MARGIN, PAGE_H - 9);
  pdf.text(`Erstellt mit Captfix · captfix.app · ${params.dateStr}`, PAGE_W - MARGIN, PAGE_H - 9, { align: "right" });
}

// ─── Standortseite ────────────────────────────────────────────────────────────

export async function drawLocationPageLandscape(params: {
  pdf: jsPDF;
  imageData: string;
  footer: FooterData;
  header?: { title: string; right?: string };
}) {
  const { pdf, imageData, footer, header } = params;

  if (header) drawPageHeaderBand(pdf, header);

  // Foto-Bereich: unter der Kopfleiste (falls vorhanden) bis über dem Footer
  const fotoTop    = header ? HEADER_BAND_H + 3 : MARGIN;
  const fotoBottom = PAGE_H - FOOTER_H;
  const fotoH      = fotoBottom - fotoTop;
  const fotoW      = PAGE_W - 2 * MARGIN;

  if (imageData) {
    const dims  = await getImageDimensions(imageData);
    const ratio = Math.min(fotoW / dims.width, fotoH / dims.height);
    const iw    = dims.width  * ratio;
    const ih    = dims.height * ratio;
    const ix    = MARGIN + (fotoW - iw) / 2;
    const iy    = fotoTop + (fotoH - ih) / 2;
    const fmt   = imageData.startsWith("data:image/jpeg") ? "JPEG"
                : imageData.startsWith("data:image/webp") ? "WEBP"
                : "PNG";
    try { pdf.addImage(imageData, fmt as any, ix, iy, iw, ih); } catch {}
  }

  drawFooter(pdf, footer);
}

// ─── Grundrissseite (bleibt Hochformat) ───────────────────────────────────────
// Wird weiterhin in Export.tsx direkt gezeichnet

export const CONTENT_WIDTH  = PAGE_W - 2 * MARGIN;
export const CONTENT_HEIGHT = PAGE_H - 2 * MARGIN;

