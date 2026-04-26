// Edge function: submit a vehicle inquiry from a customer-facing form.
//
// Flow:
// 1. Validate input + spam-check (honeypot field)
// 2. Look up email in HERO contacts (only if HERO active)
//    - found:   use existing customer_id
//    - missing: if signup data provided -> create new customer
//                else: return needs_signup so the form can show extra fields
// 3. Create app project (Supabase) and HERO project_match (if HERO active)
// 4. Upload images to Supabase Storage and mirror them to HERO
// 5. Send notification email to info@slwerbung.de via Resend
//
// All HERO operations are best-effort: if HERO breaks halfway, we still
// finalize the local project and notify, so no inquiries get lost.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HERO_GRAPHQL_URL = "https://login.hero-software.de/api/external/v7/graphql";
const HERO_UPLOAD_URL = "https://login.hero-software.de/app/v8/FileUploads/upload";

interface FormData {
  email: string;
  vehicleFields: Record<string, string>; // dynamic fields from vehicle_field_config
  // signupData is sent on the second submit when HERO didn't find the email
  signupData?: {
    salutation?: string;
    firstName?: string;
    lastName: string;
    companyName?: string;
    legalForm?: string;
    phone?: string;
    mobile?: string;
    street?: string;
    zip?: string;
    city?: string;
  };
  // Images come up as base64-encoded data URLs - the form compresses
  // them in the browser before sending so payload stays manageable.
  images: { dataUrl: string; filename: string }[];
  // Honeypot - real humans never fill this in
  website?: string;
}

// ---- HERO operations ----

async function heroSearchContactByEmail(apiKey: string, email: string): Promise<{ id: number; isContactPerson: boolean; parentCustomerId: number } | null> {
  // contacts(search) does substring matching across fields. We additionally
  // filter the response to require an exact email hit, since "info@x.de"
  // matched against name fields could otherwise return false positives.
  const query = `
    query Search($search: String) {
      contacts(search: $search) {
        id
        email
        is_contact_person
        parent_customer_id
      }
    }
  `;
  try {
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables: { search: email } }),
    });
    const data = await resp.json();
    const contacts = data?.data?.contacts || [];
    const hit = contacts.find((c: any) => (c.email || "").toLowerCase() === email.toLowerCase());
    if (!hit) return null;
    return {
      id: hit.id,
      isContactPerson: !!hit.is_contact_person,
      parentCustomerId: hit.parent_customer_id || 0,
    };
  } catch (e) {
    console.warn("heroSearchContactByEmail failed", e);
    return null;
  }
}

async function heroCreateContact(apiKey: string, signup: NonNullable<FormData["signupData"]>, email: string): Promise<{ id: number } | { error: string }> {
  const hasCompany = !!signup.companyName?.trim();
  const contact: any = {
    type: hasCompany ? "commercial" : "private",
    is_contact_person: !hasCompany,
    first_name: signup.firstName || null,
    last_name: signup.lastName,
    company_name: signup.companyName || null,
    company_legal_form: signup.legalForm || null,
    title: signup.salutation || null,
    email,
    phone_home: signup.phone || null,
    phone_mobile: signup.mobile || null,
    category: "customer",
    source: "Fahrzeug-Anfrage Website",
  };
  if (signup.street || signup.zip || signup.city) {
    contact.address = {
      street: signup.street || null,
      zip: signup.zip || null,
      city: signup.city || null,
    };
  }
  const mutation = `
    mutation Create($contact: CustomerInput, $findExisting: Boolean) {
      create_contact(contact: $contact, findExisting: $findExisting) { id }
    }
  `;
  try {
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { contact, findExisting: true } }),
    });
    const data = await resp.json();
    if (data.errors?.length) return { error: data.errors.map((e: any) => e.message).join("; ") };
    const id = data?.data?.create_contact?.id;
    if (!id) return { error: "Keine ID in HERO-Antwort" };
    return { id: parseInt(String(id), 10) };
  } catch (e: any) {
    return { error: e.message || String(e) };
  }
}

async function heroCreateProject(apiKey: string, customerId: number, projectTitle: string, projectNr: string): Promise<{ id: number } | { error: string }> {
  const projectMatch: any = {
    customer_id: customerId,
    project_title: projectTitle,
    project_nr: projectNr,
    partner_source: "Fahrzeug-Anfrage Website",
  };
  const mutation = `
    mutation CreateProject($project_match: ProjectMatchInput) {
      create_project_match(project_match: $project_match) { id }
    }
  `;
  try {
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { project_match: projectMatch } }),
    });
    const data = await resp.json();
    if (data.errors?.length) return { error: data.errors.map((e: any) => e.message).join("; ") };
    const id = data?.data?.create_project_match?.id;
    if (!id) return { error: "Keine ID in HERO-Projekt-Antwort" };
    return { id: parseInt(String(id), 10) };
  } catch (e: any) {
    return { error: e.message || String(e) };
  }
}

async function heroUploadImage(apiKey: string, projectMatchId: number, imageBlob: Blob, filename: string): Promise<{ ok: boolean; error?: string }> {
  // Two-step: REST upload to get UUID, then GraphQL upload_image mutation
  try {
    const form = new FormData();
    form.append("file", imageBlob, filename);
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
    } catch {}
    if (!uuid) return { ok: false, error: "Keine UUID in Upload-Antwort" };

    const mutation = `
      mutation Assign($targetId: Int!, $uuid: String!) {
        upload_image(target: project_match, target_id: $targetId, file_upload_uuid: $uuid) { id }
      }
    `;
    const r = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { targetId: projectMatchId, uuid } }),
    });
    const data = await r.json();
    if (data.errors?.length) return { ok: false, error: data.errors.map((e: any) => e.message).join("; ") };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ---- Helpers ----

function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return new Blob([dataUrl]);
  const bytes = atob(m[2]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}

async function sendNotificationEmail(opts: {
  resendApiKey: string;
  email: string;
  vehicleFields: Record<string, string>;
  fieldLabels: Record<string, string>;
  signupData?: FormData["signupData"];
  imageCount: number;
  projectId: string;
  projectNumber: string;
  heroProjectId: number | null;
  heroError: string | null;
}) {
  const fieldRows = Object.entries(opts.vehicleFields)
    .filter(([_, v]) => v && v.trim())
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${opts.fieldLabels[k] || k}</td><td>${escapeHtml(v)}</td></tr>`)
    .join("");

  const signupBlock = opts.signupData
    ? `<h3 style="margin-top:24px">Neukunde</h3>
       <table>
         ${row("Anrede", opts.signupData.salutation)}
         ${row("Vorname", opts.signupData.firstName)}
         ${row("Nachname", opts.signupData.lastName)}
         ${row("Firma", opts.signupData.companyName)}
         ${row("Rechtsform", opts.signupData.legalForm)}
         ${row("Telefon", opts.signupData.phone)}
         ${row("Mobil", opts.signupData.mobile)}
         ${row("Straße", opts.signupData.street)}
         ${row("PLZ", opts.signupData.zip)}
         ${row("Ort", opts.signupData.city)}
       </table>`
    : "";

  const heroBlock = opts.heroProjectId
    ? `<p style="color:#0a0;margin-top:16px">✓ HERO-Projekt angelegt: ID ${opts.heroProjectId}</p>`
    : opts.heroError
    ? `<p style="background:#fff3cd;padding:12px;border-radius:6px;color:#856404">⚠ HERO-Anlage fehlgeschlagen: ${escapeHtml(opts.heroError)}<br>App-Projekt wurde trotzdem angelegt.</p>`
    : "";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
      <h2 style="color:#1976d2">Neue Fahrzeug-Anfrage</h2>
      <p><strong>${escapeHtml(opts.email)}</strong> hat eine Anfrage über das Formular gesendet.</p>
      ${heroBlock}
      <h3 style="margin-top:24px">Projekt</h3>
      <table>
        ${row("Projektnummer", opts.projectNumber)}
        ${row("Bilder", String(opts.imageCount))}
      </table>
      <h3 style="margin-top:24px">Fahrzeug-Daten</h3>
      <table>${fieldRows}</table>
      ${signupBlock}
      <p style="margin-top:24px;color:#666;font-size:12px">Diese Mail wurde automatisch generiert von Mass Master Pro.</p>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.resendApiKey}` },
    body: JSON.stringify({
      from: "Mass Master Pro <onboarding@resend.dev>",
      to: ["info@slwerbung.de"],
      subject: `Fahrzeug-Anfrage: ${opts.email}`,
      html,
    }),
  });
}

function row(label: string, value: any): string {
  if (!value) return "";
  return `<tr><td style="padding:4px 12px 4px 0;color:#666">${label}</td><td>${escapeHtml(String(value))}</td></tr>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ---- Main handler ----

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body: FormData = await req.json();

    // Honeypot - bots tend to fill all fields
    if (body.website) {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Basic validation
    if (!body.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email.trim())) {
      return new Response(JSON.stringify({ ok: false, error: "Ungültige E-Mail-Adresse" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read config: HERO + Resend
    const { data: configRows } = await supabase
      .from("app_config")
      .select("key, value")
      .in("key", ["hero_api_key", "hero_enabled", "resend_api_key"]);
    const cfg = new Map((configRows || []).map((r: any) => [r.key, r.value]));
    const heroApiKey = cfg.get("hero_api_key");
    const heroEnabled = cfg.get("hero_enabled") === "true" && !!heroApiKey;
    const resendApiKey = cfg.get("resend_api_key");

    // Read vehicle field labels for the notification email
    const { data: fieldConfigs } = await supabase
      .from("vehicle_field_config")
      .select("field_key, field_label")
      .eq("is_active", true);
    const fieldLabels: Record<string, string> = {};
    (fieldConfigs || []).forEach((f: any) => { fieldLabels[f.field_key] = f.field_label; });

    // ---- HERO contact match (if enabled) ----
    let heroCustomerId: number | null = null;
    let heroError: string | null = null;

    if (heroEnabled) {
      const match = await heroSearchContactByEmail(heroApiKey, body.email.trim());
      if (match) {
        heroCustomerId = match.id;
      } else {
        // No HERO match. We need signup data to create a new customer.
        if (!body.signupData?.lastName) {
          return new Response(JSON.stringify({ ok: false, needs_signup: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const created = await heroCreateContact(heroApiKey, body.signupData, body.email.trim());
        if ("error" in created) {
          heroError = `Kontakt-Anlage: ${created.error}`;
        } else {
          heroCustomerId = created.id;
        }
      }
    }

    // ---- Create app project ----
    // Generate next project number. Simple lookup of max numeric suffix from
    // existing projects starting with "WER-". Not bullet-proof against parallel
    // submits but good enough for a low-volume web form.
    const { data: latestProjects } = await supabase
      .from("projects")
      .select("project_number")
      .ilike("project_number", "WER-%")
      .order("project_number", { ascending: false })
      .limit(50);
    let nextNumber = 1;
    for (const p of latestProjects || []) {
      const m = /^WER-(\d+)/.exec(p.project_number);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= nextNumber) nextNumber = n + 1;
      }
    }
    const projectNumber = `WER-${nextNumber}`;

    // ---- HERO project (if customer matched/created) ----
    let heroProjectId: number | null = null;
    if (heroEnabled && heroCustomerId) {
      const projTitle = `Fahrzeugbeschriftung ${projectNumber}`;
      const result = await heroCreateProject(heroApiKey, heroCustomerId, projTitle, projectNumber);
      if ("error" in result) {
        heroError = `Projekt-Anlage: ${result.error}`;
      } else {
        heroProjectId = result.id;
      }
    }

    // Build customFields with HERO link if present
    const customFields: Record<string, string> = {};
    if (heroProjectId) {
      customFields.__hero_project_id = String(heroProjectId);
      customFields.__hero_project_nr = projectNumber;
    }

    const { data: project, error: projError } = await supabase
      .from("projects")
      .insert({
        project_number: projectNumber,
        project_type: "fahrzeugbeschriftung",
        customer_name: body.signupData
          ? [body.signupData.firstName, body.signupData.lastName].filter(Boolean).join(" ") || body.signupData.companyName || null
          : null,
        custom_fields: customFields,
      })
      .select()
      .single();

    if (projError || !project) {
      return new Response(JSON.stringify({ ok: false, error: "Projekt-Anlage fehlgeschlagen: " + (projError?.message || "unknown") }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Vehicle field values ----
    const fieldRows = Object.entries(body.vehicleFields || {})
      .filter(([_, v]) => v && v.trim())
      .map(([k, v]) => ({ project_id: project.id, field_key: k, value: v }));
    if (fieldRows.length) {
      await supabase.from("vehicle_field_values").insert(fieldRows);
    }

    // ---- Image upload ----
    const uploadedImagePaths: string[] = [];
    for (let i = 0; i < (body.images || []).length; i++) {
      const img = body.images[i];
      try {
        const blob = dataUrlToBlob(img.dataUrl);
        const ext = img.filename.match(/\.[^.]+$/)?.[0] || ".jpg";
        const path = `vehicle-images/${project.id}/${crypto.randomUUID()}${ext}`;
        const { error: upErr } = await supabase.storage
          .from("project-files")
          .upload(path, blob, { contentType: blob.type || "image/jpeg" });
        if (upErr) {
          console.warn(`Image ${i} upload failed:`, upErr);
          continue;
        }
        await supabase.from("vehicle_images").insert({
          project_id: project.id,
          storage_path: path,
          uploaded_by: "Kunde",
        });
        uploadedImagePaths.push(path);

        // Mirror to HERO
        if (heroEnabled && heroProjectId) {
          const heroResult = await heroUploadImage(heroApiKey, heroProjectId, blob, `fahrzeug-${img.filename}`);
          if (!heroResult.ok) console.warn("HERO image upload failed:", heroResult.error);
        }
      } catch (e: any) {
        console.warn(`Image ${i} processing error:`, e.message);
      }
    }

    // ---- Notification email ----
    if (resendApiKey) {
      try {
        await sendNotificationEmail({
          resendApiKey,
          email: body.email.trim(),
          vehicleFields: body.vehicleFields,
          fieldLabels,
          signupData: body.signupData,
          imageCount: uploadedImagePaths.length,
          projectId: project.id,
          projectNumber,
          heroProjectId,
          heroError,
        });
      } catch (e) {
        console.warn("Email notification failed:", e);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        project_id: project.id,
        project_number: projectNumber,
        hero_project_id: heroProjectId,
        hero_error: heroError,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("submit-vehicle-request critical:", e);
    return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
