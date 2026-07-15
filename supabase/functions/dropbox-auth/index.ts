// Edge function: Dropbox OAuth connect flow + Konfiguration.
//
// POST { action: "start", adminToken }       -> { url } authorize-URL für den
//   einmaligen Verbinden-Klick im Admin (token_access_type=offline liefert
//   einen Refresh-Token für die Dauerverbindung).
// POST { action: "get_config" | "set_config" | "disconnect", adminToken }
//   -> Admin-Verwaltung: App-Key/Secret (dropbox_account, service-role-only)
//      und Ordner-Einstellungen (app_config). Secrets gehen nie zurück ans
//      Frontend - nur ob sie gesetzt sind.
// GET  ?code=...&state=...              -> OAuth-Callback von Dropbox:
//   Code gegen Refresh-Token tauschen, Kontoname holen, speichern und
//   zurück in den Admin-Bereich weiterleiten.
//
// App-Key/Secret kommen aus der Tabelle dropbox_account (vom Admin in den
// Integrationen gepflegt — multi-tenant ready, nichts hartkodiert). Der
// state-Parameter ist HMAC-signiert (SESSION_SIGNING_SECRET), damit der
// öffentliche Callback keine fremden Codes untergeschoben bekommt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ADMIN_RETURN_URL = "https://captfix.app/admin";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url } });
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const redirectUri = `${(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "")}/functions/v1/dropbox-auth`;

  try {
    // ── OAuth callback (GET von Dropbox) ────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("error")) {
        return redirect(`${ADMIN_RETURN_URL}?dropbox=denied`);
      }
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";

      // state = "<timestamp>.<hmac(timestamp)>", max 10 Minuten alt.
      const [ts, sig] = state.split(".");
      const expected = ts ? await hmac(ts, getSessionSecret()) : "";
      const fresh = ts && Date.now() - Number(ts) < 10 * 60_000;
      if (!code || !sig || sig !== expected || !fresh) {
        return redirect(`${ADMIN_RETURN_URL}?dropbox=invalid_state`);
      }

      const { data: acc } = await supabase.from("dropbox_account").select("app_key, app_secret").eq("id", 1).maybeSingle();
      if (!acc?.app_key || !acc?.app_secret) return redirect(`${ADMIN_RETURN_URL}?dropbox=missing_credentials`);

      const body = new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        client_id: acc.app_key,
        client_secret: acc.app_secret,
      });
      const resp = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const text = await resp.text();
      if (!resp.ok) {
        console.error("Dropbox token exchange failed:", resp.status, text.slice(0, 300));
        return redirect(`${ADMIN_RETURN_URL}?dropbox=token_error`);
      }
      let tok: any;
      try { tok = JSON.parse(text); } catch { return redirect(`${ADMIN_RETURN_URL}?dropbox=token_error`); }
      if (!tok.refresh_token) {
        console.error("Dropbox: no refresh_token in response");
        return redirect(`${ADMIN_RETURN_URL}?dropbox=token_error`);
      }

      // Kontoname für die Statusanzeige (best-effort).
      let accountName: string | null = null;
      try {
        const who = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
          method: "POST",
          headers: { Authorization: `Bearer ${tok.access_token}` },
        });
        if (who.ok) {
          const w = await who.json();
          accountName = w?.name?.display_name || w?.email || null;
        }
      } catch { /* optional */ }

      await supabase.from("dropbox_account").update({
        refresh_token: tok.refresh_token,
        access_token: tok.access_token || null,
        access_token_expires_at: tok.expires_in
          ? new Date(Date.now() + (Number(tok.expires_in) - 120) * 1000).toISOString()
          : null,
        account_name: accountName,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", 1);

      return redirect(`${ADMIN_RETURN_URL}?dropbox=connected`);
    }

    // ── POST-Aktionen (Admin) ────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const payload = body.adminToken ? await verifySessionToken(body.adminToken, getSessionSecret()) : null;
    if (!payload || payload.role !== "admin") return json({ error: "Unauthorized" }, 401);

    if (body.action === "start") {
      const { data: acc } = await supabase.from("dropbox_account").select("app_key").eq("id", 1).maybeSingle();
      if (!acc?.app_key) return json({ error: "Erst App-Key & Secret speichern." }, 400);
      const ts = String(Date.now());
      const state = `${ts}.${await hmac(ts, getSessionSecret())}`;
      const authUrl =
        `https://www.dropbox.com/oauth2/authorize?client_id=${encodeURIComponent(acc.app_key)}` +
        `&response_type=code&token_access_type=offline` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
      return json({ url: authUrl });
    }

    if (body.action === "get_config") {
      const [{ data: acc }, { data: cfgRows }] = await Promise.all([
        supabase.from("dropbox_account").select("app_key, app_secret, refresh_token, account_name, connected_at").eq("id", 1).maybeSingle(),
        supabase.from("app_config").select("key, value").in("key", [
          "dropbox_enabled", "dropbox_base_path", "dropbox_customer_pattern",
          "dropbox_project_pattern", "dropbox_project_subfolders", "dropbox_customer_alpha_buckets",
        ]),
      ]);
      const cfg = new Map((cfgRows || []).map((r: any) => [r.key, r.value]));
      return json({
        hasAppKey: !!acc?.app_key,
        hasAppSecret: !!acc?.app_secret,
        connected: !!acc?.refresh_token,
        accountName: acc?.account_name || null,
        connectedAt: acc?.connected_at || null,
        enabled: cfg.get("dropbox_enabled") === "true",
        basePath: cfg.get("dropbox_base_path") ?? "/Geschäftliches/Kunden",
        customerPattern: cfg.get("dropbox_customer_pattern") ?? "{kunde}",
        projectPattern: cfg.get("dropbox_project_pattern") ?? "{projektnr} {projektname}",
        projectSubfolders: cfg.get("dropbox_project_subfolders") ?? "",
        alphaBuckets: cfg.get("dropbox_customer_alpha_buckets") === "true",
      });
    }

    if (body.action === "set_config") {
      // App-Credentials nur übernehmen, wenn nicht leer - so löscht ein
      // "Speichern" ohne Neueingabe die gespeicherten Keys nicht.
      const accUpdate: Record<string, unknown> = {};
      if (typeof body.appKey === "string" && body.appKey.trim()) accUpdate.app_key = body.appKey.trim();
      if (typeof body.appSecret === "string" && body.appSecret.trim()) accUpdate.app_secret = body.appSecret.trim();
      if (Object.keys(accUpdate).length > 0) {
        accUpdate.updated_at = new Date().toISOString();
        const { error } = await supabase.from("dropbox_account").upsert({ id: 1, ...accUpdate }, { onConflict: "id" });
        if (error) return json({ error: error.message }, 500);
      }
      const rows: { key: string; value: string }[] = [];
      if (body.enabled !== undefined) rows.push({ key: "dropbox_enabled", value: String(!!body.enabled) });
      if (typeof body.basePath === "string") rows.push({ key: "dropbox_base_path", value: body.basePath.trim() || "/Geschäftliches/Kunden" });
      if (typeof body.customerPattern === "string") rows.push({ key: "dropbox_customer_pattern", value: body.customerPattern.trim() || "{kunde}" });
      if (typeof body.projectPattern === "string") rows.push({ key: "dropbox_project_pattern", value: body.projectPattern.trim() || "{projektnr} {projektname}" });
      if (typeof body.projectSubfolders === "string") rows.push({ key: "dropbox_project_subfolders", value: body.projectSubfolders });
      if (body.alphaBuckets !== undefined) rows.push({ key: "dropbox_customer_alpha_buckets", value: String(!!body.alphaBuckets) });
      if (rows.length > 0) {
        const { error } = await supabase.from("app_config").upsert(rows, { onConflict: "key" });
        if (error) return json({ error: error.message }, 500);
      }
      return json({ success: true });
    }

    if (body.action === "disconnect") {
      await supabase.from("dropbox_account").update({
        refresh_token: null, access_token: null, access_token_expires_at: null,
        account_name: null, connected_at: null, updated_at: new Date().toISOString(),
      }).eq("id", 1);
      return json({ success: true });
    }

    return json({ error: `Unbekannte Aktion: ${body.action}` }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
