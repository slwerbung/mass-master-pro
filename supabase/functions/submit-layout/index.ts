// Edge function: a customer uploads an existing layout (PDF) for their
// vehicle project, right after submitting the vehicle inquiry.
//
// Flow:
//   1. Validate: project must exist, file must be a PDF.
//   2. Store the PDF in Supabase Storage + a row in project_layouts.
//   3. If the project is linked to HERO, mirror the PDF into the HERO
//      project as a document (using the configured document_type_id for
//      "layout_pdf", falling back to no type if unset).
//
// This function uses the service role, so it works for the public
// (not-logged-in) customer who just filled in the inquiry form. We
// guard by requiring a valid project_id that actually exists; there's
// no auth token because the customer has none at this point.

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

function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return new Blob([dataUrl]);
  const bytes = atob(m[2]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Upload a document (PDF) to a HERO project_match. Two-step: REST upload
// for the UUID, then GraphQL upload_document with the document_type_id.
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

    // HERO requires a document_type_id for upload_document. If we don't
    // have one configured we still try without it - some HERO instances
    // accept it, others reject; the error surfaces in the response.
    const docInput: Record<string, unknown> = {
      target: "project_match",
      target_id: projectMatchId,
      file_upload_uuid: uuid,
      filename,
    };
    if (documentTypeId != null) docInput.document_type_id = documentTypeId;

    const mutation = `
      mutation Assign($input: CustomerDocumentInput!) {
        upload_document(customer_document: $input) { id }
      }
    `;
    const r = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { input: docInput } }),
    });
    const data = await r.json();
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
    const fileDataUrl = String(body.fileDataUrl || "");
    const filename = sanitizeFilename(String(body.filename || "layout.pdf"));

    if (!projectId) return json({ ok: false, error: "projectId fehlt" }, 400);
    if (!fileDataUrl.startsWith("data:application/pdf")) {
      return json({ ok: false, error: "Nur PDF-Dateien sind erlaubt" }, 400);
    }

    // Verify the project exists (basic guard for this public endpoint).
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, custom_fields")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr || !project) {
      return json({ ok: false, error: "Projekt nicht gefunden" }, 404);
    }

    const blob = dataUrlToBlob(fileDataUrl);
    // Hard cap ~25 MB to avoid runaway payloads.
    if (blob.size > 25 * 1024 * 1024) {
      return json({ ok: false, error: "Datei zu groß (max. 25 MB)" }, 400);
    }

    // 1. Store in Supabase Storage
    const path = `layouts/${projectId}/${Date.now()}_${filename}`;
    const { error: upErr } = await supabase.storage
      .from("project-files")
      .upload(path, blob, { contentType: "application/pdf" });
    if (upErr) {
      return json({ ok: false, error: "Storage-Upload fehlgeschlagen: " + upErr.message }, 500);
    }

    // 2. Track it in project_layouts (best-effort; table may need creating)
    try {
      await supabase.from("project_layouts").insert({
        project_id: projectId,
        storage_path: path,
        file_name: body.filename || filename,
        uploaded_by: "Kunde",
      });
    } catch (e) {
      console.warn("project_layouts insert failed (table missing?)", e);
    }

    // 3. Mirror to HERO if linked
    let heroResult: { ok: boolean; error?: string } | null = null;
    const heroProjectId = Number((project as any).custom_fields?.__hero_project_id);
    if (Number.isFinite(heroProjectId) && heroProjectId > 0) {
      const { data: cfg } = await supabase
        .from("app_config")
        .select("key, value")
        .in("key", ["hero_api_key", "hero_enabled", "hero_doc_type_layout_pdf"]);
      const config = new Map((cfg || []).map((r: any) => [r.key, r.value]));
      const heroEnabled = config.get("hero_enabled") === "true";
      const apiKey = config.get("hero_api_key");
      const docTypeRaw = config.get("hero_doc_type_layout_pdf");
      const docTypeId = docTypeRaw ? parseInt(String(docTypeRaw), 10) : null;

      if (heroEnabled && apiKey) {
        heroResult = await heroUploadDocument(
          apiKey,
          heroProjectId,
          blob,
          filename,
          Number.isFinite(docTypeId as number) ? docTypeId : null,
        );
        if (!heroResult.ok) console.warn("HERO layout upload failed:", heroResult.error);
      }
    }

    return json({
      ok: true,
      storagePath: path,
      hero: heroResult,
    });
  } catch (e: any) {
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
});
