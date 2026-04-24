// Edge function: proxy single HERO upload (two-step: REST upload + GraphQL assign).
//
// Client POSTs multipart/form-data:
//   - file: the binary
//   - uploadType: "location_image" | "location_image_original" | "detail_image" | "detail_image_original" | "aufmass_pdf"
//   - heroProjectMatchId: the HERO project_match id (Int)
//   - filename: display name (optional, HERO generates one otherwise)
//
// We:
//   1) POST file to https://login.hero-software.de/app/v8/FileUploads/upload
//      with x-auth-token: <api_key>. Response has a uuid.
//   2) GraphQL mutation upload_image or upload_document to link it to the
//      project_match.
//
// On success returns { ok: true, heroFileId, uuid }.
// On failure returns { ok: false, error, step: "upload" | "assign" }.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HERO_UPLOAD_URL = "https://login.hero-software.de/app/v8/FileUploads/upload";
const HERO_GRAPHQL_URL = "https://login.hero-software.de/api/external/v7/graphql";

type UploadType =
  | "location_image"
  | "location_image_original"
  | "detail_image"
  | "detail_image_original"
  | "aufmass_pdf"
  | "vehicle_image"
  | "vehicle_layout"
  | "vehicle_measured_image"
  | "vehicle_measured_image_original";

// Which HERO mutation to use once the file is uploaded.
// PDFs and similar documents go via upload_document so HERO stores them
// as proper documents that can be previewed and downloaded. Images go
// via upload_image so they show in the project's image gallery.
// vehicle_layout is treated as a document since it's usually a PDF or
// non-photo design file; vehicle_image is a regular photo.
function isDocumentType(t: UploadType): boolean {
  return t === "aufmass_pdf" || t === "vehicle_layout";
}

async function heroUploadFile(apiKey: string, file: Blob, filename: string): Promise<{ ok: true; uuid: string } | { ok: false; error: string }> {
  try {
    const form = new FormData();
    form.append("file", file, filename);

    const resp = await fetch(HERO_UPLOAD_URL, {
      method: "POST",
      headers: { "x-auth-token": apiKey },
      body: form,
    });
    const text = await resp.text();
    console.log("HERO file-upload HTTP:", resp.status);
    console.log("HERO file-upload response:", text.slice(0, 800));

    if (!resp.ok) return { ok: false, error: `Upload HTTP ${resp.status}: ${text.slice(0, 300)}` };

    let uuid: string | undefined;
    try {
      const json = JSON.parse(text);
      uuid = json.uuid ?? json.data?.uuid ?? json.file_upload_uuid ?? json.file?.uuid;
    } catch {
      // HERO's response format isn't fully documented; parse loosely
    }
    if (!uuid) return { ok: false, error: "Keine UUID in Upload-Antwort: " + text.slice(0, 300) };
    return { ok: true, uuid };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function heroAssignImage(apiKey: string, uuid: string, projectMatchId: number): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // Note: `target: project_match` is an ENUM value, passed without quotes.
  // We don't use variables for it because HERO's introspection showed it
  // as LinkTargetEnum and mixing enums with GraphQL variables in a single
  // doc is awkward; inlining the enum is safest.
  const mutation = `
    mutation Assign($targetId: Int!, $uuid: String!) {
      upload_image(target: project_match, target_id: $targetId, file_upload_uuid: $uuid) { id }
    }
  `;
  try {
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: mutation, variables: { targetId: projectMatchId, uuid } }),
    });
    const text = await resp.text();
    console.log("HERO upload_image HTTP:", resp.status);
    console.log("HERO upload_image response:", text.slice(0, 800));

    if (!resp.ok) return { ok: false, error: `Assign HTTP ${resp.status}: ${text.slice(0, 300)}` };
    const result = JSON.parse(text);
    if (result.errors?.length) return { ok: false, error: result.errors.map((e: any) => e.message).join("; ") };
    const id = result?.data?.upload_image?.id;
    if (!id) return { ok: false, error: "Keine ID in Antwort: " + JSON.stringify(result.data).slice(0, 200) };
    return { ok: true, id: String(id) };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function heroAssignDocument(apiKey: string, uuid: string, projectMatchId: number, filename: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // upload_document needs a CustomerDocumentInput alongside the uuid.
  // Minimum shape is filename + project assignment. HERO auto-fills the
  // rest (upload date, size, detected mimetype).
  const mutation = `
    mutation AssignDoc($doc: CustomerDocumentInput!, $uuid: String!, $targetId: Int!) {
      upload_document(document: $doc, file_upload_uuid: $uuid, target: project_match, target_id: $targetId) { id }
    }
  `;
  try {
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          doc: { filename },
          uuid,
          targetId: projectMatchId,
        },
      }),
    });
    const text = await resp.text();
    console.log("HERO upload_document HTTP:", resp.status);
    console.log("HERO upload_document response:", text.slice(0, 800));

    if (!resp.ok) return { ok: false, error: `AssignDoc HTTP ${resp.status}: ${text.slice(0, 300)}` };
    const result = JSON.parse(text);
    if (result.errors?.length) return { ok: false, error: result.errors.map((e: any) => e.message).join("; ") };
    const id = result?.data?.upload_document?.id;
    if (!id) return { ok: false, error: "Keine ID in Antwort: " + JSON.stringify(result.data).slice(0, 200) };
    return { ok: true, id: String(id) };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Read HERO config
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: configRows } = await supabase
      .from("app_config")
      .select("key, value")
      .in("key", ["hero_api_key", "hero_enabled"]);
    const config = new Map((configRows || []).map((r: any) => [r.key, r.value]));
    const apiKey = config.get("hero_api_key");
    const heroEnabled = config.get("hero_enabled") === "true" && !!apiKey;

    if (!heroEnabled || !apiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "HERO-Integration ist nicht aktiv", step: "config" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse multipart form data
    const form = await req.formData();
    const file = form.get("file") as Blob | null;
    const uploadType = form.get("uploadType") as UploadType | null;
    const heroProjectMatchId = form.get("heroProjectMatchId") as string | null;
    const filename = (form.get("filename") as string | null) || "upload.bin";

    if (!file) {
      return new Response(JSON.stringify({ ok: false, error: "Kein File im Request", step: "input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!uploadType) {
      return new Response(JSON.stringify({ ok: false, error: "uploadType fehlt", step: "input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const projectMatchIdInt = parseInt(heroProjectMatchId || "0", 10);
    if (!projectMatchIdInt) {
      return new Response(JSON.stringify({ ok: false, error: "heroProjectMatchId fehlt oder ungültig", step: "input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`HERO-Upload: type=${uploadType} projectMatch=${projectMatchIdInt} filename=${filename} size=${file.size}`);

    // Step 1: upload file
    const uploadRes = await heroUploadFile(apiKey, file, filename);
    if (!uploadRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: uploadRes.error, step: "upload" }), {
        status: 200, // 200 with ok:false so the client's worker can handle retry decisions
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 2: assign to project_match (image or document mutation)
    const assign = isDocumentType(uploadType)
      ? await heroAssignDocument(apiKey, uploadRes.uuid, projectMatchIdInt, filename)
      : await heroAssignImage(apiKey, uploadRes.uuid, projectMatchIdInt);

    if (!assign.ok) {
      return new Response(JSON.stringify({ ok: false, error: assign.error, step: "assign", uuid: uploadRes.uuid }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, heroFileId: assign.id, uuid: uploadRes.uuid }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("hero-upload-proxy critical:", e);
    return new Response(JSON.stringify({ ok: false, error: e.message || String(e), step: "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
