import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
 *     Sent each time the assignment transitions into the fully-approved
 *     state.
 *
 * The decision whether to actually send (vs skip due to throttling) is
 * made server-side based on the customer_notifications row for the
 * assignment. The frontend simply signals that something happened.
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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch context: customer name + project number from the assignment.
    // We need this for the email content. Done via service-role so we
    // bypass RLS and don't need any client auth context.
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

    // Load existing notification record (if any) to check throttle status.
    const { data: existing } = await supabase
      .from("customer_notifications")
      .select("*")
      .eq("assignment_id", assignmentId)
      .maybeSingle();

    const now = new Date();
    let shouldSend = false;
    const updateFields: Record<string, any> = {};

    if (event === "first_action") {
      // Send only if we never sent a first_action notification yet.
      if (!existing?.first_action_sent_at) {
        shouldSend = true;
        updateFields.first_action_sent_at = now.toISOString();
      }
    } else if (event === "comment") {
      // Send if no previous comment notification or if it's older than
      // the throttle window.
      const last = existing?.last_comment_sent_at ? new Date(existing.last_comment_sent_at) : null;
      const throttleMs = COMMENT_THROTTLE_HOURS * 60 * 60 * 1000;
      if (!last || now.getTime() - last.getTime() > throttleMs) {
        shouldSend = true;
        updateFields.last_comment_sent_at = now.toISOString();
      }
    } else if (event === "completion") {
      // Re-check completion status server-side: count locations vs
      // approvals. We want to fire only when the assignment is *now*
      // fully approved AND we haven't yet sent a completion mail for
      // this transition (i.e. completion_sent_at is null - which the
      // frontend resets when an unapproval happens).
      const { count: totalLocs } = await supabase
        .from("locations")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      const { count: approvedCount } = await supabase
        .from("location_approvals")
        .select("id", { count: "exact", head: true })
        .eq("assignment_id", assignmentId)
        .eq("approved", true);
      const allApproved = (totalLocs || 0) > 0 && (totalLocs || 0) === (approvedCount || 0);
      if (allApproved && !existing?.completion_sent_at) {
        shouldSend = true;
        updateFields.completion_sent_at = now.toISOString();
      }
    } else {
      return json({ error: `Unknown event type: ${event}` }, 400);
    }

    if (!shouldSend) {
      return json({ skipped: true, reason: "throttled or already sent" });
    }

    // Compose mail.
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
        to: ["info@slwerbung.de"],
        subject,
        html,
      }),
    });
    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      return json({ error: "Mail-Versand fehlgeschlagen", details: errText }, 500);
    }

    // Persist the timestamp(s) we set above. Upsert so we create the
    // row if it didn't exist yet for this assignment.
    await supabase.from("customer_notifications").upsert({
      assignment_id: assignmentId,
      ...updateFields,
    }, { onConflict: "assignment_id" });

    return json({ sent: true, event });
  } catch (e: any) {
    console.error(e);
    return json({ error: "Server error", details: e.message }, 500);
  }
});

function buildMail(event: EventType, ctx: { customerName: string; projectNumber: string; projectId: string }): { subject: string; html: string } {
  // Plain-but-clear team mails. Always include a link to the project
  // (in the app) so the team member can click and inspect what happened.
  // The subject prefix tells at a glance which type of activity it is.
  const projectUrl = `https://mass-master-pro.vercel.app/projects/${ctx.projectId}`;
  const linkBlock = `<p style="margin-top:20px"><a href="${projectUrl}" style="background:#0E73E8;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:500">Projekt öffnen</a></p>`;
  const footer = `<hr style="margin:24px 0;border:none;border-top:1px solid #eee"><p style="color:#888;font-size:12px;margin:0">Diese Benachrichtigung wurde von Captfix automatisch erstellt.</p>`;

  if (event === "first_action") {
    return {
      subject: `Aktivität: ${ctx.customerName} - Projekt ${ctx.projectNumber}`,
      html: `
        <h2 style="margin:0 0 12px">Kunde ist aktiv geworden</h2>
        <p><strong>${escapeHtml(ctx.customerName)}</strong> hat in Projekt <strong>${escapeHtml(ctx.projectNumber)}</strong> erstmals eine Aktion durchgeführt (Freigabe oder Kommentar).</p>
        ${linkBlock}
        ${footer}
      `,
    };
  }
  if (event === "comment") {
    return {
      subject: `Kommentar: ${ctx.customerName} - Projekt ${ctx.projectNumber}`,
      html: `
        <h2 style="margin:0 0 12px">Neue Kommentare im Projekt</h2>
        <p><strong>${escapeHtml(ctx.customerName)}</strong> hat in Projekt <strong>${escapeHtml(ctx.projectNumber)}</strong> Kommentare hinzugefügt.</p>
        <p style="color:#666;font-size:14px">Hinweis: Folgekommentare innerhalb der nächsten ${COMMENT_THROTTLE_HOURS} Stunden werden nicht erneut gemeldet.</p>
        ${linkBlock}
        ${footer}
      `,
    };
  }
  // completion
  return {
    subject: `Freigegeben: ${ctx.customerName} - Projekt ${ctx.projectNumber}`,
    html: `
      <h2 style="margin:0 0 12px;color:#0a8443">Projekt komplett freigegeben</h2>
      <p><strong>${escapeHtml(ctx.customerName)}</strong> hat alle Standorte des Projekts <strong>${escapeHtml(ctx.projectNumber)}</strong> freigegeben.</p>
      <p>Das Projekt kann in Produktion gehen.</p>
      ${linkBlock}
      ${footer}
    `,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
