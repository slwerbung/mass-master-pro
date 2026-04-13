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

// ─── Standortseite ────────────────────────────────────────────────────────────

export async function drawLocationPageLandscape(params: {
  pdf: jsPDF;
  imageData: string;
  footer: FooterData;
}) {
  const { pdf, imageData, footer } = params;

  // Foto-Bereich: von MARGIN bis über dem Footer
  const fotoTop    = MARGIN;
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

