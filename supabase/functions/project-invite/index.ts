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

// Best-effort: read the customer email of a HERO project_match. The
// Ansprechpartner (contact person) is preferred; only when the project has no
// contact do we fall back to the general customer ("Kunde") email. The queries
// are ordered accordingly and the first non-empty hit wins.
async function lookupHeroEmail(apiKey: string, matchId: number): Promise<{ email: string | null; debug: string[] }> {
  const debug: string[] = [];
  const attempts: { q: string; pick: (m: any) => string | undefined }[] = [
    // 1) Ansprechpartner (contact person) — bevorzugt.
    { q: `query($ids:[Int]){ project_matches(ids:$ids){ id contact{ id email } } }`, pick: (m) => m?.contact?.email },
    { q: `query($ids:[Int]){ project_matches(ids:$ids){ id customer{ contact_person{ email } } } }`, pick: (m) => m?.customer?.contact_person?.email },
    // 2) allgemeine Kunden-Mailadresse — nur als Fallback.
    { q: `query($ids:[Int]){ project_matches(ids:$ids){ id customer{ id email } } }`, pick: (m) => m?.customer?.email },
  ];
  for (const a of attempts) {
    const r = await heroQuery(apiKey, a.q, { ids: [matchId] });
    if (r.error) { debug.push(r.error); continue; }
    const m = (r.data as any)?.project_matches?.[0];
    const email = a.pick(m);
    if (email) return { email, debug };
  }
  // Fallback: resolve an id field on the match, then read the contact's email.
  // Same priority — the contact (Ansprechpartner) id before the customer id.
  const idAttempts = [
    `query($ids:[Int]){ project_matches(ids:$ids){ id contact_id } }`,
    `query($ids:[Int]){ project_matches(ids:$ids){ id customer_id } }`,
  ];
  for (const q of idAttempts) {
    const r = await heroQuery(apiKey, q, { ids: [matchId] });
    if (r.error) { debug.push(r.error); continue; }
    const m = (r.data as any)?.project_matches?.[0];
    const cid = m?.contact_id ?? m?.customer_id;
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

// HERO logbook endpoint (v9, matching hero-integration where this mutation is proven).
const HERO_LOGBOOK_URL = "https://login.hero-software.de/api/external/v9/graphql";

// Resolves HERO context for a project: returns { apiKey, heroId } only when the
// integration is enabled AND the project is linked to a HERO project_match.
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

async function heroAddLogbook(apiKey: string, heroProjectId: number, title: string, text: string): Promise<{ ok: boolean; error?: string }> {
  // HERO v9: add_logbook_entry takes a single LogbookEntryInput (no title
  // field); the title is folded into custom_text (required).
  const mutation = `mutation($entry: LogbookEntryInput!) { add_logbook_entry(logbook_entry: $entry) { id } }`;
  const customText = ([title, text].filter(Boolean).join("\n\n") || title).slice(0, 5000);
  try {
    const resp = await fetch(HERO_LOGBOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables: { entry: { target: "project_match", target_id: heroProjectId, custom_text: customText } } }),
    });
    const t = await resp.text();
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}: ${t.slice(0, 200)}` };
    const d = JSON.parse(t);
    if (d.errors?.length) return { ok: false, error: d.errors[0]?.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function buildInviteMail(companyName: string, projectNumber: string, projectId: string, note: string) {
  const link = `${APP_BASE}/guest/${projectId}`;
  const noteBlock = note.trim()
    ? `<p style="margin:16px 0;white-space:pre-wrap">${escapeHtml(note.trim())}</p>`
    : "";
  const subject = `Korrektur / Freigabe – Einladung von ${companyName} · Projekt ${projectNumber}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:560px;line-height:1.5">
      <p>Guten Tag,</p>
      <p><strong>${escapeHtml(companyName)}</strong> hat für Ihr Projekt <strong>${escapeHtml(projectNumber)}</strong> die Standorte zur Freigabe bereitgestellt. Die Prüfung läuft online über <strong>Captfix</strong> (captfix.app).</p>
      ${noteBlock}
      <p style="margin:16px 0"><strong>So geht's:</strong> Link öffnen, Ihren Namen eingeben, dann Standorte freigeben oder Korrekturen hinterlassen.</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#0E73E8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Standorte ansehen &amp; freigeben</a>
      </p>
      <p style="font-size:13px;color:#666">Link: ${link}</p>
      <p style="margin-top:20px">Mit freundlichen Grüßen<br>${escapeHtml(companyName)}</p>
    </div>`;
  return { subject, html };
}

// Wraps the employee-edited plain-text protocol in the branded mail shell.
// Bullet lines ("- …") become a proper list; blank lines become spacing;
// everything else becomes a paragraph. Kept intentionally simple so the text
// the employee sees in the composer is what the customer receives.
function buildProtocolMail(companyName: string, bodyText: string): string {
  const blocks: string[] = [];
  let listItems: string[] = [];
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<ul style="margin:8px 0;padding-left:20px">${listItems.map((li) => `<li style="margin:2px 0">${li}</li>`).join("")}</ul>`);
    listItems = [];
  };
  for (const raw of bodyText.split("\n")) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) { listItems.push(escapeHtml(bullet[1])); continue; }
    flushList();
    blocks.push(`<p style="margin:12px 0">${escapeHtml(line)}</p>`);
  }
  flushList();
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:600px;line-height:1.5">
      ${blocks.join("\n")}
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <p style="font-size:13px;color:#666;margin:0">Mit freundlichen Grüßen<br>${escapeHtml(companyName)}</p>
    </div>`;
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

    // Like lookup_email but resolves the HERO project id from a Captfix
    // projectId (used by the protocol-send dialog, which knows the project but
    // not the HERO id). Returns { email: null } silently when nothing matches.
    if (action === "protocol_lookup_email") {
      const projectId = String(body.projectId || "").trim();
      if (!projectId) return json({ email: null });
      const hctx = await heroContext(supabase, projectId);
      if (!hctx) return json({ email: null });
      const { email } = await lookupHeroEmail(hctx.apiKey, hctx.heroId);
      return json({ email });
    }

    // Sends a meeting protocol to a customer/recipient. The employee edits the
    // subject and body in the app; we wrap the (plain-text) body in the branded
    // mail shell and log the send to HERO when the note is project-bound.
    if (action === "send_protocol") {
      const email = String(body.email || "").trim();
      const subject = String(body.subject || "").trim() || "Protokoll";
      const bodyText = String(body.bodyText || "");
      const projectId = String(body.projectId || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Ungültige E-Mail-Adresse" }, 400);
      if (!bodyText.trim()) return json({ error: "Kein Inhalt" }, 400);

      let companyName = "SL WERBUNG";
      const { data: legalRow } = await supabase.from("app_config").select("value").eq("key", "legal_info").maybeSingle();
      if (legalRow?.value) {
        try {
          const info = JSON.parse(legalRow.value);
          if (info?.companyName && String(info.companyName).trim()) companyName = String(info.companyName).trim();
        } catch { /* keep default */ }
      }

      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY not configured" }, 500);

      const html = buildProtocolMail(companyName, bodyText);
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Captfix <notifications@captfix.app>", to: [email], subject, html }),
      });
      if (!emailRes.ok) {
        const errText = await emailRes.text();
        return json({ error: `Mailversand fehlgeschlagen: ${errText.slice(0, 200)}` }, 502);
      }

      // HERO logbook entry (best-effort) when the protocol belongs to a project.
      if (projectId) {
        try {
          const hctx = await heroContext(supabase, projectId);
          if (hctx) {
            await heroAddLogbook(hctx.apiKey, hctx.heroId, "Captfix: Protokoll an Kunde gesendet", `An: ${email}\nBetreff: ${subject}\n\n${bodyText}`.slice(0, 5000));
          }
        } catch { /* logbook is best-effort */ }
      }

      return json({ success: true });
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

      // Company name from settings (legal_info). Multi-tenant ready: later this
      // comes from the tenant's settings instead of the single legal_info row.
      let companyName = "SL WERBUNG";
      const { data: legalRow } = await supabase.from("app_config").select("value").eq("key", "legal_info").maybeSingle();
      if (legalRow?.value) {
        try {
          const info = JSON.parse(legalRow.value);
          if (info?.companyName && String(info.companyName).trim()) companyName = String(info.companyName).trim();
        } catch { /* keep default */ }
      }

      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY not configured" }, 500);

      const { subject, html } = buildInviteMail(companyName, projectNumber, projectId, note);
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Captfix <notifications@captfix.app>", to: [email], subject, html }),
      });
      if (!emailRes.ok) {
        const errText = await emailRes.text();
        return json({ error: `Mailversand fehlgeschlagen: ${errText.slice(0, 200)}` }, 502);
      }

      // Track invite for reminder follow-up (best-effort).
      try {
        await supabase.from("project_invites").insert({
          project_id: projectId,
          project_number: projectNumber,
          email,
          sent_at: new Date().toISOString(),
        });
      } catch { /* non-blocking */ }

      // HERO logbook entry (best-effort; never blocks the invite result).
      try {
        const hctx = await heroContext(supabase, projectId);
        if (hctx) {
          const logText =
            `Einladung zur Korrektur/Freigabe an ${email} versendet.\n\n` +
            `Betreff: ${subject}\n` +
            `Link: ${APP_BASE}/guest/${projectId}` +
            (note.trim() ? `\n\nPersönliche Nachricht:\n${note.trim()}` : "");
          await heroAddLogbook(hctx.apiKey, hctx.heroId, "Captfix: Einladung versendet", logText);
        }
      } catch { /* logbook is best-effort */ }

      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
