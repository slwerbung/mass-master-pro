// Edge function: reminder-email settings + send log for the Admin panel.
//
// Split out of admin-manage (like employee-auth) so that large function does
// not keep growing. Requires a valid admin session token in body.token.
//
// Actions:
//   - get_reminder_settings: current enabled/days/subject/body + pending count
//   - set_reminder_settings: persist enabled/days/subject/body
//   - get_reminder_log: last 20 reminder sends (audit trail)
//
// NOTE: app_config.value is NOT NULL in production, so we NEVER write null —
// empty strings only. Writing null was the "Fehler beim Speichern".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
    const { token, action, ...params } = body;

    const payload = token ? await verifySessionToken(token, getSessionSecret()) : null;
    if (!payload || payload.role !== "admin") {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "get_reminder_settings") {
      const { data } = await supabase
        .from("app_config")
        .select("key, value")
        .in("key", ["reminder_enabled", "reminder_days", "reminder_email_subject", "reminder_email_text"]);
      const map = new Map((data || []).map((r: any) => [r.key, r.value]));
      const reminderDays = Math.max(1, parseInt(map.get("reminder_days") || "3", 10));
      const cutoff = new Date(Date.now() - reminderDays * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("project_invites")
        .select("id", { count: "exact", head: true })
        .lte("sent_at", cutoff)
        .is("reminder_sent_at", null);
      return json({
        enabled: map.get("reminder_enabled") === "true",
        days: parseInt(map.get("reminder_days") || "3", 10),
        emailSubject: map.get("reminder_email_subject") || "",
        emailText: map.get("reminder_email_text") || "",
        pendingInvites: count || 0,
      });
    }

    if (action === "set_reminder_settings") {
      const updates: { key: string; value: string }[] = [];
      if ("enabled" in params) {
        updates.push({ key: "reminder_enabled", value: params.enabled ? "true" : "false" });
      }
      if ("days" in params) {
        const days = Math.max(1, Math.min(30, parseInt(String(params.days), 10) || 3));
        updates.push({ key: "reminder_days", value: String(days) });
      }
      if ("emailSubject" in params) {
        updates.push({ key: "reminder_email_subject", value: String(params.emailSubject || "").slice(0, 300) });
      }
      if ("emailText" in params) {
        updates.push({ key: "reminder_email_text", value: String(params.emailText || "").slice(0, 4000) });
      }
      for (const u of updates) {
        const { error } = await supabase
          .from("app_config")
          .upsert({ ...u, updated_at: new Date().toISOString() }, { onConflict: "key" });
        if (error) return json({ error: error.message }, 500);
      }
      return json({ success: true });
    }

    if (action === "get_reminder_log") {
      const { data } = await supabase
        .from("reminder_log")
        .select("email, project_number, status, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      return json({ log: data || [] });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: e.message || String(e) }, 500);
  }
});
