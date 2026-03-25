/**
 * PDF layout helpers for professional Aufmaß reports
 */
import jsPDF from "jspdf";

// Design tokens
const BLUE = { r: 37, g: 99, b: 235 };
const GRAY_BG = { r: 243, g: 244, b: 246 };
const TEXT_PRIMARY = { r: 31, g: 41, b: 55 };
const TEXT_MUTED = { r: 107, g: 114, b: 128 };
const BORDER_GRAY = { r: 209, g: 213, b: 219 };

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 20;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

export const getImageDimensions = (dataURI: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve({ width: 800, height: 600 });
    img.src = dataURI;
  });
};

export const drawPageHeader = (
  pdf: jsPDF,
  projectNumber: string
) => {
  // Blue accent line at top
  pdf.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.setLineWidth(0.8);
  pdf.line(MARGIN, 12, PAGE_WIDTH - MARGIN, 12);

  // Project number top-right
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
  pdf.text(`Projekt ${projectNumber}`, PAGE_WIDTH - MARGIN, 10, { align: "right" });
};

export const drawPageFooter = (
  pdf: jsPDF,
  date: string,
  pageNum: number,
  totalPages: number
) => {
  const footerY = PAGE_HEIGHT - 12;

  // Thin separator line
  pdf.setDrawColor(BORDER_GRAY.r, BORDER_GRAY.g, BORDER_GRAY.b);
  pdf.setLineWidth(0.3);
  pdf.line(MARGIN, footerY - 3, PAGE_WIDTH - MARGIN, footerY - 3);

  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
  pdf.text(date, MARGIN, footerY);
  pdf.text(`Seite ${pageNum} / ${totalPages}`, PAGE_WIDTH - MARGIN, footerY, { align: "right" });
};

export const drawCoverPage = (
  pdf: jsPDF,
  projectNumber: string,
  locationCount: number,
  projectType?: string
) => {
  // Large blue accent line
  pdf.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.setLineWidth(2);
  pdf.line(MARGIN, 80, PAGE_WIDTH - MARGIN, 80);

  // Title
  pdf.setFontSize(32);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
  pdf.text("Aufmaß-Bericht", MARGIN, 100);

  // Project number
  pdf.setFontSize(20);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.text(`Projekt ${projectNumber}`, MARGIN, 115);

  // Metadata block
  pdf.setFontSize(11);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);

  const today = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const typeLabel = projectType === "aufmass_mit_plan" ? "Aufmaß mit Plan" : "Aufmaß";

  pdf.text(`Datum: ${today}`, MARGIN, 135);
  pdf.text(`Typ: ${typeLabel}`, MARGIN, 143);
  pdf.text(`Standorte: ${locationCount}`, MARGIN, 151);

  // Bottom accent line
  pdf.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.setLineWidth(0.5);
  pdf.line(MARGIN, 160, MARGIN + 40, 160);
};

interface MetadataRow {
  label: string;
  value: string;
}

export const drawMetadataBox = (
  pdf: jsPDF,
  rows: MetadataRow[],
  startY: number
): number => {
  if (rows.length === 0) return startY;

  const rowH = 7;
  const padding = 4;
  const boxH = padding * 2 + Math.ceil(rows.length / 2) * rowH;
  const colWidth = CONTENT_WIDTH / 2;

  // Gray background
  pdf.setFillColor(GRAY_BG.r, GRAY_BG.g, GRAY_BG.b);
  pdf.roundedRect(MARGIN, startY, CONTENT_WIDTH, boxH, 1.5, 1.5, "F");

  // Border
  pdf.setDrawColor(BORDER_GRAY.r, BORDER_GRAY.g, BORDER_GRAY.b);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(MARGIN, startY, CONTENT_WIDTH, boxH, 1.5, 1.5, "S");

  let y = startY + padding + 4;

  for (let i = 0; i < rows.length; i++) {
    const col = i % 2;
    const x = MARGIN + padding + col * colWidth;

    // Label
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
    pdf.text(rows[i].label, x, y);

    // Value
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
    const maxW = colWidth - padding * 2;
    const truncated = pdf.splitTextToSize(rows[i].value, maxW)[0] || rows[i].value;
    pdf.text(truncated, x, y + 4);

    if (col === 1 || i === rows.length - 1) {
      y += rowH;
    }
  }

  return startY + boxH + 3;
};

export const drawImageWithBorder = (
  pdf: jsPDF,
  dataURI: string,
  x: number,
  y: number,
  w: number,
  h: number
) => {
  try {
    pdf.addImage(dataURI, "PNG", x, y, w, h);
  } catch (e) {
    console.error("Error adding image:", e);
  }

  // Thin gray border
  pdf.setDrawColor(BORDER_GRAY.r, BORDER_GRAY.g, BORDER_GRAY.b);
  pdf.setLineWidth(0.3);
  pdf.rect(x, y, w, h, "S");
};

export const drawCommentBlock = (
  pdf: jsPDF,
  comment: string,
  y: number
): number => {
  const indent = 5;

  // Blue accent line left
  pdf.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.setLineWidth(1);
  pdf.line(MARGIN + 1, y, MARGIN + 1, y + 2); // will extend after measuring

  // Label
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
  pdf.text("Kommentar", MARGIN + indent, y + 3);

  // Comment text
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
  const lines = pdf.splitTextToSize(comment, CONTENT_WIDTH - indent - 2);
  pdf.text(lines, MARGIN + indent, y + 8);

  const blockH = 10 + lines.length * 3.8;

  // Extend the accent line
  pdf.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.setLineWidth(1);
  pdf.line(MARGIN + 1, y, MARGIN + 1, y + blockH);

  return y + blockH + 3;
};

export const drawBackLink = (
  pdf: jsPDF,
  text: string,
  y: number,
  targetPage: number
): number => {
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.textWithLink(text, MARGIN, y + 3, { pageNumber: targetPage });
  pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
  return y + 8;
};

export { MARGIN, CONTENT_WIDTH, PAGE_HEIGHT, PAGE_WIDTH, BLUE, TEXT_PRIMARY, TEXT_MUTED };
