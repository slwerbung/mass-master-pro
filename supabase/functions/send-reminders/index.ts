// Edge function: send reminder emails to customers who were invited but
// haven't responded after a configurable number of days.
//
// "Responded" means: any location_feedback written by a customer on a
// location that belongs to the project. If none exists, we consider the
// customer to have not yet interacted — and we send a reminder.
//
// Called by the admin panel (manual trigger). Returns a summary of what
// was sent / skipped.
//
// Requires a valid admin session token in body.token.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_BASE = "https://captfix.app";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildReminderMail(
  companyName: string,
  projectNumber: string,
  projectId: string,
  customText: string,
): { subject: string; html: string } {
  const link = `${APP_BASE}/guest/${projectId}`;
  const customBlock = customText.trim()
    ? `<p style="margin:16px 0;white-space:pre-wrap">${escapeHtml(customText.trim())}</p>`
    : "";
  const subject = `Erinnerung: Freigabe ausstehend – Projekt ${projectNumber}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:560px;line-height:1.5">
      <p>Guten Tag,</p>
      <p>wir erinnern freundlich daran, dass von <strong>${escapeHtml(companyName)}</strong> Standorte für Ihr Projekt <strong>${escapeHtml(projectNumber)}</strong> auf Ihre Freigabe warten.</p>
      ${customBlock}
      <p>Mit einem Klick auf den Link können Sie die Standorte prüfen und freigeben oder Korrekturen hinterlassen:</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#0E73E8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Standorte ansehen &amp; freigeben</a>
      </p>
      <p style="font-size:13px;color:#666">Link: ${link}</p>
      <p style="margin-top:20px">Mit freundlichen Grüßen<br>${escapeHtml(companyName)}</p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <p style="color:#888;font-size:12px;margin:0">Diese Erinnerung wurde automatisch von Captfix gesendet.</p>
    </div>`;
  return { subject, html };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { token } = body;

    // Require admin session.
    const secret = getSessionSecret();
    const payload = token ? await verifySessionToken(token, secret) : null;
    if (!payload || payload.role !== "admin") {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load settings from app_config.
    const { data: cfgRows } = await supabase
      .from("app_config")
      .select("key, value")
      .in("key", [
        "reminder_enabled",
        "reminder_days",
        "reminder_email_text",
        "notification_global_email",
        "legal_info",
      ]);
    const cfg = new Map((cfgRows || []).map((r: any) => [r.key, r.value]));

    const enabled = cfg.get("reminder_enabled") === "true";
    if (!enabled) {
      return json({ skipped: true, reason: "Erinnerungen sind deaktiviert" });
    }

    const recipientEmail = (cfg.get("notification_global_email") || "").trim();
    const reminderDays = Math.max(1, parseInt(cfg.get("reminder_days") || "3", 10));
    const customText = cfg.get("reminder_email_text") || "";

    let companyName = "SL WERBUNG";
    const legalRaw = cfg.get("legal_info");
    if (legalRaw) {
      try {
        const info = JSON.parse(legalRaw);
        if (info?.companyName?.trim()) companyName = info.companyName.trim();
      } catch { /* keep default */ }
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return json({ error: "RESEND_API_KEY nicht konfiguriert" }, 500);
    }

    // Find invites that are old enough and haven't had a reminder yet.
    const cutoff = new Date(Date.now() - reminderDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: invites, error: invErr } = await supabase
      .from("project_invites")
      .select("id, project_id, project_number, email, sent_at")
      .lte("sent_at", cutoff)
      .is("reminder_sent_at", null);

    if (invErr) {
      return json({ error: invErr.message }, 500);
    }
    if (!invites || invites.length === 0) {
      return json({ sent: 0, skipped: 0, reason: "Keine ausstehenden Einladungen" });
    }

    // For each invite, check if the customer has already responded by looking
    // for any customer-authored location_feedback for the project.
    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const invite of invites) {
      // Check customer activity via location_feedback (join locations to get project).
      const { count: feedbackCount } = await supabase
        .from("location_feedback")
        .select("id", { count: "exact", head: true })
        .eq("author_type", "customer")
        .in(
          "location_id",
          // Sub-select: get all location ids for this project.
          // We do this via a separate query since Supabase JS doesn't support subqueries directly.
          (await supabase
            .from("locations")
            .select("id")
            .eq("project_id", invite.project_id)
            .then(({ data }) => (data || []).map((l: any) => l.id))),
        );

      if ((feedbackCount || 0) > 0) {
        // Customer has already responded — mark as done (no reminder needed).
        await supabase
          .from("project_invites")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", invite.id);
        skipped++;
        continue;
      }

      // Send the reminder.
      const projectNumber = invite.project_number || invite.project_id.slice(0, 8);
      const { subject, html } = buildReminderMail(companyName, projectNumber, invite.project_id, customText);

      const mailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Captfix <notifications@captfix.app>",
          to: [invite.email],
          ...(recipientEmail ? { bcc: [recipientEmail] } : {}),
          subject,
          html,
        }),
      });

      if (mailRes.ok) {
        await supabase
          .from("project_invites")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", invite.id);
        sent++;
      } else {
        const errText = await mailRes.text();
        errors.push(`${invite.email}: ${errText.slice(0, 100)}`);
      }
    }

    return json({ sent, skipped, errors: errors.length > 0 ? errors : undefined });
  } catch (e: any) {
    return json({ error: e.message || String(e) }, 500);
  }
});
