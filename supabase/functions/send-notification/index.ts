import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { assignmentId, customerName, projectNumber, changeType } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if we already sent a notification in the last 12 hours
    const { data: existing } = await supabase
      .from("customer_notifications")
      .select("id, last_sent_at")
      .eq("assignment_id", assignmentId)
      .maybeSingle();

    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    if (existing?.last_sent_at && new Date(existing.last_sent_at) > twelveHoursAgo) {
      // Mark as pending instead
      await supabase.from("customer_notifications").upsert({
        assignment_id: assignmentId,
        pending: true,
      }, { onConflict: "assignment_id" });
      return json({ skipped: true, reason: "Rate limited - max 2 per day" });
    }

    // Send email via Supabase built-in SMTP or Resend
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    
    if (RESEND_API_KEY) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // Sender on the verified captfix.app domain. No reply_to is set
          // because this is an internal team notification - if the
          // recipient hits "Reply" they should fall through to the
          // notifications mailbox (or our default behavior), not bounce.
          from: "Captfix <notifications@captfix.app>",
          to: ["info@slwerbung.de"],
          subject: `Kundenaktivität: ${customerName} – Projekt ${projectNumber}`,
          html: `
            <h2>Neue Kundenaktivität</h2>
            <p><strong>Kunde:</strong> ${customerName}</p>
            <p><strong>Projekt:</strong> ${projectNumber}</p>
            <p><strong>Aktion:</strong> ${changeType === "approval" ? "Standorte freigegeben" : "Kommentar hinzugefügt"}</p>
            <p><strong>Zeitpunkt:</strong> ${now.toLocaleString("de-DE")}</p>
            <hr>
            <p style="color:#666;font-size:12px">Diese E-Mail wird maximal 2x täglich versendet.</p>
          `,
        }),
      });
      if (!emailRes.ok) {
        console.error("Resend error:", await emailRes.text());
      }
    }

    // Update notification record
    await supabase.from("customer_notifications").upsert({
      assignment_id: assignmentId,
      last_sent_at: now.toISOString(),
      pending: false,
    }, { onConflict: "assignment_id" });

    return json({ success: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Server error" }, 500);
  }
});
