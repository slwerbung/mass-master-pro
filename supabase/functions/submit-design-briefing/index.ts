// Stores a vehicle-branding design briefing (from the /gestaltung
// configurator) in Supabase AND mirrors the human-readable text into the
// HERO project's partner_notes. Inspiration uploads (if any) are stored
// in Supabase Storage.
//
// Service-role + reads HERO key from app_config (the customer isn't
// logged in). Mirrors the proven pattern of submit-layout /
// update-hero-notes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HERO_GRAPHQL_URL = "https://login.hero-software.de/api/external/v7/graphql";
const HERO_UPLOAD_URL = "https://login.hero-software.de/app/v8/FileUploads/upload";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return { blob: new Blob([dataUrl]), ext: "bin" };
  const mime = m[1];
  const bytes = atob(m[2]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  return { blob: new Blob([arr], { type: mime }), ext };
}

// Uploads one inspiration file to the HERO project. Two-step: multipart
// upload → UUID, then assign. Images go via upload_image (no doc type
// needed), PDFs via upload_document (needs document_type_id - we reuse
// the layout_pdf type if configured, else skip the type and let HERO
// decide). Mirrors the proven hero-upload-proxy flow.
async function heroUploadInspiration(
  apiKey: string,
  heroProjectId: number,
  blob: Blob,
  filename: string,
  isPdf: boolean,
  layoutDocTypeId: number | null,
  imageCategory: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Step 1: multipart upload → uuid
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
      uuid = j.data?.uuid ?? j.uuid ?? j.file_upload_uuid;
    } catch { /* ignore */ }
    if (!uuid) return { ok: false, error: "Keine UUID" };

    // Step 2: assign
    let mutation: string;
    let variables: Record<string, unknown>;
    if (isPdf) {
      const doc: Record<string, unknown> = {};
      if (layoutDocTypeId != null && Number.isFinite(layoutDocTypeId)) doc.document_type_id = layoutDocTypeId;
      mutation = `mutation($doc: CustomerDocumentInput!, $uuid: String!, $tid: Int!) {
        upload_document(document: $doc, file_upload_uuid: $uuid, target: project_match, target_id: $tid) { id }
      }`;
      variables = { doc, uuid, tid: heroProjectId };
    } else {
      mutation = `mutation($uuid: String!, $tid: Int!) {
        upload_image(file_upload_uuid: $uuid, target: project_match, target_id: $tid) { id }
      }`;
      variables = { uuid, tid: heroProjectId };
    }
    const r = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const data = await r.json();
    if (data.errors?.length) return { ok: false, error: data.errors.map((e: any) => e.message).join("; ") };

    // For images, optionally tag with the configured HERO image category
    // (best-effort). PDFs use document types, not image categories.
    if (!isPdf && imageCategory && String(imageCategory).trim() !== "") {
      const newId = data?.data?.upload_image?.id;
      if (newId) {
        try {
          const catMut = `mutation($id: Int!, $cat: String!) {
            update_file_upload(id: $id, image_category: $cat) { id }
          }`;
          await fetch(HERO_GRAPHQL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ query: catMut, variables: { id: parseInt(String(newId), 10), cat: imageCategory } }),
          });
        } catch (catErr) {
          console.warn("inspiration image-category set failed", catErr);
        }
      }
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Append the design briefing to the project's partner_notes. We read the
// current notes first so we don't clobber the area-measurement summary
// that may already be there - we append a clearly delimited section.
async function appendHeroNotes(apiKey: string, heroProjectId: number, briefingText: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // Read existing notes
    const readQ = `query($ids: [Int]) { project_matches(ids: $ids) { id partner_notes } }`;
    const readResp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: readQ, variables: { ids: [heroProjectId] } }),
    });
    const readData = await readResp.json();
    const existing = readData?.data?.project_matches?.[0]?.partner_notes || "";

    // Replace any prior briefing block, then append the fresh one, so
    // re-runs don't stack duplicates.
    const marker = "=== GESTALTUNGS-BRIEFING";
    let base = existing;
    const idx = existing.indexOf(marker);
    if (idx >= 0) base = existing.slice(0, idx).trimEnd();
    const combined = (base ? base + "\n\n" : "") + briefingText;

    const mutation = `
      mutation($pm: ProjectMatchInput) {
        update_project_match(project_match: $pm) { id }
      }
    `;
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: mutation,
        variables: { pm: { id: heroProjectId, partner_notes: combined.slice(0, 50000) } },
      }),
    });
    const data = await resp.json();
    if (data.errors?.length) return { ok: false, error: data.errors.map((e: any) => e.message).join("; ") };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json();
    const projectId = String(body.projectId || "").trim();
    const heroProjectId = body.heroProjectId ? Number(body.heroProjectId) : null;
    const briefingText = String(body.briefingText || "");
    const briefing = body.briefing ?? {};
    const inspiration = Array.isArray(body.inspiration) ? body.inspiration : [];

    if (!projectId) return json({ ok: false, error: "projectId fehlt" }, 400);

    // Verify project exists
    const { data: project } = await supabase
      .from("projects").select("id, custom_fields").eq("id", projectId).maybeSingle();
    if (!project) return json({ ok: false, error: "Projekt nicht gefunden" }, 404);

    // 1. Upload inspiration files to storage (keep blobs for HERO too)
    const uploadedPaths: string[] = [];
    const keptFiles: { blob: Blob; ext: string; name: string }[] = [];
    for (let i = 0; i < inspiration.length && i < 5; i++) {
      const item = inspiration[i];
      if (!item?.dataUrl) continue;
      const { blob, ext } = dataUrlToBlob(item.dataUrl);
      if (blob.size > 15 * 1024 * 1024) continue; // 15MB cap each
      const path = `design-briefings/${projectId}/${Date.now()}_${i}.${ext}`;
      const { error: upErr } = await supabase.storage.from("project-files").upload(path, blob, { contentType: blob.type });
      if (!upErr) {
        uploadedPaths.push(path);
        keptFiles.push({ blob, ext, name: item.name || `inspiration-${i + 1}.${ext}` });
      }
    }

    // 2. Store the briefing row (best-effort; table may need creating)
    try {
      await supabase.from("vehicle_design_briefings").insert({
        project_id: projectId,
        variant: briefing.variant ?? null,
        priorities: briefing.priorities ?? [],
        additional_content: briefing.additionalContent ?? [],
        comparison: briefing.comparison ?? null,
        no_gos: briefing.noGos ?? [],
        analysis: briefing.analysis ?? {},
        briefing_text: briefingText,
        inspiration_paths: uploadedPaths,
      });
    } catch (e) {
      console.warn("vehicle_design_briefings insert failed (table missing?)", e);
    }

    // 3. Mirror to HERO if linked + enabled: briefing text → partner_notes,
    //    inspiration files → uploaded into the HERO project.
    let heroResult: { ok: boolean; error?: string } | null = null;
    let heroFilesUploaded = 0;
    const linkedHeroId = heroProjectId || Number((project as any).custom_fields?.__hero_project_id) || null;
    if (linkedHeroId && Number.isFinite(linkedHeroId)) {
      const { data: cfg } = await supabase
        .from("app_config").select("key, value").in("key", ["hero_api_key", "hero_enabled", "hero_doc_type_layout_pdf", "hero_img_cat_design_inspiration"]);
      const config = new Map((cfg || []).map((r: any) => [r.key, r.value]));
      const apiKey = config.get("hero_api_key");
      const heroEnabled = config.get("hero_enabled") === "true";
      const layoutDocRaw = config.get("hero_doc_type_layout_pdf");
      const layoutDocTypeId = layoutDocRaw ? parseInt(String(layoutDocRaw), 10) : null;
      const imgCatRaw = config.get("hero_img_cat_design_inspiration");
      const inspirationCategory = (imgCatRaw && String(imgCatRaw).trim() !== "") ? String(imgCatRaw) : null;

      if (heroEnabled && apiKey) {
        // Notes
        heroResult = await appendHeroNotes(apiKey, linkedHeroId, briefingText);
        if (!heroResult.ok) console.warn("HERO briefing notes failed:", heroResult.error);

        // Inspiration files into the HERO project
        for (const f of keptFiles) {
          const isPdf = f.ext === "pdf";
          const res = await heroUploadInspiration(
            apiKey, linkedHeroId, f.blob, `Inspiration_${f.name}`, isPdf, layoutDocTypeId, inspirationCategory,
          );
          if (res.ok) heroFilesUploaded++;
          else console.warn("HERO inspiration upload failed:", res.error);
        }
      }
    }

    return json({ ok: true, inspirationCount: uploadedPaths.length, heroFilesUploaded, hero: heroResult });
  } catch (e: any) {
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
});
