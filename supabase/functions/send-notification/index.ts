import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchAutomations } from "../_shared/automations.ts";

const HERO_LOGBOOK_URL = "https://login.hero-software.de/api/external/v9/graphql";

async function heroContext(supabase: any, projectId: string): Promise<{ apiKey: string; heroId: number } | null> {
  const { data: cfg } = await supabase.from("app_config").select("key,value").in("key", ["hero_api_key", "hero_enabled"]);
  const map = new Map((cfg || []).map((r: any) => [r.key, r.value]));
  const apiKey = map.get("hero_api_key") as string | undefined;
  const enabled = map.get("hero_enabled") === "true" || map.get("hero_enabled") === true;
  if (!enabled || !apiKey) return null;
  const { data: proj } = await supabase.from("projects").select("custom_fields").eq("id", projectId).maybeSingle();
  const raw = proj?.custom_fields?.__hero_project_id;
  const heroId = Number(raw);
  if (!Number.isFinite(heroId) || heroId <= 0) return null;
  return { apiKey, heroId };
}

async function heroAddLogbook(apiKey: string, heroProjectId: number, title: string, text: string): Promise<void> {
  const mutation = `mutation($projectId: Int!, $title: String!, $text: String) { add_logbook_entry(project_match_id: $projectId, custom_title: $title, custom_text: $text) { id } }`;
  try {
    await fetch(HERO_LOGBOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { projectId: heroProjectId, title: title.slice(0, 500), text: text ? text.slice(0, 5000) : null } }),
    });
  } catch { /* best-effort */ }
}

/**
 * Customer activity notifications. Triggered from the customer-facing
 * approval/commenting flow. Three event types, each with its own
 * throttling logic - all driven from a single function so the throttle
 * decisions stay in one place.
 *
 * Events:
 *   - first_action: customer approved a location or wrote a comment for
 *     the first time on this assignment. Sent ONCE per assignment.
 *   - comment: a new comment was added. Sent at most once every 4 hours
 *     per assignment so a series of comments don't spam the team.
 *   - completion: all locations of the assignment are now approved.
 *
 * On completion we ALSO fire the "project_fully_approved" automation
 * trigger (deduped via customer_notifications.hero_pdf_sent_at). This is
 * deliberately independent of the e-mail notification settings: the HERO
 * Aufmaß-PDF upload runs even if the completion e-mail is disabled or no
 * recipient is configured. The actual upload is an automation action the
 * admin configures (WENN Projekt vollständig freigegeben → DANN HERO:
 * Aufmaß-PDF hochladen).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const COMMENT_THROTTLE_HOURS = 4;

type EventType = "first_action" | "comment" | "completion";

// Fires the project_fully_approved automation trigger once per completion.
// Best-effort, deduped via hero_pdf_sent_at; never throws into the caller.
async function fireCompletionAutomation(
  supabase: any,
  assignmentId: string,
  projectId: string,
  customerName: string,
  projectNumber: string,
  existing: any,
  isComplete: boolean,
): Promise<void> {
  try {
    if (isComplete && !existing?.hero_pdf_sent_at) {
      const hctx = await heroContext(supabase, projectId);
      if (hctx) {
        await heroAddLogbook(
          hctx.apiKey, hctx.heroId,
          "Captfix: Freigabe durch Kunde",
          `${customerName} hat das Projekt ${projectNumber} vollständig freigegeben.`,
        );
      }
      await dispatchAutomations(supabase, "project_fully_approved", {
        projectId,
        heroProjectId: hctx?.heroId ?? null,
        customerName,
        projectNumber,
      });
      // Mark as fired so re-approvals don't re-upload. Merges with the
      // e-mail-related columns (upsert only sets provided columns).
      await supabase.from("customer_notifications").upsert(
        { assignment_id: assignmentId, hero_pdf_sent_at: new Date().toISOString() },
        { onConflict: "assignment_id" },
      );
    } else if (!isComplete && existing?.hero_pdf_sent_at) {
      // No longer fully approved → clear so the next completion re-fires.
      await supabase.from("customer_notifications")
        .update({ hero_pdf_sent_at: null })
        .eq("assignment_id", assignmentId);
    }
  } catch (e) {
    console.warn("completion automation dispatch failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { event, assignmentId } = body as { event: EventType; assignmentId: string };

    if (!event || !assignmentId) {
      return json({ error: "event and assignmentId required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: assignment, error: aErr } = await supabase
      .from("customer_project_assignments")
      .select("id, customer_id, project_id, customers(name), projects(project_number)")
      .eq("id", assignmentId)
      .maybeSingle();

    if (aErr || !assignment) {
      return json({ error: "Assignment not found", details: aErr?.message }, 404);
    }

    const customerName = (assignment as any).customers?.name || "Unbekannter Kunde";
    const projectNumber = (assignment as any).projects?.project_number || "?";
    const projectId = (assignment as any).project_id;

    const { data: existing } = await supabase
      .from("customer_notifications")
      .select("*")
      .eq("assignment_id", assignmentId)
      .maybeSingle();

    const now = new Date();
    let shouldSend = false;
    const updateFields: Record<string, any> = {};

    if (event === "first_action") {
      return json({ skipped: true, reason: "first_action is no-op now" });
    } else if (event === "comment") {
      const last = existing?.last_comment_sent_at ? new Date(existing.last_comment_sent_at) : null;
      const throttleMs = COMMENT_THROTTLE_HOURS * 60 * 60 * 1000;
      if (!last || now.getTime() - last.getTime() > throttleMs) {
        shouldSend = true;
        updateFields.last_comment_sent_at = now.toISOString();
      }
    } else if (event === "completion") {
      const { data: projData } = await supabase
        .from("projects")
        .select("project_type")
        .eq("id", projectId)
        .maybeSingle();
      const projectType = (projData?.project_type as string) || "standort";
      const isVehicle = projectType.includes("fahrzeug");

      let isComplete = false;
      if (isVehicle) {
        const { data: vehicleApproval } = await supabase
          .from("vehicle_layout_approval")
          .select("approved")
          .eq("project_id", projectId)
          .eq("assignment_id", assignmentId)
          .maybeSingle();
        isComplete = !!vehicleApproval?.approved;
      } else {
        const { count: totalLocs } = await supabase
          .from("locations")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId);
        const { count: approvedCount } = await supabase
          .from("location_approvals")
          .select("id", { count: "exact", head: true })
          .eq("assignment_id", assignmentId)
          .eq("approved", true);
        isComplete = (totalLocs || 0) > 0 && (totalLocs || 0) === (approvedCount || 0);
      }

      // Fire the automation trigger BEFORE the e-mail gating below, so the
      // HERO upload is independent of e-mail settings.
      await fireCompletionAutomation(supabase, assignmentId, projectId, customerName, projectNumber, existing, isComplete);

      if (isComplete && !existing?.completion_sent_at) {
        shouldSend = true;
        updateFields.completion_sent_at = now.toISOString();
      } else if (!isComplete && existing?.completion_sent_at) {
        await supabase.from("customer_notifications")
          .update({ completion_sent_at: null })
          .eq("assignment_id", assignmentId);
      }
    } else {
      return json({ error: `Unknown event type: ${event}` }, 400);
    }

    if (!shouldSend) {
      return json({ skipped: true, reason: "throttled or already sent" });
    }

    const [globalEmailRow, settingsRow, projectRow] = await Promise.all([
      supabase.from("app_config").select("value").eq("key", "notification_global_email").maybeSingle(),
      supabase.from("app_config").select("value").eq("key", "notification_settings").maybeSingle(),
      supabase.from("projects").select("employee_id").eq("id", projectId).maybeSingle(),
    ]);

    const globalEmail = (globalEmailRow.data?.value || "").trim();
    let parsedSettings: any = {};
    if (settingsRow.data?.value) {
      try { parsedSettings = JSON.parse(settingsRow.data.value) || {}; } catch { parsedSettings = {}; }
    }
    const eventSetting = parsedSettings[event] || { enabled: false, target: "global" };

    if (!eventSetting.enabled) {
      return json({ skipped: true, reason: "event disabled in settings" });
    }

    let recipientEmail: string | null = null;
    if (eventSetting.target === "assigned_employee" && projectRow.data?.employee_id) {
      const { data: emp } = await supabase
        .from("employees")
        .select("email")
        .eq("id", projectRow.data.employee_id)
        .maybeSingle();
      recipientEmail = (emp?.email || "").trim() || null;
    }
    if (!recipientEmail) {
      recipientEmail = globalEmail || null;
    }

    if (!recipientEmail) {
      return json({ skipped: true, reason: "no recipient configured" });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return json({ error: "RESEND_API_KEY not configured" }, 500);
    }

    const { subject, html } = buildMail(event, { customerName, projectNumber, projectId });

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Captfix <notifications@captfix.app>",
        to: [recipientEmail],
        subject,
        html,
      }),
    });
    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      return json({ error: "Mail-Versand fehlgeschlagen", details: errText }, 500);
    }

    await supabase.from("customer_notifications").upsert({
      assignment_id: assignmentId,
      ...updateFields,
    }, { onConflict: "assignment_id" });

    return json({ sent: true, event, recipient: recipientEmail });
  } catch (e: any) {
    console.error(e);
    return json({ error: "Server error", details: e.message }, 500);
  }
});

function buildMail(event: EventType, ctx: { customerName: string; projectNumber: string; projectId: string }): { subject: string; html: string } {
  const projectUrl = `https://captfix.app/projects/${ctx.projectId}`;
  const linkBlock = `<p style="margin-top:20px"><a href="${projectUrl}" style="background:#0E73E8;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:500">Projekt öffnen</a></p>`;
  const footer = `<hr style="margin:24px 0;border:none;border-top:1px solid #eee"><p style="color:#888;font-size:12px;margin:0">Diese Benachrichtigung wurde von Captfix automatisch erstellt.</p>`;

  if (event === "comment") {
    return {
      subject: `Neuer Kommentar: ${ctx.customerName} – Projekt ${ctx.projectNumber}`,
      html: `
        <h2 style="margin:0 0 12px">Neuer Kommentar im Projekt</h2>
        <p><strong>${escapeHtml(ctx.customerName)}</strong> hat in Projekt <strong>${escapeHtml(ctx.projectNumber)}</strong> einen Hinweis oder Kommentar hinterlassen.</p>
        <p style="color:#666;font-size:14px">Den Inhalt findest du im Projekt. Folgekommentare innerhalb der nächsten ${COMMENT_THROTTLE_HOURS} Stunden werden nicht erneut gemeldet.</p>
        ${linkBlock}
        ${footer}
      `,
    };
  }
  // completion
  return {
    subject: `FREIGEGEBEN: ${ctx.customerName} – Projekt ${ctx.projectNumber}`,
    html: `
      <h2 style="margin:0 0 12px;color:#0a8443">Projekt freigegeben</h2>
      <p style="font-size:16px"><strong>${escapeHtml(ctx.customerName)}</strong> hat das Projekt <strong>${escapeHtml(ctx.projectNumber)}</strong> komplett freigegeben.</p>
      <p>Das Projekt kann jetzt in Produktion gehen.</p>
      ${linkBlock}
      ${footer}
    `,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
