// Server-side Aufmaß-PDF generation + HERO document upload.
//
// Shared by the "project fully approved → upload Aufmaß-PDF to HERO"
// automation (see _shared/automations.ts). pdf-lib is imported dynamically
// inside generateAufmassPdf so that functions which only dispatch other
// automations don't eagerly pull the PDF library into their bundle.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { numberTopLevel, type DrawOp } from "./markup.ts";
import { hexColor, markupItemsFor, pdfMarkupOps, type FeedbackRow } from "./markupPdf.ts";

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

// Unicode code points the WinAnsi (cp1252) encoding of the standard PDF fonts
// supports beyond Latin-1 (typographic quotes, dashes, bullet, euro, …).
const WINANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);
const WINANSI_MAP: Record<number, string> = {
  0x2192: "->", 0x2190: "<-", 0x21d2: "=>", 0x2713: "OK", 0x2714: "OK",
  0x2022: "-", 0x00b7: "-",
};

// Makes any text safe to draw with a WinAnsi standard font. Standard fonts
// throw on characters they cannot encode (famously "\n"), which used to abort
// the whole PDF; here newlines/tabs collapse to spaces and any non-encodable
// character is mapped to an ASCII equivalent or dropped.
function sanitize(input: unknown, maxLen = 600): string {
  if (input == null) return "";
  const collapsed = String(input).replace(/[\r\n\t\v\f ]+/g, " ").replace(/\s{2,}/g, " ").trim();
  let out = "";
  for (const ch of collapsed) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x20 || (cp >= 0x21 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(cp)) {
      out += ch;
    } else {
      out += WINANSI_MAP[cp] ?? "";
    }
  }
  return out.slice(0, maxLen);
}

// object-contain fit of (w,h) into a (boxW,boxH) box.
function fitContain(boxW: number, boxH: number, w: number, h: number): { w: number; h: number } {
  const scale = Math.min(boxW / w, boxH / h);
  return { w: w * scale, h: h * scale };
}

export interface AufmassPdfParams {
  projectId: string;
  projectNumber: string;
  customerName: string;
  companyName: string;
  /** Spec C: Korrekturen (Markierungen + Kommentarliste) einzeichnen. Standard aus – bestehende Automationen bleiben unveraendert. */
  withMarkup?: boolean;
}


// Builds a branded A4 PDF: title page + one page per location with the
// annotated image and the location's field values. Returns null when the
// project has no locations.
export async function generateAufmassPdf(
  supabase: SupabaseClient,
  { projectId, projectNumber, customerName, companyName, withMarkup = false }: AufmassPdfParams,
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
  const [{ data: locImages }, { data: locPdfs }, { data: feedback }, { data: origImages }] = await Promise.all([
    supabase.from("location_images").select("location_id, storage_path").in("location_id", locationIds).eq("image_type", "annotated"),
    // Production/print files (Druckdaten) — always PDFs (see SplitPdfDialog).
    // Mirroring the app view (LocationApprovalMedia) these are the MAIN media
    // the customer approves; the old export dropped them entirely.
    // Spec D1: nur die aktuelle Version.
    supabase.from("location_pdfs").select("location_id, storage_path, file_name").in("location_id", locationIds).is("superseded_at", null),
    withMarkup
      ? supabase.from("location_feedback").select("id, location_id, message, author_name, status, created_at, parent_id, markup, media_ref")
        .in("location_id", locationIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    withMarkup
      ? supabase.from("location_images").select("location_id, storage_path").in("location_id", locationIds).eq("image_type", "original")
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const feedbackMap = new Map<string, FeedbackRow[]>();
  for (const f of (feedback || []) as FeedbackRow[]) (feedbackMap.get(f.location_id) ?? feedbackMap.set(f.location_id, []).get(f.location_id)!).push(f);
  const photoPathsMap = new Map<string, Set<string>>();
  for (const r of [...(locImages || []), ...(origImages || [])] as any[]) {
    (photoPathsMap.get(r.location_id) ?? photoPathsMap.set(r.location_id, new Set()).get(r.location_id)!).add(r.storage_path);
  }

  const imagePathMap = new Map<string, string>(
    (locImages || []).map((img: any) => [img.location_id as string, img.storage_path as string]),
  );
  const pdfMap = new Map<string, { storage_path: string; file_name: string }[]>();
  for (const row of (locPdfs || []) as any[]) {
    const arr = pdfMap.get(row.location_id) || [];
    arr.push({ storage_path: row.storage_path, file_name: row.file_name || "Produktionsdatei" });
    pdfMap.set(row.location_id, arr);
  }

  // Der Bucket ist privat. Diese Function laeuft mit service_role und laedt
  // die Dateien deshalb direkt herunter, statt sich einen Link zu bauen.
  const loadFile = async (path: string): Promise<Uint8Array | null> => {
    const { data, error } = await supabase.storage.from("project-files").download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  };

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
  tp.drawText(sanitize(companyName, 80), { x: ML, y: A4H - 60, size: 22, font: fontBold, color: BRAND });
  tp.drawLine({ start: { x: ML, y: A4H - 70 }, end: { x: A4W - MR, y: A4H - 70 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  tp.drawText("Freigabedokumentation", { x: ML, y: A4H - 110, size: 24, font: fontBold, color: BLACK });
  tp.drawText("Aufmaß · Captfix", { x: ML, y: A4H - 135, size: 13, font: fontReg, color: GREY });

  const boxY = A4H - 220;
  tp.drawRectangle({ x: ML, y: boxY, width: CW, height: 110, color: LIGHT });
  tp.drawRectangle({ x: ML, y: boxY, width: 3, height: 110, color: BRAND });
  const infoLines: [string, string][] = [
    ["Projektnummer", sanitize(projectNumber, 60)],
    ["Kunde", sanitize(customerName, 80)],
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

  const drawOps = (pg: any, ops: DrawOp[]) => {
    for (const o of ops) {
      const color = hexColor(rgb, o.color);
      try {
        switch (o.op) {
          case "line": pg.drawLine({ start: { x: o.x1, y: o.y1 }, end: { x: o.x2, y: o.y2 }, thickness: 1.5, color }); break;
          case "rect": pg.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, borderColor: color, borderWidth: 1.5 }); break;
          case "ellipse": pg.drawEllipse({ x: o.cx, y: o.cy, xScale: Math.max(o.rx, 0.5), yScale: Math.max(o.ry, 0.5), borderColor: color, borderWidth: 1.5 }); break;
          case "polyline":
            for (let i = 1; i < o.pts.length; i++) pg.drawLine({ start: { x: o.pts[i - 1][0], y: o.pts[i - 1][1] }, end: { x: o.pts[i][0], y: o.pts[i][1] }, thickness: 1.5, color });
            break;
          case "text": {
            const t = sanitize(o.text, 200);
            if (t) pg.drawText(t, { x: o.x, y: o.y - 9, size: 9, font: fontBold, color });
            break;
          }
          case "badge": {
            if (!o.label) break;
            pg.drawCircle({ x: o.x, y: o.y, size: 7, color: o.done ? GREY : color, borderColor: WHITE, borderWidth: 1 });
            const tw = fontBold.widthOfTextAtSize(o.label, 7);
            pg.drawText(o.label, { x: o.x - tw / 2, y: o.y - 2.5, size: 7, font: fontBold, color: WHITE });
            break;
          }
        }
      } catch { /* eine kaputte Markierung bricht das PDF nie ab */ }
    }
  };

  const footerText = sanitize(`${companyName} · Captfix · ${projectNumber}`, 120);
  const drawHeaderBand = (pg: any, title: string, sub: string) => {
    pg.drawRectangle({ x: 0, y: A4H - 52, width: A4W, height: 52, color: BRAND });
    pg.drawRectangle({ x: 0, y: A4H - 8, width: A4W, height: 8, color: rgb(0.02, 0.3, 0.7) });
    pg.drawText(sanitize(title, 90) || "Standort", { x: ML, y: A4H - 34, size: 13, font: fontBold, color: WHITE });
    pg.drawText(sanitize(sub, 110), { x: ML, y: A4H - 47, size: 8, font: fontReg, color: rgb(0.78, 0.88, 1) });
  };
  const drawFooterBand = (pg: any) => {
    pg.drawLine({ start: { x: ML, y: 28 }, end: { x: A4W - MR, y: 28 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    pg.drawText(footerText, { x: ML, y: 16, size: 7, font: fontReg, color: rgb(0.65, 0.65, 0.65) });
    pg.drawText(`Seite ${pdfDoc.getPageCount()}`, { x: A4W - MR - 30, y: 16, size: 7, font: fontReg, color: rgb(0.65, 0.65, 0.65) });
  };

  for (const loc of locations) {
    try {
      const locNum = loc.location_number ? `#${loc.location_number}` : "";
      const locName: string = loc.location_name || "";
      const headerLabel = [locNum, locName].filter(Boolean).join("  ·  ") || "Standort";

      // Embed every production page up front (once), each file independently so
      // one broken print file doesn't drop the others.
      const prodFiles = pdfMap.get(loc.id) || [];
      const prodPages: { ep: any; label: string; path: string; pageNo: number }[] = [];
      let prodFailed = false;
      for (const pf of prodFiles) {
        try {
          const bytes = await loadFile(pf.storage_path);
          if (!bytes) { prodFailed = true; continue; }
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const eps = await pdfDoc.embedPdf(src, src.getPageIndices());
          const multi = eps.length > 1;
          eps.forEach((ep: any, pi: number) =>
            prodPages.push({ ep, label: multi ? `${pf.file_name} · S.${pi + 1}` : pf.file_name, path: pf.storage_path, pageNo: pi + 1 }));
        } catch {
          prodFailed = true; // noted as a field on the page; keep going
        }
      }

      // Embed the on-site photo (main image when there is no production file,
      // else a small thumbnail — mirroring the app's location view).
      let photoEmbed: any = null;
      const imgPath = imagePathMap.get(loc.id);
      if (imgPath) {
        try {
          const imgBytes = await loadFile(imgPath);
          if (imgBytes) {
            const fmt = detectImageType(imgBytes);
            if (fmt) photoEmbed = fmt === "jpg" ? await pdfDoc.embedJpg(imgBytes) : await pdfDoc.embedPng(imgBytes);
          }
        } catch { /* photo unavailable */ }
      }

      const page = pdfDoc.addPage([A4W, A4H]);
      drawHeaderBand(page, headerLabel, `Projekt ${projectNumber}`);

      // ── Media box: production page 1 as the main visual, else the photo ──
      const mediaTop = A4H - 52 - 12;
      const mediaH = 300;
      const mediaY = mediaTop - mediaH;
      const pad = 8;
      const boxW = CW - pad * 2, boxH = mediaH - pad * 2;
      page.drawRectangle({ x: ML, y: mediaY, width: CW, height: mediaH, color: LIGHT });

      const main = prodPages[0]?.ep || null;
      const fb = withMarkup ? feedbackMap.get(loc.id) || [] : [];
      const pdfItems = (path: string, pageNo: number) =>
        fb.length ? markupItemsFor(fb, (r) => r.kind === "pdf" && r.storagePath === path && r.page === pageNo) : [];
      let mainLabel = "";
      if (main) {
        const { w, h } = fitContain(boxW, boxH, main.width, main.height);
        const box = { x: ML + (CW - w) / 2, y: mediaY + (mediaH - h) / 2, w, h };
        page.drawPage(main, { x: box.x, y: box.y, width: w, height: h });
        drawOps(page, pdfMarkupOps(pdfItems(prodPages[0].path, prodPages[0].pageNo), box));
        mainLabel = "Produktionsdatei";
      } else if (photoEmbed) {
        const { w, h } = fitContain(boxW, boxH, photoEmbed.width, photoEmbed.height);
        const box = { x: ML + (CW - w) / 2, y: mediaY + (mediaH - h) / 2, w, h };
        page.drawImage(photoEmbed, { x: box.x, y: box.y, width: w, height: h });
        const mine = photoPathsMap.get(loc.id);
        if (fb.length && mine) drawOps(page, pdfMarkupOps(markupItemsFor(fb, (r) => r.kind === "image" && mine.has(r.storagePath)), box));
        mainLabel = "Foto";
      } else {
        page.drawText("Kein Bild vorhanden", { x: ML + pad, y: mediaY + mediaH / 2, size: 10, font: fontReg, color: GREY });
      }

      // On-site photo thumbnail when the production file is the main image.
      if (main && photoEmbed) {
        const tW = 96, tH = 96;
        const tx = ML + CW - pad - tW, ty = mediaY + pad;
        page.drawRectangle({ x: tx - 3, y: ty - 3, width: tW + 6, height: tH + 6, color: WHITE, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
        const { w, h } = fitContain(tW, tH, photoEmbed.width, photoEmbed.height);
        page.drawImage(photoEmbed, { x: tx + (tW - w) / 2, y: ty + (tH - h) / 2, width: w, height: h });
      }

      // Media label chip (top-left).
      if (mainLabel) {
        const chipW = fontBold.widthOfTextAtSize(mainLabel, 8) + 12;
        page.drawRectangle({ x: ML + pad, y: mediaTop - pad - 14, width: chipW, height: 16, color: WHITE, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 });
        page.drawText(mainLabel, { x: ML + pad + 6, y: mediaTop - pad - 10, size: 8, font: fontBold, color: BRAND });
      }

      // ── Field rows below the media box ──
      const rows: [string, string][] = [];
      if (loc.system) rows.push(["System", sanitize(loc.system, 200)]);
      if (loc.label) rows.push(["Bezeichnung", sanitize(loc.label, 200)]);
      const cf: Record<string, any> = loc.custom_fields || {};
      for (const key of fieldOrder) {
        const val = cf[key];
        if (val == null || val === "") continue;
        rows.push([sanitize(fieldLabels.get(key) || key, 60), sanitize(val, 400)]);
      }
      if (loc.comment) rows.push(["Hinweis", sanitize(loc.comment, 400)]);
      if (prodFiles.length > 0) {
        const names = sanitize(prodFiles.map((p) => p.file_name).join(", "), 300);
        rows.push(["Produktionsdatei", prodPages.length === 0 && prodFailed ? `${names} (Vorschau nicht verfuegbar)` : names]);
      }

      let y = mediaY - 20;
      const COL1 = 120, ROW_H = 16;
      for (let ri = 0; ri < rows.length; ri++) {
        const [label, value] = rows[ri];
        if (y < 42) break;
        if (ri % 2 === 0) page.drawRectangle({ x: ML, y: y - 3, width: CW, height: ROW_H, color: LIGHT });
        page.drawText(label + ":", { x: ML + 4, y: y + 2, size: 8, font: fontBold, color: GREY });
        let dv = value;
        while (dv.length > 1 && fontReg.widthOfTextAtSize(dv, 9) > CW - COL1 - 8) dv = dv.slice(0, -1);
        if (dv !== value) dv = dv.slice(0, -1) + "…";
        page.drawText(dv, { x: ML + COL1, y: y + 2, size: 9, font: fontReg, color: BLACK });
        y -= ROW_H;
      }

      drawFooterBand(page);

      // ── Remaining production pages (page 2+) as full pages ──
      for (let i = 1; i < prodPages.length; i++) {
        const { ep, label, path, pageNo } = prodPages[i];
        const pp = pdfDoc.addPage([A4W, A4H]);
        drawHeaderBand(pp, "Produktionsdatei", `${headerLabel}  ·  ${label}`);
        const availW = CW;
        const availH = (A4H - 52 - 12) - 40;
        const topY = A4H - 52 - 12;
        const { w, h } = fitContain(availW, availH, ep.width, ep.height);
        pp.drawPage(ep, { x: ML + (CW - w) / 2, y: topY - h, width: w, height: h });
        drawOps(pp, pdfMarkupOps(pdfItems(path, pageNo), { x: ML + (CW - w) / 2, y: topY - h, w, h }));
        drawFooterBand(pp);
      }

      // ── Korrekturen als Liste (nummeriert wie die Markierungen) ──
      const tops = fb.filter((f) => !f.parent_id);
      if (tops.length) {
        const numbers = numberTopLevel(fb);
        const fmt = (iso: string) => fmtDate(new Date(iso));
        let cp = pdfDoc.addPage([A4W, A4H]);
        drawHeaderBand(cp, "Korrekturen", `${headerLabel}  ·  Projekt ${projectNumber}`);
        let cy = A4H - 52 - 24;
        const wrap = (text: string, width: number, size: number): string[] => {
          const words = sanitize(text, 2000).split(" ");
          const lines: string[] = [];
          let cur = "";
          for (const w of words) {
            const next = cur ? `${cur} ${w}` : w;
            if (fontReg.widthOfTextAtSize(next, size) > width && cur) { lines.push(cur); cur = w; } else cur = next;
          }
          if (cur) lines.push(cur);
          return lines;
        };
        const line = (text: string, x: number, size: number, font: any, color: any) => {
          if (cy < 44) {
            drawFooterBand(cp);
            cp = pdfDoc.addPage([A4W, A4H]);
            drawHeaderBand(cp, "Korrekturen (Fortsetzung)", `${headerLabel}  ·  Projekt ${projectNumber}`);
            cy = A4H - 52 - 24;
          }
          cp.drawText(text, { x, y: cy, size, font, color });
          cy -= size + 4;
        };
        for (const f of tops) {
          const done = f.status === "done";
          const nr = f.markup ? numbers.get(f.id) : undefined;
          line(sanitize(`${nr ? `[${nr}] ` : ""}${f.author_name || ""} · ${fmt(f.created_at)} · ${done ? "umgesetzt" : "offen"}`, 200), ML, 9, fontBold, done ? GREY : BLACK);
          for (const l of wrap(f.message, CW - 8, 9)) line(l, ML + 6, 9, fontReg, done ? GREY : BLACK);
          for (const r of fb.filter((x) => x.parent_id === f.id)) {
            for (const l of wrap(`> ${r.author_name || ""} (${fmt(r.created_at)}): ${r.message}`, CW - 20, 8)) line(l, ML + 16, 8, fontReg, GREY);
          }
          cy -= 4;
        }
        drawFooterBand(cp);
      }
    } catch (e) {
      // A single problematic location must never abort the whole document.
      console.warn("aufmassPdf: location skipped:", (e as Error)?.message || e);
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
