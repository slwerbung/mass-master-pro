// Server-side Aufmaß-PDF generation + HERO document upload.
//
// Shared by the "project fully approved → upload Aufmaß-PDF to HERO"
// automation (see _shared/automations.ts). pdf-lib is imported dynamically
// inside generateAufmassPdf so that functions which only dispatch other
// automations don't eagerly pull the PDF library into their bundle.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const HERO_GRAPHQL_URL = "https://login.hero-software.de/api/external/v9/graphql";
const HERO_UPLOAD_URL = "https://login.hero-software.de/app/v8/FileUploads/upload";

function detectImageType(bytes: Uint8Array): "jpg" | "png" | null {
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8) return "jpg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "png";
  return null;
}

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export interface AufmassPdfParams {
  projectId: string;
  projectNumber: string;
  customerName: string;
  companyName: string;
}

// Builds a branded A4 PDF: title page + one page per location with the
// annotated image and the location's field values. Returns null when the
// project has no locations.
export async function generateAufmassPdf(
  supabase: SupabaseClient,
  { projectId, projectNumber, customerName, companyName }: AufmassPdfParams,
): Promise<Uint8Array | null> {
  const { PDFDocument, StandardFonts, rgb } = await import("https://esm.sh/pdf-lib@1.17.1");

  const [fieldCfgRes, locRes] = await Promise.all([
    supabase.from("location_field_config").select("field_key, field_label, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("locations")
      .select("id, location_number, location_name, system, label, comment, custom_fields")
      .eq("project_id", projectId)
      .order("location_number"),
  ]);

  const locations: any[] = locRes.data || [];
  if (locations.length === 0) return null;

  const fieldLabels = new Map<string, string>(
    (fieldCfgRes.data || []).map((f: any) => [f.field_key, f.field_label as string]),
  );
  const fieldOrder: string[] = (fieldCfgRes.data || []).map((f: any) => f.field_key as string);

  const locationIds = locations.map((l: any) => l.id as string);
  const [{ data: locImages }, { data: locPdfs }] = await Promise.all([
    supabase.from("location_images").select("location_id, storage_path").in("location_id", locationIds).eq("image_type", "annotated"),
    // Production/print files (Druckdaten) — always PDFs (see SplitPdfDialog).
    // Mirroring the app view (LocationApprovalMedia) these are the MAIN media
    // the customer approves; the old export dropped them entirely.
    supabase.from("location_pdfs").select("location_id, storage_path, file_name").in("location_id", locationIds),
  ]);

  const imagePathMap = new Map<string, string>(
    (locImages || []).map((img: any) => [img.location_id as string, img.storage_path as string]),
  );
  const pdfMap = new Map<string, { storage_path: string; file_name: string }[]>();
  for (const row of (locPdfs || []) as any[]) {
    const arr = pdfMap.get(row.location_id) || [];
    arr.push({ storage_path: row.storage_path, file_name: row.file_name || "Produktionsdatei" });
    pdfMap.set(row.location_id, arr);
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const publicUrl = (path: string) => `${supabaseUrl}/storage/v1/object/public/project-files/${path}`;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Captfix – ${projectNumber} – Freigabe`);
  pdfDoc.setAuthor(companyName);

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const A4W = 595, A4H = 842, ML = 40, MR = 40, CW = A4W - ML - MR;
  const BRAND = rgb(0.055, 0.451, 0.91);
  const BLACK = rgb(0.1, 0.1, 0.1);
  const GREY = rgb(0.45, 0.45, 0.45);
  const LIGHT = rgb(0.96, 0.96, 0.96);
  const WHITE = rgb(1, 1, 1);

  const tp = pdfDoc.addPage([A4W, A4H]);
  tp.drawRectangle({ x: 0, y: A4H - 8, width: A4W, height: 8, color: BRAND });
  tp.drawText(companyName, { x: ML, y: A4H - 60, size: 22, font: fontBold, color: BRAND });
  tp.drawLine({ start: { x: ML, y: A4H - 70 }, end: { x: A4W - MR, y: A4H - 70 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  tp.drawText("Freigabedokumentation", { x: ML, y: A4H - 110, size: 24, font: fontBold, color: BLACK });
  tp.drawText("Aufmaß · Captfix", { x: ML, y: A4H - 135, size: 13, font: fontReg, color: GREY });

  const boxY = A4H - 220;
  tp.drawRectangle({ x: ML, y: boxY, width: CW, height: 110, color: LIGHT });
  tp.drawRectangle({ x: ML, y: boxY, width: 3, height: 110, color: BRAND });
  const infoLines: [string, string][] = [
    ["Projektnummer", projectNumber],
    ["Kunde", customerName],
    ["Freigegeben am", fmtDate(new Date())],
    ["Standorte", String(locations.length)],
  ];
  let iy = boxY + 80;
  for (const [label, val] of infoLines) {
    tp.drawText(label, { x: ML + 14, y: iy, size: 9, font: fontBold, color: GREY });
    tp.drawText(val, { x: ML + 130, y: iy, size: 10, font: fontReg, color: BLACK });
    iy -= 22;
  }
  tp.drawText(`Erstellt von Captfix (captfix.app) am ${fmtDate(new Date())}`, {
    x: ML, y: 30, size: 8, font: fontReg, color: rgb(0.65, 0.65, 0.65),
  });

  for (const loc of locations) {
    const page = pdfDoc.addPage([A4W, A4H]);
    page.drawRectangle({ x: 0, y: A4H - 52, width: A4W, height: 52, color: BRAND });
    page.drawRectangle({ x: 0, y: A4H - 8, width: A4W, height: 8, color: rgb(0.02, 0.3, 0.7) });

    const locNum = loc.location_number ? `#${loc.location_number}` : "";
    const locName: string = loc.location_name || "";
    const headerLabel = [locNum, locName].filter(Boolean).join("  ·  ");
    page.drawText(headerLabel || "Standort", { x: ML, y: A4H - 34, size: 13, font: fontBold, color: WHITE });
    page.drawText(`Projekt ${projectNumber}`, { x: ML, y: A4H - 47, size: 8, font: fontReg, color: rgb(0.78, 0.88, 1) });

    let y = A4H - 72;
    const rows: [string, string][] = [];
    if (loc.system) rows.push(["System", String(loc.system)]);
    if (loc.label) rows.push(["Bezeichnung", String(loc.label)]);
    const cf: Record<string, any> = loc.custom_fields || {};
    for (const key of fieldOrder) {
      const val = cf[key];
      if (val == null || val === "") continue;
      rows.push([fieldLabels.get(key) || key, String(val)]);
    }
    if (loc.comment) rows.push(["Hinweis", String(loc.comment)]);
    const prodFiles = pdfMap.get(loc.id) || [];
    if (prodFiles.length > 0) rows.push(["Produktionsdatei", prodFiles.map((p) => p.file_name).join(", ")]);

    const COL1 = 120, ROW_H = 16;
    for (let ri = 0; ri < rows.length; ri++) {
      const [label, value] = rows[ri];
      if (y < 160) break;
      if (ri % 2 === 0) page.drawRectangle({ x: ML, y: y - 3, width: CW, height: ROW_H, color: LIGHT });
      page.drawText(label + ":", { x: ML + 4, y: y + 2, size: 8, font: fontBold, color: GREY });
      let dv = value;
      while (dv.length > 1 && fontReg.widthOfTextAtSize(dv, 9) > CW - COL1 - 8) dv = dv.slice(0, -1);
      if (dv !== value) dv = dv.slice(0, -1) + "…";
      page.drawText(dv, { x: ML + COL1, y: y + 2, size: 9, font: fontReg, color: BLACK });
      y -= ROW_H;
    }
    y -= 8;

    const imgPath = imagePathMap.get(loc.id);
    if (imgPath) {
      const imgUrl = `${supabaseUrl}/storage/v1/object/public/project-files/${imgPath}`;
      try {
        const imgRes = await fetch(imgUrl);
        if (imgRes.ok) {
          const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
          const fmt = detectImageType(imgBytes);
          if (fmt) {
            const embedded = fmt === "jpg" ? await pdfDoc.embedJpg(imgBytes) : await pdfDoc.embedPng(imgBytes);
            const maxImgW = CW, maxImgH = Math.max(80, y - 40);
            const scale = Math.min(maxImgW / embedded.width, maxImgH / embedded.height, 1);
            const imgW = embedded.width * scale, imgH = embedded.height * scale;
            page.drawImage(embedded, { x: ML + (CW - imgW) / 2, y: y - imgH, width: imgW, height: imgH });
          }
        }
      } catch { /* image unavailable – skip */ }
    }

    page.drawLine({ start: { x: ML, y: 28 }, end: { x: A4W - MR, y: 28 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    page.drawText(`${companyName} · Captfix · ${projectNumber}`, { x: ML, y: 16, size: 7, font: fontReg, color: rgb(0.65, 0.65, 0.65) });
    page.drawText(`Seite ${pdfDoc.getPageCount()}`, { x: A4W - MR - 30, y: 16, size: 7, font: fontReg, color: rgb(0.65, 0.65, 0.65) });

    // Production files (Druckdaten) — each page of every production PDF is
    // embedded on its own A4 page, so the exported document shows exactly the
    // print data the customer approved (matching the app's location view).
    const prodFilesForLoc = pdfMap.get(loc.id) || [];
    for (const pf of prodFilesForLoc) {
      let embeddedPages: any[] = [];
      try {
        const res = await fetch(publicUrl(pf.storage_path));
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        embeddedPages = await pdfDoc.embedPdf(src, src.getPageIndices());
      } catch {
        continue; // broken/unsupported production file – skip, keep going
      }
      const multi = embeddedPages.length > 1;
      embeddedPages.forEach((ep: any, pi: number) => {
        const pp = pdfDoc.addPage([A4W, A4H]);
        pp.drawRectangle({ x: 0, y: A4H - 52, width: A4W, height: 52, color: BRAND });
        pp.drawRectangle({ x: 0, y: A4H - 8, width: A4W, height: 8, color: rgb(0.02, 0.3, 0.7) });
        const pfLabel = multi ? `${pf.file_name} · S.${pi + 1}` : pf.file_name;
        pp.drawText("Produktionsdatei", { x: ML, y: A4H - 34, size: 13, font: fontBold, color: WHITE });
        pp.drawText(`${headerLabel || "Standort"}  ·  ${pfLabel}`, { x: ML, y: A4H - 47, size: 8, font: fontReg, color: rgb(0.78, 0.88, 1) });

        // Fit the embedded page into the content area (upscaling a vector PDF
        // is lossless, so fill the page for legibility).
        const availW = CW;
        const availH = (A4H - 52 - 12) - 40; // below header, above footer
        const topY = A4H - 52 - 12;
        const scale = Math.min(availW / ep.width, availH / ep.height);
        const w = ep.width * scale, h = ep.height * scale;
        pp.drawPage(ep, { x: ML + (CW - w) / 2, y: topY - h, width: w, height: h });

        pp.drawLine({ start: { x: ML, y: 28 }, end: { x: A4W - MR, y: 28 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
        pp.drawText(`${companyName} · Captfix · ${projectNumber}`, { x: ML, y: 16, size: 7, font: fontReg, color: rgb(0.65, 0.65, 0.65) });
        pp.drawText(`Seite ${pdfDoc.getPageCount()}`, { x: A4W - MR - 30, y: 16, size: 7, font: fontReg, color: rgb(0.65, 0.65, 0.65) });
      });
    }
  }

  return pdfDoc.save();
}

// Uploads PDF bytes to a HERO project as a document. Mirrors the proven
// pattern in submit-layout (upload → uuid → upload_document mutation).
export async function uploadPdfToHero(
  apiKey: string,
  projectMatchId: number,
  bytes: Uint8Array,
  filename: string,
  documentTypeId: number | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);
    const upResp = await fetch(HERO_UPLOAD_URL, { method: "POST", headers: { "x-auth-token": apiKey }, body: form });
    if (!upResp.ok) return { ok: false, error: `Upload HTTP ${upResp.status}` };
    const upText = await upResp.text();
    let uuid: string | undefined;
    try {
      const j = JSON.parse(upText);
      uuid = j.uuid ?? j.data?.uuid ?? j.file_upload_uuid;
    } catch { /* ignore */ }
    if (!uuid) return { ok: false, error: "Keine UUID in Upload-Antwort" };

    const doc: Record<string, unknown> = {};
    if (documentTypeId != null && Number.isFinite(documentTypeId)) doc.document_type_id = documentTypeId;
    const mutation = `
      mutation AssignDoc($doc: CustomerDocumentInput!, $uuid: String!, $targetId: Int!) {
        upload_document(document: $doc, file_upload_uuid: $uuid, target: project_match, target_id: $targetId) { id }
      }`;
    const r = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { doc, uuid, targetId: projectMatchId } }),
    });
    const data = await r.json();
    if (data.errors?.length) return { ok: false, error: data.errors.map((e: any) => e.message).join("; ") };
    if (!data?.data?.upload_document?.id) return { ok: false, error: "Keine ID in Antwort" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

export { fmtDate };
