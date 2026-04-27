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

async function heroFetchContact(apiKey: string, contactId: number): Promise<{ id: number; displayName: string } | null> {
  // Fetch a single contact by id - used to load the company record after
  // we matched a contact person and need the firm's display name.
  const query = `
    query Get($ids: [Int]) {
      contacts(ids: $ids) {
        id
        full_name
        company_name
        first_name
        last_name
      }
    }
  `;
  try {
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables: { ids: [contactId] } }),
    });
    const data = await resp.json();
    const hit = data?.data?.contacts?.[0];
    if (!hit) return null;
    const displayName =
      hit.company_name ||
      hit.full_name ||
      [hit.first_name, hit.last_name].filter(Boolean).join(" ") ||
      "";
    return { id: hit.id, displayName };
  } catch (e) {
    console.warn("heroFetchContact failed", e);
    return null;
  }
}

async function heroSearchContactByEmail(apiKey: string, email: string): Promise<{ id: number; isContactPerson: boolean; parentCustomerId: number; displayName: string } | null> {
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
        full_name
        company_name
        first_name
        last_name
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
    // Pick the most useful display name: full_name if HERO computed one,
    // else company_name, else assembled first+last.
    const displayName =
      hit.full_name ||
      hit.company_name ||
      [hit.first_name, hit.last_name].filter(Boolean).join(" ") ||
      "";
    return {
      id: hit.id,
      isContactPerson: !!hit.is_contact_person,
      parentCustomerId: hit.parent_customer_id || 0,
      displayName,
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

// HERO Lead API endpoint - much simpler than GraphQL create_project_match.
// HERO docs: https://support.hero-software.de/.../Lead-API
// This single endpoint handles email matching, customer creation if needed,
// and project creation in one shot. We use it instead of the GraphQL path
// because GraphQL create_project_match requires internal IDs we don't
// reliably know and threw "InvalidPrimaryKeyException" with various combos.
const HERO_LEAD_URL = "https://login.hero-software.de/api/v1/Projects/create";

// Measure short code: shows up in HERO project numbers as e.g. "WER-1640".
// We use "WER" (Werbetechnik) since it's the only Gewerk this account has.
const HERO_MEASURE_SHORT = "WER";

async function heroCreateProjectViaLeadAPI(apiKey: string, opts: {
  email: string;
  signupData?: FormData["signupData"];
  partnerNotes?: string;
}): Promise<{ id: number | null; nr: string; ok: boolean; raw: any }> {
  const customer: any = { email: opts.email };
  let address: any = null;
  if (opts.signupData) {
    if (opts.signupData.salutation) customer.title = opts.signupData.salutation;
    if (opts.signupData.firstName) customer.first_name = opts.signupData.firstName;
    if (opts.signupData.lastName) customer.last_name = opts.signupData.lastName;
    if (opts.signupData.companyName) customer.company_name = opts.signupData.companyName;
    if (opts.signupData.phone) customer.phone_home = opts.signupData.phone;
    if (opts.signupData.mobile) customer.phone_mobile = opts.signupData.mobile;
    if (opts.signupData.street || opts.signupData.zip || opts.signupData.city) {
      address = {
        street: opts.signupData.street || "",
        city: opts.signupData.city || "",
        zipcode: opts.signupData.zip || "",
        country_code: "DE",
      };
    }
  }

  const payload: any = {
    measure: HERO_MEASURE_SHORT,
    customer,
    project_match: {
      partner_source: "Fahrzeug-Anfrage Website",
      partner_notes: opts.partnerNotes || "Anfrage für Fahrzeugbeschriftung über das Webformular",
    },
  };
  if (address) payload.address = address;

  try {
    const resp = await fetch(HERO_LEAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    // Lead API responds with { status: "success", project: { id, ... } } on
    // success, or { status: "error", message: "..." } on failure.
    if (data?.status !== "success") {
      return { id: null, nr: "", ok: false, raw: data };
    }
    // Extract project id and project number - the exact response shape isn't
    // 100% documented, so we look at common spots.
    const projId = data?.project?.id ?? data?.project_id ?? null;
    const projNr = data?.project?.nr ?? data?.project?.project_nr ?? data?.project_nr ?? "";
    return { id: projId ? parseInt(String(projId), 10) : null, nr: projNr, ok: true, raw: data };
  } catch (e: any) {
    return { id: null, nr: "", ok: false, raw: { error: e.message || String(e) } };
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
    const body: any = await req.json();

    // Debug mode: send { "_debug": "measures" | "project_types" | "existing", "id"?: N }
    // Returns raw HERO data without any side effects. Helps figure out
    // schema details when create_project_match returns generic errors.
    if (body._debug) {
      const { data: cfg } = await supabase.from("app_config").select("value").eq("key", "hero_api_key").maybeSingle();
      const apiKey = cfg?.value;
      if (!apiKey) return new Response(JSON.stringify({ error: "No HERO key" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      let q = "";
      let vars: any = {};
      if (body._debug === "existing") {
        const id = body.id;
        if (!id) return new Response(JSON.stringify({ error: "Pass id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        q = `query($ids: [Int]) { project_matches(ids: $ids) { id project_nr project_title partner_source current_project_match_status_id type_id partner_id created project { id customer_id measure_id address { street city zipcode } } } }`;
        vars = { ids: [parseInt(String(id), 10)] };
      } else if (body._debug === "measures") {
        q = `query { measures { id name } }`;
      } else if (body._debug === "project_types") {
        q = `query { project_types { id name steps { id name } } }`;
      } else if (body._debug === "project_types_simple") {
        // project_types without steps - in case "steps" isn't the right
        // sub-field name in this account.
        q = `query { project_types { id name } }`;
      } else if (body._debug === "project_match_full") {
        // Full WER-1640 project_match including all status/step refs - so
        // we can replicate them exactly when creating new projects.
        const id = body.id;
        if (!id) return new Response(JSON.stringify({ error: "Pass id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        q = `query($ids: [Int]) { project_matches(ids: $ids) { id project_nr type_id current_project_match_status_id partner_id project { id customer_id measure_id current_project_status_id } } }`;
        vars = { ids: [parseInt(String(id), 10)] };
      } else if (body._debug === "create_test") {
        // Try creating a project with different field combinations to
        // narrow down which one HERO accepts. body.variant picks one:
        // - "minimal":     just project_title + project.customer_id
        // - "no_measure":  drop measure_id
        // - "with_address": include a dummy address object
        // - "as_match":    customer_id at top level (old broken style, sanity check)
        const variant = body.variant || "minimal";
        const customerId = body.customer_id || 1095708;

        let projectMatch: any;
        if (variant === "minimal") {
          projectMatch = {
            project_title: "Debug-Test minimal",
            project: { customer_id: customerId },
          };
        } else if (variant === "no_measure") {
          projectMatch = {
            project_title: "Debug-Test no_measure",
            project: { customer_id: customerId },
          };
        } else if (variant === "with_address") {
          projectMatch = {
            project_title: "Debug-Test with_address",
            project: {
              customer_id: customerId,
              measure_id: 6619,
              address: { street: "Test 1", city: "Stuttgart", zipcode: "70173" },
            },
          };
        } else if (variant === "as_match") {
          projectMatch = {
            project_title: "Debug-Test as_match",
            customer_id: customerId,
          };
        } else if (variant === "with_measure") {
          projectMatch = {
            project_title: "Debug-Test with_measure",
            project: {
              customer_id: customerId,
              measure_id: 6619,
            },
          };
        } else {
          return new Response(JSON.stringify({ error: "Unknown variant" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        q = `mutation T($pm: ProjectMatchInput) { create_project_match(project_match: $pm) { id project_nr } }`;
        vars = { pm: projectMatch };
      } else if (body._debug === "schema") {
        // List all root query fields so we can find the right names
        // for measures/gewerke and project_types in this HERO instance.
        q = `query { __schema { queryType { fields { name args { name } } } } }`;
      } else if (body._debug === "contact") {
        // Inspect a single contact's full data structure - we need this
        // to find the actual customer_id that HERO expects in the project
        // creation mutation. The contact's own id might not be it.
        const id = body.id;
        if (!id) return new Response(JSON.stringify({ error: "Pass id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        q = `query($ids: [Int]) { contacts(ids: $ids) { id full_name company_name email is_contact_person parent_customer_id type } }`;
        vars = { ids: [parseInt(String(id), 10)] };
      } else if (body._debug === "contact_type") {
        // Introspect Contact type to see all its fields - maybe there's
        // a customer_id distinct from id.
        q = `query { __type(name: "Contact") { name fields { name type { name kind ofType { name } } } } }`;
      } else if (body._debug === "project_input") {
        // Schema for the inner ProjectInput - lets us see what customer_id
        // is supposed to refer to (Customer? Contact?)
        q = `query { __type(name: "ProjectInput") { name inputFields { name type { name kind ofType { name } } } } }`;
      } else if (body._debug === "project_full") {
        // Fetch the existing project's full data including its customer
        // record - maybe there's a Customer entity nested under Project.
        const id = body.id;
        if (!id) return new Response(JSON.stringify({ error: "Pass id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        q = `query($ids: [Int]) { project_matches(ids: $ids) { id project { id customer_id customer { id full_name company_name email type } } } }`;
        vars = { ids: [parseInt(String(id), 10)] };
      } else if (body._debug === "customer_input") {
        // Look at CustomerInput shape - we use this in create_contact and
        // the field naming might give clues.
        q = `query { __type(name: "Customer") { name fields { name type { name kind ofType { name } } } } }`;
      } else {
        return new Response(JSON.stringify({ error: "Unknown _debug mode. Use existing|measures|project_types" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const r = await fetch(HERO_GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query: q, variables: vars }),
      });
      const text = await r.text();
      return new Response(text, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    // Read config: HERO from app_config, Resend from edge function secrets.
    // The Resend key lives in env (Deno.env) because that matches the
    // existing submit-new-customer pattern - both functions can share the
    // same RESEND_API_KEY secret without duplicating it in the database.
    const { data: configRows } = await supabase
      .from("app_config")
      .select("key, value")
      .in("key", ["hero_api_key", "hero_enabled"]);
    const cfg = new Map((configRows || []).map((r: any) => [r.key, r.value]));
    const heroApiKey = cfg.get("hero_api_key");
    const heroEnabled = cfg.get("hero_enabled") === "true" && !!heroApiKey;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    // Read vehicle field labels for the notification email
    const { data: fieldConfigs } = await supabase
      .from("vehicle_field_config")
      .select("field_key, field_label")
      .eq("is_active", true);
    const fieldLabels: Record<string, string> = {};
    (fieldConfigs || []).forEach((f: any) => { fieldLabels[f.field_key] = f.field_label; });

    // ---- HERO contact match (just for "needs_signup" detection) ----
    // We still match the email up-front: if HERO doesn't know the address
    // and the form hasn't collected signup details, we ask the user for
    // them. The actual project creation goes through the Lead API which
    // handles match-or-create internally - but it would still create an
    // empty contact if we didn't pre-collect the name etc.
    let heroError: string | null = null;
    let heroCustomerName: string = "";
    let foundExistingContact = false;
    const debug: any = {};

    if (heroEnabled) {
      const match = await heroSearchContactByEmail(heroApiKey, body.email.trim());
      debug.heroSearch = match ? { id: match.id, isContactPerson: match.isContactPerson, parentCustomerId: match.parentCustomerId, displayName: match.displayName } : null;
      if (match) {
        foundExistingContact = true;
        // Display name preference: parent company > the contact's own name
        if (match.isContactPerson && match.parentCustomerId) {
          const parent = await heroFetchContact(heroApiKey, match.parentCustomerId);
          debug.heroParent = parent;
          heroCustomerName = parent?.displayName || match.displayName;
        } else {
          heroCustomerName = match.displayName;
        }
      } else {
        // No HERO match - we need signup data so the Lead API can create
        // a usable customer record (otherwise it'd just have an email).
        if (!body.signupData?.lastName) {
          return new Response(JSON.stringify({ ok: false, needs_signup: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Fallback display name from signup data if HERO didn't give us one
    const displayCustomerName = heroCustomerName || (body.signupData
      ? [body.signupData.firstName, body.signupData.lastName].filter(Boolean).join(" ") ||
        body.signupData.companyName ||
        ""
      : "");

    // ---- Create HERO project via Lead API ----
    // The Lead API auto-matches the email and either reuses or creates a
    // customer record. We pass signup data when we have it - HERO uses
    // it only if creating a new contact, ignored if matching existing.
    let heroProjectId: number | null = null;
    let projectNumber: string = "";
    if (heroEnabled) {
      const fieldDescriptions = Object.entries(body.vehicleFields || {})
        .filter(([_, v]) => v && String(v).trim())
        .map(([k, v]) => `${fieldLabels[k] || k}: ${v}`)
        .join("\n");
      const partnerNotes = `Anfrage über das Webformular von ${body.email.trim()}.\n\n${fieldDescriptions}`;

      const result = await heroCreateProjectViaLeadAPI(heroApiKey, {
        email: body.email.trim(),
        signupData: foundExistingContact ? undefined : body.signupData,
        partnerNotes,
      });
      debug.heroCreateProject = { ok: result.ok, id: result.id, nr: result.nr, raw: result.raw };
      if (!result.ok) {
        heroError = `Projekt-Anlage: ${JSON.stringify(result.raw)}`;
      } else {
        heroProjectId = result.id;
        projectNumber = result.nr;
      }
    }

    // Fallback project number when HERO is off or failed.
    if (!projectNumber) {
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
      projectNumber = `WER-${nextNumber}`;
    }

    // ---- Create app project ----
    const newProjectId = crypto.randomUUID();

    const customFields: Record<string, string> = {};
    if (heroProjectId) {
      customFields.__hero_project_id = String(heroProjectId);
      customFields.__hero_project_nr = projectNumber;
    }

    const { data: project, error: projError } = await supabase
      .from("projects")
      .insert({
        id: newProjectId,
        user_id: newProjectId,
        employee_id: null,
        project_number: projectNumber,
        project_type: "fahrzeugbeschriftung",
        customer_name: displayCustomerName || null,
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
        // Diagnostics: helps us see end-to-end status on the client when
        // logs are inaccessible. Safe to expose - no secrets, only public
        // status flags.
        debug: {
          ...debug,
          heroEnabled,
          resendApiKeyPresent: !!resendApiKey,
          customerName: displayCustomerName,
        },
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
