// HTTP-Huelle der Mail-Assistenten-Functions.
//
// Antworten sind IMMER HTTP 200 mit { ok: true, data } oder { ok: false, error },
// weil supabase.functions.invoke andere Statuscodes verschluckt (nur „non-2xx").

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function ok(data: unknown = null): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export function fail(error: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response(null, { status: 204, headers: corsHeaders }) : null;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Cron-Aufruf: Header `x-cron-secret` muss zum Secret passen. Gueltig ist
 * EMAIL_CRON_SECRET (Edge Function Secret) oder `app_config.email_cron_secret`
 * (liest pg_cron zur Laufzeit). Ist KEINES von beiden gesetzt, wird jeder
 * Aufruf abgelehnt.
 */
export async function isCronCall(req: Request, sb: any): Promise<boolean> {
  const given = req.headers.get("x-cron-secret") || "";
  if (given.length < 16) return false;
  const env = (globalThis as any).Deno?.env?.get("EMAIL_CRON_SECRET");
  if (env && timingSafeEqual(given, env)) return true;
  const { data } = await sb.from("app_config").select("value").eq("key", "email_cron_secret").maybeSingle();
  const stored = data?.value ? String(data.value) : "";
  return stored.length >= 16 && timingSafeEqual(given, stored);
}

export interface AdminUser { id: string; email: string | null; name: string }

/** Supabase-Auth-Sitzung mit Rolle `admin` (profiles.role, aktiv). */
export async function requireAdmin(req: Request, sb: any): Promise<AdminUser | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: prof } = await sb.from("profiles").select("display_name, role, is_active").eq("id", data.user.id).maybeSingle();
  if (!prof || prof.role !== "admin" || prof.is_active === false) return null;
  return { id: data.user.id, email: data.user.email ?? null, name: prof.display_name };
}

export async function readJson(req: Request): Promise<Record<string, any>> {
  try {
    const t = await req.text();
    return t ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}
