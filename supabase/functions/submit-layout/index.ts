// Edge function: a customer uploads layout file(s) for their vehicle project.
//
// Flow:
//   1. Accept either a `files` array (new) or a single `fileDataUrl` (legacy).
//   2. Validate each file: allowed MIME type, max 25 MB.
//   3. Verify the project exists.
//   4. Store all files in Supabase Storage + rows in project_layouts.
//   5. If the project is linked to HERO, mirror each file as a document.
//   6. If a comment was provided, add a HERO logbook entry.
//
// Uses service role — no auth token required. The public customer who just
// submitted a vehicle inquiry has no session.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HERO_GRAPHQL_URL = "https://login.hero-software.de/api/external/v9/graphql";
const HERO_UPLOAD_URL = "https://login.hero-software.de/app/v8/FileUploads/upload";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/postscript", // .ai / .eps
]);

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

function mimeFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;]+);/.exec(dataUrl);
  return m ? m[1] : "application/octet-stream";
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
    const r = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: mutation,
        variables: { doc, uuid, targetId: projectMatchId },
      }),
    });
    const data = await r.json();
    if (data.errors?.length) return { ok: false, error: data.errors.map((e: any) => e.message).join("; ") };
    const id = data?.data?.upload_document?.id;
    if (!id) return { ok: false, error: "Keine ID in Antwort: " + JSON.stringify(data).slice(0, 200) };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function heroAddLogbookEntry(
  apiKey: string,
  projectMatchId: number,
  title: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const mutation = `
      mutation($projectId: Int!, $title: String!, $text: String) {
        add_logbook_entry(project_match_id: $projectId, custom_title: $title, custom_text: $text) { id }
      }
    `;
    const r = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: mutation,
        variables: { projectId: projectMatchId, title: title.slice(0, 500), text: text.slice(0, 5000) },
      }),
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
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";

    if (!projectId) return json({ ok: false, error: "projectId fehlt" }, 400);

    // Normalize to a unified list of {dataUrl, filename} entries.
    // New callers send body.files (array); the legacy single-file path
    // used body.fileDataUrl / body.filename.
    let fileEntries: { dataUrl: string; filename: string }[];
    if (Array.isArray(body.files) && body.files.length > 0) {
      fileEntries = body.files.map((f: any) => ({
        dataUrl: String(f.dataUrl || ""),
        filename: sanitizeFilename(String(f.filename || "datei")),
      }));
    } else if (body.fileDataUrl) {
      fileEntries = [{
        dataUrl: String(body.fileDataUrl),
        filename: sanitizeFilename(String(body.filename || "layout.pdf")),
      }];
    } else {
      return json({ ok: false, error: "Keine Dateien angegeben" }, 400);
    }

    // Validate all files before touching storage.
    for (const entry of fileEntries) {
      const mime = mimeFromDataUrl(entry.dataUrl);
      if (!ALLOWED_MIME_TYPES.has(mime)) {
        return json({ ok: false, error: `Dateityp nicht erlaubt: ${mime} (${entry.filename})` }, 400);
      }
      const blob = dataUrlToBlob(entry.dataUrl);
      if (blob.size > 25 * 1024 * 1024) {
        return json({ ok: false, error: `Datei zu groß (max. 25 MB): ${entry.filename}` }, 400);
      }
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

    // Upload all files.
    const storedPaths: string[] = [];
    for (const entry of fileEntries) {
      const blob = dataUrlToBlob(entry.dataUrl);
      const mime = mimeFromDataUrl(entry.dataUrl);
      const path = `layouts/${projectId}/${Date.now()}_${entry.filename}`;
      const { error: upErr } = await supabase.storage
        .from("project-files")
        .upload(path, blob, { contentType: mime });
      if (upErr) {
        return json({
          ok: false,
          error: `Storage-Upload fehlgeschlagen (${entry.filename}): ${upErr.message}`,
        }, 500);
      }
      storedPaths.push(path);

      try {
        await supabase.from("project_layouts").insert({
          project_id: projectId,
          storage_path: path,
          file_name: entry.filename,
          comment: comment || null,
          uploaded_by: "Kunde",
        });
      } catch (e) {
        console.warn("project_layouts insert failed:", e);
      }
    }

    // Mirror to HERO if the project is linked.
    let heroWarning: string | undefined;
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
        const heroErrors: string[] = [];
        for (const entry of fileEntries) {
          const blob = dataUrlToBlob(entry.dataUrl);
          const mime = mimeFromDataUrl(entry.dataUrl);
          const typedBlob = new Blob([blob], { type: mime });
          const res = await heroUploadDocument(
            apiKey, heroProjectId, typedBlob, entry.filename,
            Number.isFinite(docTypeId as number) ? docTypeId : null,
          );
          if (!res.ok) {
            console.warn("HERO layout upload failed:", res.error);
            heroErrors.push(`${entry.filename}: ${res.error}`);
          }
        }
        if (heroErrors.length > 0) {
          heroWarning = `Layout gespeichert, HERO-Upload teilweise fehlgeschlagen: ${heroErrors.join("; ")}`;
        }

        // Add customer comment as a HERO logbook entry.
        if (comment) {
          const logRes = await heroAddLogbookEntry(
            apiKey, heroProjectId,
            "Kommentar zum Layout (Kunde)",
            comment,
          );
          if (!logRes.ok) {
            console.warn("HERO logbook entry failed:", logRes.error);
          }
        }
      }
    }

    return json({ ok: true, storagePaths: storedPaths, heroWarning });
  } catch (e: any) {
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
});
