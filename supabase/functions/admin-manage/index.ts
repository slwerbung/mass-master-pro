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
    const publicActions = ["get_project_prefix", "get_integration_config", "get_logo"];
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
          created_at: emp.created_at,
          hasPassword: !!emp.password_hash,
        }));
        return json({ employees });
      }
      case "create_employee": {
        const insertData: any = { name: params.name };
        if (params.password && String(params.password).trim()) {
          insertData.password_hash = bcrypt.hashSync(String(params.password).trim(), 10);
        }
        const { data, error } = await supabase.from("employees").insert(insertData).select().single();
        if (error) return json({ error: error.message }, 400);
        return json({ employee: { id: data.id, name: data.name, created_at: data.created_at, hasPassword: !!data.password_hash } });
      }
      case "delete_employee": {
        const { error } = await supabase.from("employees").delete().eq("id", params.employeeId);
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
      case "get_employee_name": {
        const { data } = await supabase.from("employees").select("name").eq("id", params.employeeId).maybeSingle();
        return json({ name: data?.name ?? null });
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

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: "Server error" }, 500);
  }
});
