import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const HERO_LOGBOOK_URL = "https://login.hero-software.de/api/external/v9/graphql";
const HERO_UPLOAD_URL = "https://login.hero-software.de/app/v8/FileUploads/upload";

async function heroContext(supabase: any, projectId: string): Promise<{ apiKey: string; heroId: number } | null> {
  const { data: cfg } = await supabase.from("app_config").select("key,value").in("key", ["hero_api_key", "hero_enabled"]);
  const map = new Map((cfg || []).map((r: any) => [r.key, r.value]));
  const apiKey = map.get("hero_api_key") as string | undefined;
  const enabled = map.get("hero_enabled") === "true" || map.get("hero_enabled") === true;
  if (!enabled || !apiKey) return null;
  const { data: proj } = await supabase.from("projects").select("custom_fields").eq("id", projectId).maybeSingle();
  const raw = proj?.custom_fields?.__hero_project_id;
  const heroId = Number(raw);
  if (!Number.isFinite(heroId) || heroId <= 0) return null;
  return { apiKey, heroId };
}

async function heroAddLogbook(apiKey: string, heroProjectId: number, title: string, text: string): Promise<void> {
  const mutation = `mutation($projectId: Int!, $title: String!, $text: String) { add_logbook_entry(project_match_id: $projectId, custom_title: $title, custom_text: $text) { id } }`;
  try {
    await fetch(HERO_LOGBOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { projectId: heroProjectId, title: title.slice(0, 500), text: text ? text.slice(0, 5000) : null } }),
    });
  } catch { /* best-effort */ }
}

async function heroUploadDocument(
  apiKey: string,
  projectMatchId: number,
  blob: Blob,
  filename: string,
  documentTypeId: number | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const form = new FormData();
    form.append("file", blob, filename);
    const upResp = await fetch(HERO_UPLOAD_URL, {
      method: "POST",
      headers: { "x-auth-token": apiKey },
      body: form,
    });
    if (!upResp.ok) return { ok: false, error: `Upload HTTP ${upResp.status}` };
    const upText = await upResp.text();
    let uuid: string | undefined;
    try {
      const j = JSON.parse(upText);
      uuid = j.uuid ?? j.data?.uuid ?? j.file_upload_uuid;
    } catch { /* ignore */ }
    if (!uuid) return { ok: false, error: "Keine UUID in Upload-Antwort" };

    const doc: Record<string, unknown> = {};
    if (documentTypeId != null && Number.isFinite(documentTypeId)) {
      doc.document_type_id = documentTypeId;
    }
    const mutation = `
      mutation AssignDoc($doc: CustomerDocumentInput!, $uuid: String!, $targetId: Int!) {
        upload_document(document: $doc, file_upload_uuid: $uuid, target: project_match, target_id: $targetId) { id }
      }
    `;
    const r = await fetch(HERO_LOGBOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { doc, uuid, targetId: projectMatchId } }),
    });
    const data = await r.json();
    if (data.errors?.length) return { ok: false, error: data.errors.map((e: any) => e.message).join("; ") };
    const id = data?.data?.upload_document?.id;
    if (!id) return { ok: false, error: "Keine ID in Antwort" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

function detectImageType(bytes: Uint8Array): "jpg" | "png" | null {
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8) return "jpg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "png";
  return null;
}

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

async function generateProjectPdf(
  supabase: any,
  projectId: string,
  projectNumber: string,
  customerName: string,
  companyName: string,
): Promise<Uint8Array | null> {
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
    (fieldCfgRes.data || []).map((f: any) => [f.field_key, f.field_label as string])
  );
  const fieldOrder: string[] = (fieldCfgRes.data || []).map((f: any) => f.field_key as string);

  const locationIds = locations.map((l: any) => l.id as string);
  const { data: locImages } = await supabase
    .from("location_images")
    .select("location_id, storage_path")
    .in("location_id", locationIds)
    .eq("image_type", "annotated");

  const imagePathMap = new Map<string, string>(
    (locImages || []).map((img: any) => [img.location_id as string, img.storage_path as string])
  );

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Captfix – ${projectNumber} – Freigabe`);
  pdfDoc.setAuthor(companyName);

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const A4W = 595;
  const A4H = 842;
  const ML = 40; // left margin
  const MR = 40; // right margin
  const CW = A4W - ML - MR; // content width

  const BRAND = rgb(0.055, 0.451, 0.91);
  const BLACK = rgb(0.1, 0.1, 0.1);
  const GREY = rgb(0.45, 0.45, 0.45);
  const LIGHT = rgb(0.96, 0.96, 0.96);
  const WHITE = rgb(1, 1, 1);

  // ── Title page ────────────────────────────────────────────────────────────
  const tp = pdfDoc.addPage([A4W, A4H]);

  // top accent bar
  tp.drawRectangle({ x: 0, y: A4H - 8, width: A4W, height: 8, color: BRAND });

  // company name
  tp.drawText(companyName, { x: ML, y: A4H - 60, size: 22, font: fontBold, color: BRAND });

  // divider
  tp.drawLine({ start: { x: ML, y: A4H - 70 }, end: { x: A4W - MR, y: A4H - 70 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });

  // main title block
  tp.drawText("Freigabedokumentation", { x: ML, y: A4H - 110, size: 24, font: fontBold, color: BLACK });
  tp.drawText("Aufmaß · Captfix", { x: ML, y: A4H - 135, size: 13, font: fontReg, color: GREY });

  // info box
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

  // footer
  tp.drawText(`Erstellt von Captfix (captfix.app) am ${fmtDate(new Date())}`, {
    x: ML, y: 30, size: 8, font: fontReg, color: rgb(0.65, 0.65, 0.65),
  });

  // ── Location pages ────────────────────────────────────────────────────────
  for (const loc of locations) {
    const page = pdfDoc.addPage([A4W, A4H]);

    // header bar
    page.drawRectangle({ x: 0, y: A4H - 52, width: A4W, height: 52, color: BRAND });
    page.drawRectangle({ x: 0, y: A4H - 8, width: A4W, height: 8, color: rgb(0.02, 0.3, 0.7) });

    const locNum = loc.location_number ? `#${loc.location_number}` : "";
    const locName: string = loc.location_name || "";
    const headerLabel = [locNum, locName].filter(Boolean).join("  ·  ");
    page.drawText(headerLabel || "Standort", { x: ML, y: A4H - 34, size: 13, font: fontBold, color: WHITE });
    page.drawText(`Projekt ${projectNumber}`, { x: ML, y: A4H - 47, size: 8, font: fontReg, color: rgb(0.78, 0.88, 1) });

    let y = A4H - 72;

    // Collect fields to render
    const rows: [string, string][] = [];

    if (loc.system) rows.push(["System", String(loc.system)]);
    if (loc.label) rows.push(["Bezeichnung", String(loc.label)]);

    const cf: Record<string, any> = loc.custom_fields || {};
    for (const key of fieldOrder) {
      const val = cf[key];
      if (val == null || val === "") continue;
      const lbl = fieldLabels.get(key) || key;
      rows.push([lbl, String(val)]);
    }

    if (loc.comment) rows.push(["Hinweis", String(loc.comment)]);

    // Render fields as two-column rows
    const COL1 = 120; // label column width
    const ROW_H = 16;

    for (let ri = 0; ri < rows.length; ri++) {
      const [label, value] = rows[ri];
      if (y < 160) break; // leave room for image or footer
      // zebra-stripe background for readability
      if (ri % 2 === 0) {
        page.drawRectangle({ x: ML, y: y - 3, width: CW, height: ROW_H, color: LIGHT });
      }
      page.drawText(label + ":", { x: ML + 4, y: y + 2, size: 8, font: fontBold, color: GREY });
      // Truncate long values to one line
      let displayVal = value;
      while (displayVal.length > 1 && fontReg.widthOfTextAtSize(displayVal, 9) > CW - COL1 - 8) {
        displayVal = displayVal.slice(0, -1);
      }
      if (displayVal !== value) displayVal = displayVal.slice(0, -1) + "…";
      page.drawText(displayVal, { x: ML + COL1, y: y + 2, size: 9, font: fontReg, color: BLACK });
      y -= ROW_H;
    }

    y -= 8;

    // Try to embed annotated image
    const imgPath = imagePathMap.get(loc.id);
    if (imgPath) {
      const imgUrl = `${supabaseUrl}/storage/v1/object/public/project-files/${imgPath}`;
      try {
        const imgRes = await fetch(imgUrl);
        if (imgRes.ok) {
          const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
          const fmt = detectImageType(imgBytes);
          if (fmt) {
            const embedded = fmt === "jpg"
              ? await pdfDoc.embedJpg(imgBytes)
              : await pdfDoc.embedPng(imgBytes);

            // Scale to fit available space
            const maxImgW = CW;
            const maxImgH = Math.max(80, y - 40);
            const scale = Math.min(maxImgW / embedded.width, maxImgH / embedded.height, 1);
            const imgW = embedded.width * scale;
            const imgH = embedded.height * scale;
            const imgX = ML + (CW - imgW) / 2;
            const imgY = y - imgH;

            page.drawImage(embedded, { x: imgX, y: imgY, width: imgW, height: imgH });
          }
        }
      } catch { /* image unavailable – skip */ }
    }

    // page footer
    page.drawLine({
      start: { x: ML, y: 28 }, end: { x: A4W - MR, y: 28 },
      thickness: 0.5, color: rgb(0.85, 0.85, 0.85),
    });
    page.drawText(`${companyName} · Captfix · ${projectNumber}`, {
      x: ML, y: 16, size: 7, font: fontReg, color: rgb(0.65, 0.65, 0.65),
    });
    const pageNum = pdfDoc.getPageCount();
    page.drawText(`Seite ${pageNum}`, {
      x: A4W - MR - 30, y: 16, size: 7, font: fontReg, color: rgb(0.65, 0.65, 0.65),
    });
  }

  return pdfDoc.save();
}

/**
 * Customer activity notifications. Triggered from the customer-facing
 * approval/commenting flow. Three event types, each with its own
 * throttling logic - all driven from a single function so the throttle
 * decisions stay in one place.
 *
 * Events:
 *   - first_action: customer approved a location or wrote a comment for
 *     the first time on this assignment. Sent ONCE per assignment.
 *   - comment: a new comment was added. Sent at most once every 4 hours
 *     per assignment so a series of comments don't spam the team.
 *   - completion: all locations of the assignment are now approved.
 *     Sent each time the assignment transitions into the fully-approved
 *     state.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const COMMENT_THROTTLE_HOURS = 4;

type EventType = "first_action" | "comment" | "completion";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { event, assignmentId } = body as { event: EventType; assignmentId: string };

    if (!event || !assignmentId) {
      return json({ error: "event and assignmentId required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: assignment, error: aErr } = await supabase
      .from("customer_project_assignments")
      .select("id, customer_id, project_id, customers(name), projects(project_number)")
      .eq("id", assignmentId)
      .maybeSingle();

    if (aErr || !assignment) {
      return json({ error: "Assignment not found", details: aErr?.message }, 404);
    }

    const customerName = (assignment as any).customers?.name || "Unbekannter Kunde";
    const projectNumber = (assignment as any).projects?.project_number || "?";
    const projectId = (assignment as any).project_id;

    const { data: existing } = await supabase
      .from("customer_notifications")
      .select("*")
      .eq("assignment_id", assignmentId)
      .maybeSingle();

    const now = new Date();
    let shouldSend = false;
    const updateFields: Record<string, any> = {};

    if (event === "first_action") {
      return json({ skipped: true, reason: "first_action is no-op now" });
    } else if (event === "comment") {
      const last = existing?.last_comment_sent_at ? new Date(existing.last_comment_sent_at) : null;
      const throttleMs = COMMENT_THROTTLE_HOURS * 60 * 60 * 1000;
      if (!last || now.getTime() - last.getTime() > throttleMs) {
        shouldSend = true;
        updateFields.last_comment_sent_at = now.toISOString();
      }
    } else if (event === "completion") {
      const { data: projData } = await supabase
        .from("projects")
        .select("project_type")
        .eq("id", projectId)
        .maybeSingle();
      const projectType = (projData?.project_type as string) || "standort";
      const isVehicle = projectType.includes("fahrzeug");

      let isComplete = false;
      if (isVehicle) {
        const { data: vehicleApproval } = await supabase
          .from("vehicle_layout_approval")
          .select("approved")
          .eq("project_id", projectId)
          .eq("assignment_id", assignmentId)
          .maybeSingle();
        isComplete = !!vehicleApproval?.approved;
      } else {
        const { count: totalLocs } = await supabase
          .from("locations")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId);
        const { count: approvedCount } = await supabase
          .from("location_approvals")
          .select("id", { count: "exact", head: true })
          .eq("assignment_id", assignmentId)
          .eq("approved", true);
        isComplete = (totalLocs || 0) > 0 && (totalLocs || 0) === (approvedCount || 0);
      }

      if (isComplete && !existing?.completion_sent_at) {
        shouldSend = true;
        updateFields.completion_sent_at = now.toISOString();
      } else if (!isComplete && existing?.completion_sent_at) {
        await supabase.from("customer_notifications")
          .update({ completion_sent_at: null })
          .eq("assignment_id", assignmentId);
      }
    } else {
      return json({ error: `Unknown event type: ${event}` }, 400);
    }

    if (!shouldSend) {
      return json({ skipped: true, reason: "throttled or already sent" });
    }

    const [globalEmailRow, settingsRow, projectRow] = await Promise.all([
      supabase.from("app_config").select("value").eq("key", "notification_global_email").maybeSingle(),
      supabase.from("app_config").select("value").eq("key", "notification_settings").maybeSingle(),
      supabase.from("projects").select("employee_id").eq("id", projectId).maybeSingle(),
    ]);

    const globalEmail = (globalEmailRow.data?.value || "").trim();
    let parsedSettings: any = {};
    if (settingsRow.data?.value) {
      try { parsedSettings = JSON.parse(settingsRow.data.value) || {}; } catch { parsedSettings = {}; }
    }
    const eventSetting = parsedSettings[event] || { enabled: false, target: "global" };

    if (!eventSetting.enabled) {
      return json({ skipped: true, reason: "event disabled in settings" });
    }

    let recipientEmail: string | null = null;
    if (eventSetting.target === "assigned_employee" && projectRow.data?.employee_id) {
      const { data: emp } = await supabase
        .from("employees")
        .select("email")
        .eq("id", projectRow.data.employee_id)
        .maybeSingle();
      recipientEmail = (emp?.email || "").trim() || null;
    }
    if (!recipientEmail) {
      recipientEmail = globalEmail || null;
    }

    if (!recipientEmail) {
      return json({ skipped: true, reason: "no recipient configured" });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return json({ error: "RESEND_API_KEY not configured" }, 500);
    }

    const { subject, html } = buildMail(event, { customerName, projectNumber, projectId });

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Captfix <notifications@captfix.app>",
        to: [recipientEmail],
        subject,
        html,
      }),
    });
    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      return json({ error: "Mail-Versand fehlgeschlagen", details: errText }, 500);
    }

    await supabase.from("customer_notifications").upsert({
      assignment_id: assignmentId,
      ...updateFields,
    }, { onConflict: "assignment_id" });

    // On full approval: write HERO logbook entry + auto-upload approval PDF
    if (event === "completion") {
      try {
        const hctx = await heroContext(supabase, projectId);
        if (hctx) {
          await heroAddLogbook(
            hctx.apiKey, hctx.heroId,
            "Captfix: Freigabe durch Kunde",
            `${customerName} hat das Projekt ${projectNumber} vollständig freigegeben.`
          );

          // Resolve company name and document type from config
          const { data: cfgRows } = await supabase
            .from("app_config")
            .select("key, value")
            .in("key", ["legal_info", "hero_doc_type_aufmass_pdf"]);
          const cfgMap = new Map((cfgRows || []).map((r: any) => [r.key, r.value]));

          let companyName = "SL WERBUNG";
          const legalRaw = cfgMap.get("legal_info");
          if (legalRaw) {
            try {
              const info = JSON.parse(legalRaw);
              if (info?.companyName?.trim()) companyName = info.companyName.trim();
            } catch { /* keep default */ }
          }

          const docTypeRaw = cfgMap.get("hero_doc_type_aufmass_pdf");
          const docTypeId = docTypeRaw ? parseInt(String(docTypeRaw), 10) : null;

          const pdfBytes = await generateProjectPdf(
            supabase, projectId, projectNumber, customerName, companyName,
          );

          if (pdfBytes) {
            const safeNum = projectNumber.replace(/[^A-Za-z0-9-]/g, "_");
            const dateStr = fmtDate(new Date()).replace(/\./g, "-");
            const filename = `Captfix_Freigabe_${safeNum}_${dateStr}.pdf`;
            const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
            const uploadRes = await heroUploadDocument(
              hctx.apiKey, hctx.heroId, pdfBlob, filename,
              Number.isFinite(docTypeId as number) ? docTypeId : null,
            );
            if (!uploadRes.ok) {
              console.warn("HERO PDF upload failed:", uploadRes.error);
            }
          }
        }
      } catch (e) {
        console.warn("HERO completion tasks failed:", e);
      }
    }

    return json({ sent: true, event, recipient: recipientEmail });
  } catch (e: any) {
    console.error(e);
    return json({ error: "Server error", details: e.message }, 500);
  }
});

function buildMail(event: EventType, ctx: { customerName: string; projectNumber: string; projectId: string }): { subject: string; html: string } {
  const projectUrl = `https://captfix.app/projects/${ctx.projectId}`;
  const linkBlock = `<p style="margin-top:20px"><a href="${projectUrl}" style="background:#0E73E8;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:500">Projekt öffnen</a></p>`;
  const footer = `<hr style="margin:24px 0;border:none;border-top:1px solid #eee"><p style="color:#888;font-size:12px;margin:0">Diese Benachrichtigung wurde von Captfix automatisch erstellt.</p>`;

  if (event === "comment") {
    return {
      subject: `Neuer Kommentar: ${ctx.customerName} – Projekt ${ctx.projectNumber}`,
      html: `
        <h2 style="margin:0 0 12px">Neuer Kommentar im Projekt</h2>
        <p><strong>${escapeHtml(ctx.customerName)}</strong> hat in Projekt <strong>${escapeHtml(ctx.projectNumber)}</strong> einen Hinweis oder Kommentar hinterlassen.</p>
        <p style="color:#666;font-size:14px">Den Inhalt findest du im Projekt. Folgekommentare innerhalb der nächsten ${COMMENT_THROTTLE_HOURS} Stunden werden nicht erneut gemeldet.</p>
        ${linkBlock}
        ${footer}
      `,
    };
  }
  // completion
  return {
    subject: `FREIGEGEBEN: ${ctx.customerName} – Projekt ${ctx.projectNumber}`,
    html: `
      <h2 style="margin:0 0 12px;color:#0a8443">Projekt freigegeben</h2>
      <p style="font-size:16px"><strong>${escapeHtml(ctx.customerName)}</strong> hat das Projekt <strong>${escapeHtml(ctx.projectNumber)}</strong> komplett freigegeben.</p>
      <p>Das Projekt kann jetzt in Produktion gehen.</p>
      ${linkBlock}
      ${footer}
    `,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
