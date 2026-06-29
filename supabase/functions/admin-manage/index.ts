import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "https://esm.sh/bcryptjs@3.0.2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { adminToken, employeeToken, action, ...params } = body;

    // Public actions don't require admin auth:
    // - get_project_prefix is read by NewProject (any logged-in user)
    // - get_integration_config returns only a boolean (whether integrations
    //   are enabled)
    // - get_logo returns the company logo, which by definition is meant to
    //   be visible to anyone (customers, public form visitors, guests). Logo
    //   uploads/changes still require admin auth via set_logo.
    // - get_privacy_url is read by every customer-facing form so the
    //   Datenschutz-link on the consent checkbox can be rendered. Setting
    //   the URL still requires admin auth via set_privacy_url.
    // - get_legal_info returns the responsible-party data shown on the
    //   built-in /datenschutz page; it is meant to be public.
    const publicActions = ["get_project_prefix", "get_integration_config", "get_logo", "get_privacy_url", "get_legal_info"];
    if (!publicActions.includes(action)) {
      const payload = adminToken ? await verifySessionToken(adminToken, getSessionSecret()) : null;
      if (!payload || payload.role !== "admin" || payload.userId !== "admin") {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    switch (action) {
      // ---- SECURITY SETTINGS ----
      case "get_security_settings": {
        const { data: hashConfig } = await supabase.from("app_config").select("value").eq("key", "admin_password_hash").maybeSingle();
        return json({ adminPasswordConfigured: !!hashConfig?.value });
      }

      // ---- VIEW SETTINGS ----
      case "get_view_settings": {
        const { data, error } = await supabase
          .from("app_config")
          .select("key, value")
          .in("key", [
            "internal_show_print_files",
            "customer_show_print_files",
            "internal_show_detail_images",
            "customer_show_detail_images",
          ]);
        if (error) return json({ error: error.message }, 500);
        const lookup = new Map((data || []).map((row: any) => [row.key, row.value]));
        return json({
          settings: {
            internalShowPrintFiles: lookup.get("internal_show_print_files") ?? "true",
            customerShowPrintFiles: lookup.get("customer_show_print_files") ?? "true",
            internalShowDetailImages: lookup.get("internal_show_detail_images") ?? "true",
            customerShowDetailImages: lookup.get("customer_show_detail_images") ?? "false",
          },
        });
      }
      case "set_view_settings": {
        const settings = params.settings || {};
        const rows = [
          { key: "internal_show_print_files", value: String(!!settings.internalShowPrintFiles) },
          { key: "customer_show_print_files", value: String(!!settings.customerShowPrintFiles) },
          { key: "internal_show_detail_images", value: String(!!settings.internalShowDetailImages) },
          { key: "customer_show_detail_images", value: String(!!settings.customerShowDetailImages) },
        ];
        const { error } = await supabase.from("app_config").upsert(rows, { onConflict: "key" });
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- ADMIN PASSWORD ----
      case "set_admin_password": {
        const password = String(params.password || "").trim();
        if (!password) return json({ error: "Missing password" }, 400);
        const passwordHash = bcrypt.hashSync(password, 10);
        const { error } = await supabase.from("app_config").upsert({ key: "admin_password_hash", value: passwordHash });
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- EMPLOYEE PASSWORD (individual) ----
      case "set_employee_password": {
        const password = String(params.password || "").trim();
        const employeeId = params.employeeId;
        if (!password || !employeeId) return json({ error: "Missing password or employeeId" }, 400);
        const passwordHash = bcrypt.hashSync(password, 10);
        const { error } = await supabase.from("employees").update({ password_hash: passwordHash }).eq("id", employeeId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
      case "delete_employee_password": {
        const employeeId = params.employeeId;
        if (!employeeId) return json({ error: "Missing employeeId" }, 400);
        const { error } = await supabase.from("employees").update({ password_hash: null }).eq("id", employeeId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- FIELDS ----
      case "list_fields": {
        const { data, error } = await supabase.from("location_field_config").select("*").order("sort_order");
        if (error) return json({ error: error.message }, 500);
        return json({ fields: data });
      }
      case "create_field": {
        const { error } = await supabase.from("location_field_config").insert({
          field_key: params.fieldKey,
          field_label: params.fieldLabel,
          field_type: params.fieldType,
          field_options: Array.isArray(params.fieldOptions) ? JSON.stringify(params.fieldOptions) : null,
          sort_order: params.sortOrder ?? 1,
          is_active: true,
          customer_visible: true,
          applies_to: params.appliesTo || "all",
          is_required: params.isRequired ?? false,
        });
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }
      case "update_field": {
        const { error } = await supabase.from("location_field_config").update(params.changes || {}).eq("id", params.fieldId);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }
      case "delete_field": {
        const { error } = await supabase.from("location_field_config").delete().eq("id", params.fieldId);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }

      // ---- PROJECT FIELDS ----
      // Built-in fields (projectNumber, customerName) are protected: they may only
      // be toggled active/inactive via is_active; label/type/delete are rejected.
      case "list_project_fields": {
        const { data, error } = await supabase.from("project_field_config").select("*").order("sort_order");
        if (error) return json({ error: error.message }, 500);
        return json({ fields: data });
      }
      case "create_project_field": {
        const fieldKey = String(params.fieldKey || "").trim();
        if (!fieldKey) return json({ error: "Missing fieldKey" }, 400);
        // Prevent overwriting protected keys via the create endpoint
        if (fieldKey === "projectNumber" || fieldKey === "customerName") {
          return json({ error: "Dieser Feldschlüssel ist reserviert" }, 400);
        }
        const { error } = await supabase.from("project_field_config").insert({
          field_key: fieldKey,
          field_label: params.fieldLabel,
          field_type: params.fieldType,
          field_options: Array.isArray(params.fieldOptions) ? JSON.stringify(params.fieldOptions) : null,
          sort_order: params.sortOrder ?? 100,
          is_active: true,
          applies_to: params.appliesTo || "all",
          is_required: params.isRequired ?? false,
        });
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }
      case "update_project_field": {
        // Look up the field_key first so we can enforce protection rules
        const { data: existing } = await supabase
          .from("project_field_config")
          .select("field_key")
          .eq("id", params.fieldId)
          .maybeSingle();
        if (!existing) return json({ error: "Feld nicht gefunden" }, 404);

        const changes = { ...(params.changes || {}) };
        const isProtected = existing.field_key === "projectNumber" || existing.field_key === "customerName";
        if (isProtected) {
          // For protected fields only allow toggling is_active. Strip everything else.
          const allowed: any = {};
          if (Object.prototype.hasOwnProperty.call(changes, "is_active")) {
            allowed.is_active = !!changes.is_active;
          }
          if (Object.keys(allowed).length === 0) {
            return json({ error: "Standardfelder können nicht verändert werden" }, 400);
          }
          const { error } = await supabase.from("project_field_config").update(allowed).eq("id", params.fieldId);
          if (error) return json({ error: error.message }, 400);
          return json({ success: true });
        }
        const { error } = await supabase.from("project_field_config").update(changes).eq("id", params.fieldId);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }
      case "delete_project_field": {
        const { data: existing } = await supabase
          .from("project_field_config")
          .select("field_key")
          .eq("id", params.fieldId)
          .maybeSingle();
        if (existing?.field_key === "projectNumber" || existing?.field_key === "customerName") {
          return json({ error: "Standardfelder können nicht gelöscht werden" }, 400);
        }
        const { error } = await supabase.from("project_field_config").delete().eq("id", params.fieldId);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }

      // ---- SYNC PROJECTS ----
      case "sync_projects": {
        const projects = params.projects as Array<{
          id: string;
          project_number: string;
          employee_id?: string;
          created_at: string;
          updated_at: string;
        }>;
        if (!projects || !Array.isArray(projects)) return json({ error: "Missing projects" }, 400);
        const rows = projects.map(p => ({
          id: p.id,
          project_number: p.project_number,
          user_id: p.employee_id || "employee",
          employee_id: p.employee_id || null,
          created_at: p.created_at,
          updated_at: p.updated_at,
        }));
        const { error } = await supabase.from("projects").upsert(rows, { onConflict: "id" });
        if (error) return json({ error: error.message }, 500);
        return json({ success: true, synced: rows.length });
      }

      // ---- EMPLOYEES ----
      case "list_employees": {
        const { data, error } = await supabase.from("employees").select("*").order("name");
        if (error) return json({ error: error.message }, 500);
        // Don't expose password_hash, return hasPassword boolean instead
        const employees = (data || []).map(emp => ({
          id: emp.id,
          name: emp.name,
          email: emp.email || null,
          created_at: emp.created_at,
          hasPassword: !!emp.password_hash,
          hero_partner_id: emp.hero_partner_id ?? null,
        }));
        return json({ employees });
      }
      case "create_employee": {
        const insertData: any = { name: params.name };
        if (params.password && String(params.password).trim()) {
          insertData.password_hash = bcrypt.hashSync(String(params.password).trim(), 10);
        }
        if (params.email && String(params.email).trim()) {
          insertData.email = String(params.email).trim();
        }
        // Optional HERO partner mapping straight from the create form.
        if (params.heroPartnerId !== undefined && params.heroPartnerId !== null && String(params.heroPartnerId).trim() !== "") {
          const n = Number(params.heroPartnerId);
          if (Number.isInteger(n) && n > 0) insertData.hero_partner_id = n;
        }
        const { data, error } = await supabase.from("employees").insert(insertData).select().single();
        if (error) return json({ error: error.message }, 400);
        return json({ employee: { id: data.id, name: data.name, email: data.email || null, created_at: data.created_at, hasPassword: !!data.password_hash, hero_partner_id: data.hero_partner_id ?? null } });
      }
      case "set_employee_hero_partner": {
        // Map a CaptFix employee to a HERO partner_id (or clear with null/empty).
        const employeeId = params.employeeId;
        if (!employeeId) return json({ error: "employeeId required" }, 400);
        const raw = params.heroPartnerId;
        let heroPartnerId: number | null = null;
        if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
          const n = Number(raw);
          if (!Number.isInteger(n) || n <= 0) return json({ error: "Ungültige HERO-ID" }, 400);
          heroPartnerId = n;
        }
        const { error } = await supabase.from("employees").update({ hero_partner_id: heroPartnerId }).eq("id", employeeId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
      case "delete_employee": {
        const { error } = await supabase.from("employees").delete().eq("id", params.employeeId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
      case "set_employee_email": {
        // Sets or clears the email of an employee. Empty/null clears it.
        // We do a basic format check so we don't store obvious garbage,
        // but rely on the user (admin) to enter a real address.
        const employeeId = params.employeeId;
        const raw = params.email;
        if (!employeeId) return json({ error: "employeeId required" }, 400);
        const trimmed = (raw ?? "").toString().trim();
        if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          return json({ error: "Ungültige E-Mail-Adresse" }, 400);
        }
        const { error } = await supabase.from("employees").update({ email: trimmed || null }).eq("id", employeeId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- CUSTOMERS ----
      case "list_customers": {
        const { data, error } = await supabase.from("customers").select("*").order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ customers: data });
      }
      case "create_customer": {
        const { data, error } = await supabase.from("customers").insert({ name: params.name }).select().single();
        if (error) return json({ error: error.message }, 400);
        return json({ customer: data });
      }
      case "delete_customer": {
        const { error } = await supabase.from("customers").delete().eq("id", params.customerId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- ASSIGNMENTS ----
      case "list_assignments": {
        const { data, error } = await supabase
          .from("customer_project_assignments")
          .select("*, customers(name), projects(project_number)")
          .order("created_at");
        if (error) return json({ error: error.message }, 500);
        return json({ assignments: data });
      }
      case "create_assignment": {
        const { data, error } = await supabase
          .from("customer_project_assignments")
          .insert({ customer_id: params.customerId, project_id: params.projectId })
          .select().single();
        if (error) return json({ error: error.message }, 400);
        return json({ assignment: data });
      }
      case "delete_assignment": {
        const { error } = await supabase.from("customer_project_assignments").delete().eq("id", params.assignmentId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      // ---- PROJECT EMPLOYEE ACCESS ----
      case "list_project_employee_assignments": {
        const { data, error } = await (supabase as any)
          .from('project_employee_assignments')
          .select('id, project_id, employee_id, created_at, employees(name), projects(project_number, employee_id)')
          .order('created_at');
        if (error) return json({ error: error.message }, 500);
        return json({ assignments: data || [] });
      }
      case "create_project_employee_assignment": {
        const projectId = params.projectId;
        const employeeId = params.employeeId;
        if (!projectId || !employeeId) return json({ error: 'Missing projectId or employeeId' }, 400);
        const { data: project } = await supabase.from('projects').select('employee_id').eq('id', projectId).maybeSingle();
        if (project?.employee_id === employeeId) return json({ success: true, skipped: true });
        const { data, error } = await (supabase as any)
          .from('project_employee_assignments')
          .insert({ project_id: projectId, employee_id: employeeId })
          .select()
          .single();
        if (error && !String(error.message || '').includes('duplicate')) return json({ error: error.message }, 400);
        return json({ success: true, assignment: data || null });
      }
      case "delete_project_employee_assignment": {
        const assignmentId = params.assignmentId;
        if (!assignmentId) return json({ error: 'Missing assignmentId' }, 400);
        const { error } = await (supabase as any).from('project_employee_assignments').delete().eq('id', assignmentId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
      case "set_project_employee_owner": {
        const projectId = params.projectId;
        const employeeId = params.employeeId || null;
        if (!projectId) return json({ error: 'Missing projectId' }, 400);
        const { error } = await supabase.from('projects').update({ employee_id: employeeId }).eq('id', projectId);
        if (error) return json({ error: error.message }, 500);
        if (employeeId) {
          await (supabase as any).from('project_employee_assignments').delete().eq('project_id', projectId).eq('employee_id', employeeId);
        }
        return json({ success: true });
      }

      // ---- PERMISSIONS ----
      case "list_permissions": {
        const { data, error } = await supabase
          .from("customer_location_permissions")
          .select("*, locations(location_number, location_name)")
          .eq("assignment_id", params.assignmentId);
        if (error) return json({ error: error.message }, 500);
        return json({ permissions: data });
      }
      case "set_permissions": {
        const assignmentId = params.assignmentId;
        await supabase.from("customer_location_permissions").delete().eq("assignment_id", assignmentId);
        if (params.permissions && params.permissions.length > 0) {
          const rows = params.permissions.map((p: any) => ({
            assignment_id: assignmentId,
            location_id: p.locationId,
            can_edit_guest_info: p.canEditGuestInfo ?? true,
          }));
          const { error } = await supabase.from("customer_location_permissions").insert(rows);
          if (error) return json({ error: error.message }, 500);
        }
        return json({ success: true });
      }

      // ---- PROJECTS ----
      case "list_projects": {
        const { data, error } = await supabase
          .from("projects")
          .select("id, project_number, employee_id, created_at, updated_at, employees(name)")
          .order("updated_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json({ projects: data });
      }

      // ---- COMPANY LOGO ----
      case "get_logo": {
        const { data } = await supabase.from("app_config").select("value").eq("key", "company_logo").maybeSingle();
        return json({ logo: data?.value ?? null });
      }
      case "set_logo": {
        const logoData = params.logoData ?? null;
        if (logoData && logoData.length > 2_000_000) return json({ error: "Logo zu groß (max. 1.5 MB)" }, 400);
        const { error } = await supabase.from("app_config").upsert({ key: "company_logo", value: logoData });
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
      case "get_privacy_url": {
        // Public action - the URL is read by every customer-facing form
        // (no auth) so it can render the Datenschutz-link on the consent
        // checkbox. Returns null when nothing is configured; the form
        // then falls back to a sensible default.
        const { data } = await supabase.from("app_config").select("value").eq("key", "privacy_policy_url").maybeSingle();
        return json({ url: data?.value ?? null });
      }
      case "set_privacy_url": {
        // Admin-only action. Allow empty string to clear the value.
        const url = (params.url ?? "").trim();
        if (url && !/^https?:\/\//i.test(url)) {
          return json({ error: "URL muss mit http:// oder https:// beginnen" }, 400);
        }
        const { error } = await supabase.from("app_config").upsert({ key: "privacy_policy_url", value: url || null });
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
      case "get_legal_info": {
        // Public action - the values are needed by the built-in privacy
        // policy page (/datenschutz) which is publicly accessible. We
        // store as a single JSON blob to keep the schema simple and
        // avoid one round-trip per field.
        const { data } = await supabase.from("app_config").select("value").eq("key", "legal_info").maybeSingle();
        let parsed: any = null;
        if (data?.value) {
          try { parsed = JSON.parse(data.value); } catch { parsed = null; }
        }
        return json({ info: parsed });
      }
      case "set_legal_info": {
        // Admin-only. Stores the responsible-party details as JSON.
        // We don't validate strictly because the user knows their own
        // company data better than we do; we just keep length under a
        // reasonable cap to prevent abuse.
        const info = params.info ?? {};
        const serialized = JSON.stringify(info);
        if (serialized.length > 5000) return json({ error: "Eingabe zu lang" }, 400);
        const { error } = await supabase.from("app_config").upsert({ key: "legal_info", value: serialized });
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
      case "get_hero_doc_types_config": {
        // Returns the currently configured HERO document_type_id for
        // each upload-kind we auto-upload to HERO. Used by the admin
        // UI to show which doc-type each kind maps to.
        const { data } = await supabase.from("app_config").select("key, value").like("key", "hero_doc_type_%");
        const config: Record<string, number | null> = {};
        for (const row of (data || [])) {
          const v = row.value ? parseInt(String(row.value), 10) : NaN;
          if (Number.isFinite(v)) config[row.key as string] = v;
          else config[row.key as string] = null;
        }
        return json({ config });
      }
      case "set_hero_doc_type": {
        // Persist the HERO document_type_id selected by the admin for a
        // given upload-kind. uploadType is the same string used by the
        // worker (e.g. "aufmass_pdf"). documentTypeId is an integer HERO ID,
        // or null/empty to clear.
        const uploadType = String(params.uploadType || "").trim();
        if (!uploadType) return json({ error: "uploadType required" }, 400);
        if (!/^[a-z0-9_]+$/.test(uploadType)) return json({ error: "uploadType has invalid chars" }, 400);

        const raw = params.documentTypeId;
        const key = `hero_doc_type_${uploadType}`;
        const value = raw != null && raw !== "" && Number.isFinite(Number(raw)) ? String(Number(raw)) : null;

        const { error } = await supabase.from("app_config").upsert({ key, value });
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
      case "get_hero_image_categories": {
        // Live-fetch the image categories defined in HERO (the customer
        // can create custom ones), analogous to listing document types.
        // Returns a list of category strings. No session token needed -
        // we read the API key server-side from app_config.
        const { data: keyRow } = await supabase.from("app_config").select("value").eq("key", "hero_api_key").maybeSingle();
        const apiKey = keyRow?.value;
        if (!apiKey) return json({ error: "Kein API Key hinterlegt" }, 400);
        try {
          const resp = await fetch("https://login.hero-software.de/api/external/v7/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ query: "query { upload_image_categories }" }),
          });
          const respText = await resp.text();
          if (!resp.ok) return json({ error: `HTTP ${resp.status}: ${respText.slice(0, 300)}` }, 502);
          let result: any;
          try { result = JSON.parse(respText); } catch { return json({ error: `Ungültige Antwort: ${respText.slice(0, 200)}` }, 502); }
          if (result.errors?.length) return json({ error: result.errors[0]?.message }, 502);
          const cats = (result?.data?.upload_image_categories || []).filter((c: any) => typeof c === "string");
          return json({ categories: cats });
        } catch (fetchErr: any) {
          return json({ error: `Verbindungsfehler: ${fetchErr.message}` }, 502);
        }
      }
      case "get_hero_image_categories_config": {
        // Returns the currently configured HERO image_category for each
        // image upload-kind. Used by the admin UI to show the mapping.
        const { data } = await supabase.from("app_config").select("key, value").like("key", "hero_img_cat_%");
        const config: Record<string, string | null> = {};
        for (const row of (data || [])) {
          config[row.key as string] = row.value ? String(row.value) : null;
        }
        return json({ config });
      }
      case "set_hero_image_category": {
        // Persist the HERO image_category selected for a given image
        // upload-kind. uploadType e.g. "location_image". category is a
        // free-text string from upload_image_categories, or null/empty
        // to clear (then no category is set on upload).
        const uploadType = String(params.uploadType || "").trim();
        if (!uploadType) return json({ error: "uploadType required" }, 400);
        if (!/^[a-z0-9_]+$/.test(uploadType)) return json({ error: "uploadType has invalid chars" }, 400);

        const raw = params.category;
        const key = `hero_img_cat_${uploadType}`;
        // Keep the category exactly as HERO returns it (may contain
        // trailing spaces, German chars). Just cap length defensively.
        const value = (raw != null && String(raw).trim() !== "") ? String(raw).slice(0, 200) : null;

        const { error } = await supabase.from("app_config").upsert({ key, value });
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
      case "get_notification_settings": {
        // Returns the global recipient email and per-event settings
        // (enabled + target). Admin-only because these settings affect
        // operational behavior; non-admins don't need to see them.
        const [{ data: emailRow }, { data: settingsRow }] = await Promise.all([
          supabase.from("app_config").select("value").eq("key", "notification_global_email").maybeSingle(),
          supabase.from("app_config").select("value").eq("key", "notification_settings").maybeSingle(),
        ]);
        let settings: any = null;
        if (settingsRow?.value) {
          try { settings = JSON.parse(settingsRow.value); } catch { settings = null; }
        }
        return json({
          globalEmail: emailRow?.value || null,
          settings: settings || {},
        });
      }
      case "set_notification_settings": {
        // Admin-only. Persists the global email + the per-event
        // settings (each event is { enabled: bool, target: "global" |
        // "assigned_employee" }). We accept partial input so the UI
        // can save just what changed.
        const updates: { key: string; value: string | null }[] = [];
        if ("globalEmail" in params) {
          const trimmed = (params.globalEmail ?? "").toString().trim();
          if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            return json({ error: "Ungültige E-Mail-Adresse" }, 400);
          }
          updates.push({ key: "notification_global_email", value: trimmed || null });
        }
        if ("settings" in params) {
          const settings = params.settings ?? {};
          const serialized = JSON.stringify(settings);
          if (serialized.length > 5000) return json({ error: "Settings zu groß" }, 400);
          updates.push({ key: "notification_settings", value: serialized });
        }
        for (const u of updates) {
          const { error } = await supabase.from("app_config").upsert(u);
          if (error) return json({ error: error.message }, 500);
        }
        return json({ success: true });
      }
      case "get_employee_name": {
        const { data } = await supabase.from("employees").select("name").eq("id", params.employeeId).maybeSingle();
        return json({ name: data?.name ?? null });
      }

      // ---- REMINDER SETTINGS ----
      case "get_reminder_settings": {
        const { data } = await supabase
          .from("app_config")
          .select("key, value")
          .in("key", ["reminder_enabled", "reminder_days", "reminder_email_text"]);
        const map = new Map((data || []).map((r: any) => [r.key, r.value]));
        const pendingInvites = await (async () => {
          const reminderDays = Math.max(1, parseInt(map.get("reminder_days") || "3", 10));
          const cutoff = new Date(Date.now() - reminderDays * 24 * 60 * 60 * 1000).toISOString();
          const { count } = await supabase
            .from("project_invites")
            .select("id", { count: "exact", head: true })
            .lte("sent_at", cutoff)
            .is("reminder_sent_at", null);
          return count || 0;
        })();
        return json({
          enabled: map.get("reminder_enabled") === "true",
          days: parseInt(map.get("reminder_days") || "3", 10),
          emailText: map.get("reminder_email_text") || "",
          pendingInvites,
        });
      }
      case "set_reminder_settings": {
        const updates: { key: string; value: string | null }[] = [];
        if ("enabled" in params) {
          updates.push({ key: "reminder_enabled", value: params.enabled ? "true" : "false" });
        }
        if ("days" in params) {
          const days = Math.max(1, Math.min(30, parseInt(String(params.days), 10) || 3));
          updates.push({ key: "reminder_days", value: String(days) });
        }
        if ("emailText" in params) {
          updates.push({ key: "reminder_email_text", value: String(params.emailText || "").slice(0, 1000) || null });
        }
        for (const u of updates) {
          const { error } = await supabase.from("app_config").upsert(u);
          if (error) return json({ error: error.message }, 500);
        }
        return json({ success: true });
      }

      // ---- PROJECT PREFIX ----
      case "get_project_prefix": {
        const { data } = await supabase.from("app_config").select("value").eq("key", "project_prefix").maybeSingle();
        return json({ prefix: data?.value ?? "WER-" });
      }
      case "set_project_prefix": {
        const prefix = String(params.prefix ?? "").trim();
        const { error } = await supabase.from("app_config").upsert({ key: "project_prefix", value: prefix });
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "get_integration_config": {
        const { data } = await supabase.from("app_config").select("key, value")
          .in("key", ["hero_api_key", "hero_enabled"]);
        const lookup = new Map((data || []).map((row: any) => [row.key, row.value]));
        // Never return the actual key - just whether it exists and is enabled
        const hasKey = !!lookup.get("hero_api_key");
        return json({
          hero: {
            enabled: lookup.get("hero_enabled") === "true" && hasKey,
            hasKey,
          }
        });
      }

      case "set_integration_config": {
        const rows: any[] = [];
        if (params.heroApiKey !== undefined) {
          rows.push({ key: "hero_api_key", value: params.heroApiKey });
        }
        if (params.heroEnabled !== undefined) {
          rows.push({ key: "hero_enabled", value: String(!!params.heroEnabled) });
        }
        if (rows.length > 0) {
          const { error } = await supabase.from("app_config").upsert(rows, { onConflict: "key" });
          if (error) return json({ error: error.message }, 500);
        }
        return json({ success: true });
      }

      case "test_hero_connection": {
        const { data: keyRow } = await supabase.from("app_config").select("value").eq("key", "hero_api_key").maybeSingle();
        const apiKey = keyRow?.value;
        if (!apiKey) return json({ success: false, error: "Kein API Key hinterlegt" });
        const testQuery = `query { __typename }`;
        try {
          const resp = await fetch("https://login.hero-software.de/api/external/v7/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ query: testQuery }),
          });
          const respText = await resp.text();
          if (!resp.ok) return json({ success: false, error: `HTTP ${resp.status}: ${respText.slice(0, 300)}` });
          let result: any;
          try { result = JSON.parse(respText); } catch { return json({ success: false, error: `Ungültige Antwort: ${respText.slice(0, 200)}` }); }
          if (result.errors?.length) return json({ success: false, error: result.errors[0]?.message });
          return json({ success: true, message: "Verbindung erfolgreich ✓" });
        } catch (fetchErr: any) {
          return json({ success: false, error: `Verbindungsfehler: ${fetchErr.message}` });
        }
      }

      case "list_automations": {
        const { data, error } = await supabase
          .from("automations")
          .select("id,name,enabled,trigger_type,trigger_config,action_type,action_config,sort_order,created_at,updated_at")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (error) return json({ error: error.message }, 500);
        return json({ automations: data || [] });
      }
      case "list_automation_runs": {
        const limit = Math.min(Math.max(Number(params.limit ?? 30), 1), 200);
        const { data, error } = await supabase
          .from("automation_runs")
          .select("id,automation_id,automation_name,trigger_type,action_type,status,message,context,created_at")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return json({ error: error.message }, 500);
        return json({ runs: data || [] });
      }
      case "create_automation": {
        if (!params.name || !String(params.name).trim()) return json({ error: "Name fehlt" }, 400);
        if (!params.trigger_type || !params.action_type) return json({ error: "Trigger/Aktion fehlt" }, 400);
        const insert = {
          name: String(params.name).trim(),
          enabled: params.enabled !== false,
          trigger_type: String(params.trigger_type),
          trigger_config: params.trigger_config ?? {},
          action_type: String(params.action_type),
          action_config: params.action_config ?? {},
          sort_order: Number.isFinite(Number(params.sort_order)) ? Number(params.sort_order) : 0,
        };
        const { data, error } = await supabase.from("automations").insert(insert).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ automation: data });
      }
      case "update_automation": {
        if (!params.id) return json({ error: "id fehlt" }, 400);
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (params.name !== undefined) patch.name = String(params.name).trim();
        if (params.enabled !== undefined) patch.enabled = !!params.enabled;
        if (params.trigger_type !== undefined) patch.trigger_type = String(params.trigger_type);
        if (params.trigger_config !== undefined) patch.trigger_config = params.trigger_config;
        if (params.action_type !== undefined) patch.action_type = String(params.action_type);
        if (params.action_config !== undefined) patch.action_config = params.action_config;
        if (params.sort_order !== undefined) patch.sort_order = Number(params.sort_order) || 0;
        const { data, error } = await supabase.from("automations").update(patch).eq("id", params.id).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ automation: data });
      }
      case "delete_automation": {
        if (!params.id) return json({ error: "id fehlt" }, 400);
        const { error } = await supabase.from("automations").delete().eq("id", params.id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "hero_list_options": {
        // Provides option lists for the Automations UI. Sources:
        //   hero_partners            -> employees/Mitarbeiter assignable to events
        //   hero_resources           -> resources/Ressourcen assignable to events
        //   hero_targets             -> combined (partners + resources), grouped
        //   hero_calendar_categories -> event categories
        // HERO's PartnerQuery root has no stable top-level "list all" field for
        // partners/resources, so we derive them from existing calendar events
        // (documented to work) and fall back to schema introspection for
        // diagnostics if nothing is found.
        const source = params.source;
        const { data: keyRow } = await supabase.from("app_config").select("value").eq("key", "hero_api_key").maybeSingle();
        const apiKey = keyRow?.value;
        if (!apiKey) return json({ options: [], error: "Kein API Key hinterlegt" });

        const heroQuery = async (q: string) => {
          try {
            const resp = await fetch("https://login.hero-software.de/api/external/v7/graphql", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({ query: q }),
            });
            const text = await resp.text();
            if (!resp.ok) return { error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
            const parsed = JSON.parse(text);
            if (parsed.errors?.length) return { error: parsed.errors[0]?.message || "GraphQL-Fehler" };
            return { data: parsed.data };
          } catch (e: any) {
            return { error: e.message };
          }
        };

        if (source === "hero_calendar_categories") {
          const r = await heroQuery(`query { calendar_event_categories(show_deleted: false) { id name } }`);
          if (r.error) return json({ options: [], error: r.error });
          const options = (r.data?.calendar_event_categories || []).map((c: any) => ({ value: String(c.id), label: c.name || `#${c.id}` }));
          return json({ options });
        }

        if (source === "hero_doc_types") {
          const r = await heroQuery(`query { document_types { id name } }`);
          if (r.error) return json({ options: [], error: r.error });
          const options = (r.data?.document_types || [])
            .map((d: any) => ({ value: String(d.id), label: d.name || `#${d.id}` }))
            .sort((a: any, b: any) => a.label.localeCompare(b.label));
          return json({ options });
        }

        // Derive partners and/or resources from recent calendar events.
        const wantPartners = source === "hero_partners" || source === "hero_targets";
        const wantResources = source === "hero_resources" || source === "hero_targets";
        const ev = await heroQuery(`query { calendar_events(last: 500) { partners { id full_name } resources { id name } } }`);

        const partnerMap = new Map<string, string>();
        const resourceMap = new Map<string, string>();
        if (!ev.error) {
          for (const e of (ev.data?.calendar_events || [])) {
            if (wantPartners) for (const p of (e.partners || [])) {
              if (p?.id != null) partnerMap.set(String(p.id), p.full_name || `#${p.id}`);
            }
            if (wantResources) for (const r of (e.resources || [])) {
              if (r?.id != null) resourceMap.set(String(r.id), r.name || `#${r.id}`);
            }
          }
        }

        // For the combined "hero_targets" source we prefix the value with the
        // kind ("partner:ID" / "resource:ID") so the automation dispatch knows
        // whether to set partner_ids or resource_ids. For the single-purpose
        // sources we keep the raw numeric id (employee-mapping stores a number).
        const combined = source === "hero_targets";
        const options: { value: string; label: string; kind?: string }[] = [];
        if (wantPartners) {
          Array.from(partnerMap, ([id, name]) => ({
            value: combined ? `partner:${id}` : id,
            label: combined ? `${name} (Mitarbeiter)` : name,
            kind: "partner",
          }))
            .sort((a, b) => a.label.localeCompare(b.label))
            .forEach(o => options.push(o));
        }
        if (wantResources) {
          Array.from(resourceMap, ([id, name]) => ({
            value: combined ? `resource:${id}` : id,
            label: combined ? `${name} (Ressource)` : name,
            kind: "resource",
          }))
            .sort((a, b) => a.label.localeCompare(b.label))
            .forEach(o => options.push(o));
        }

        if (options.length > 0) return json({ options });

        // Diagnostics: show what the schema actually exposes.
        const intro = await heroQuery(`query { __type(name: "PartnerQuery") { fields { name } } }`);
        const debugFields = (intro.data?.__type?.fields || []).map((f: any) => f.name);
        return json({
          options: [],
          error: ev.error
            ? `HERO-Liste nicht abrufbar (${ev.error}). Bitte ID manuell eingeben.`
            : "Keine Einträge über Termine gefunden. Bitte ID manuell eingeben.",
          debug_fields: debugFields,
        });
      }

      case "list_options_app_employees": {
        // Used by the automation UI "assign_employee" action to list app employees.
        const { data: emps, error } = await supabase
          .from("employees")
          .select("id, name")
          .order("name");
        if (error) return json({ options: [], error: error.message });
        const options = (emps || []).map((e: any) => ({ value: e.id, label: e.name || e.id }));
        return json({ options });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: "Server error" }, 500);
  }
});
