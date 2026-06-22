// Edge function: invite a customer to a project for online approval.
//
// Two actions:
//   - lookup_email: best-effort fetch of the customer email from the linked
//     HERO project (project_match). Returns { email } or { email: null }.
//     Never throws on HERO schema mismatches — the dialog falls back to manual
//     entry, which is the intended behaviour.
//   - send: sends the invite email (Resend) with the guest approval link
//     https://captfix.app/guest/<projectId>. Requires a valid employee/admin
//     session token so random callers can't send mail on the company's behalf.
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

const HERO_URL = "https://login.hero-software.de/api/external/v7/graphql";
const APP_BASE = "https://captfix.app";

async function heroQuery(apiKey: string, query: string, variables: Record<string, unknown>) {
  try {
    const resp = await fetch(HERO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables }),
    });
    const text = await resp.text();
    if (!resp.ok) return { error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
    const data = JSON.parse(text);
    if (data.errors?.length) return { error: data.errors[0]?.message || "GraphQL-Fehler" };
    return { data: data.data };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// Best-effort: try a few plausible shapes to read the customer email of a
// HERO project_match. Returns the first email found, plus debug for tuning.
async function lookupHeroEmail(apiKey: string, matchId: number): Promise<{ email: string | null; debug: string[] }> {
  const debug: string[] = [];
  const attempts: { q: string; pick: (m: any) => string | undefined }[] = [
    { q: `query($ids:[Int]){ project_matches(ids:$ids){ id customer{ id email } } }`, pick: (m) => m?.customer?.email },
    { q: `query($ids:[Int]){ project_matches(ids:$ids){ id contact{ id email } } }`, pick: (m) => m?.contact?.email },
    { q: `query($ids:[Int]){ project_matches(ids:$ids){ id customer{ contact_person{ email } } } }`, pick: (m) => m?.customer?.contact_person?.email },
  ];
  for (const a of attempts) {
    const r = await heroQuery(apiKey, a.q, { ids: [matchId] });
    if (r.error) { debug.push(r.error); continue; }
    const m = (r.data as any)?.project_matches?.[0];
    const email = a.pick(m);
    if (email) return { email, debug };
  }
  // Fallback: resolve an id field on the match, then read the contact's email.
  const idAttempts = [
    `query($ids:[Int]){ project_matches(ids:$ids){ id customer_id } }`,
    `query($ids:[Int]){ project_matches(ids:$ids){ id contact_id } }`,
  ];
  for (const q of idAttempts) {
    const r = await heroQuery(apiKey, q, { ids: [matchId] });
    if (r.error) { debug.push(r.error); continue; }
    const m = (r.data as any)?.project_matches?.[0];
    const cid = m?.customer_id ?? m?.contact_id;
    if (cid) {
      const cr = await heroQuery(apiKey, `query($ids:[Int]){ contacts(ids:$ids){ id email } }`, { ids: [Number(cid)] });
      if (cr.error) { debug.push(cr.error); continue; }
      const email = (cr.data as any)?.contacts?.[0]?.email;
      if (email) return { email, debug };
    }
  }
  return { email: null, debug };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildInviteMail(projectNumber: string, projectId: string, note: string) {
  const link = `${APP_BASE}/guest/${projectId}`;
  const noteBlock = note.trim()
    ? `<p style="margin:16px 0;white-space:pre-wrap">${escapeHtml(note.trim())}</p>`
    : "";
  const subject = `Freigabe-Anfrage: Projekt ${projectNumber}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:560px">
      <p>Guten Tag,</p>
      <p>für Ihr Projekt <strong>${escapeHtml(projectNumber)}</strong> haben wir die Standorte und Layouts zur Freigabe vorbereitet.</p>
      <p>Bitte öffnen Sie den folgenden Link, sehen Sie sich die Standorte an und erteilen Sie Ihre Freigabe direkt online – ganz ohne Anmeldung:</p>
      ${noteBlock}
      <p style="margin:24px 0">
        <a href="${link}" style="background:#0E73E8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Standorte ansehen &amp; freigeben</a>
      </p>
      <p style="font-size:13px;color:#666">Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br>${link}</p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <p style="color:#888;font-size:12px;margin:0">Diese Einladung wurde von SL Werbung über Captfix versendet.</p>
    </div>`;
  return { subject, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { action, token } = body;

    // Authn: require a valid employee/admin session token.
    const payload = token ? await verifySessionToken(token, getSessionSecret()) : null;
    if (!payload || (payload.role !== "employee" && payload.role !== "admin")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (action === "lookup_email") {
      const heroProjectId = Number(body.heroProjectId);
      if (!heroProjectId) return json({ email: null });
      const { data: keyRow } = await supabase.from("app_config").select("value").eq("key", "hero_api_key").maybeSingle();
      const apiKey = keyRow?.value;
      if (!apiKey) return json({ email: null });
      const { email, debug } = await lookupHeroEmail(apiKey, heroProjectId);
      return json({ email, ...(body.debug ? { debug } : {}) });
    }

    if (action === "send") {
      const projectId = String(body.projectId || "").trim();
      const email = String(body.email || "").trim();
      const note = String(body.note || "");
      if (!projectId) return json({ error: "projectId fehlt" }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Ungültige E-Mail-Adresse" }, 400);

      // Project number for the subject line.
      const { data: proj } = await supabase.from("projects").select("project_number").eq("id", projectId).maybeSingle();
      const projectNumber = proj?.project_number || projectId.slice(0, 8);

      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY not configured" }, 500);

      const { subject, html } = buildInviteMail(projectNumber, projectId, note);
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Captfix <notifications@captfix.app>", to: [email], subject, html }),
      });
      if (!emailRes.ok) {
        const errText = await emailRes.text();
        return json({ error: `Mailversand fehlgeschlagen: ${errText.slice(0, 200)}` }, 502);
      }
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
