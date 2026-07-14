// Shared Dropbox helper for edge functions.
//
// Credentials & tokens live in the service-role-only table dropbox_account
// (single row, id=1): app_key/app_secret are entered by the admin in the
// Integrations tab (multi-tenant ready — nothing is hardcoded), the
// refresh_token comes from the one-time OAuth connect flow (dropbox-auth).
// Non-secret settings (base path, name patterns, subfolder template) live in
// app_config under dropbox_* keys.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const API_BASE = "https://api.dropboxapi.com/2";

export interface DropboxSettings {
  enabled: boolean;
  basePath: string;
  customerPattern: string;
  projectPattern: string;
  subfolders: string[];
}

export async function loadDropboxSettings(supabase: SupabaseClient): Promise<DropboxSettings> {
  const { data } = await supabase.from("app_config").select("key, value").in("key", [
    "dropbox_enabled", "dropbox_base_path", "dropbox_customer_pattern",
    "dropbox_project_pattern", "dropbox_project_subfolders",
  ]);
  const map = new Map((data || []).map((r: any) => [r.key, r.value as string]));
  const subfolders = String(map.get("dropbox_project_subfolders") || "")
    .split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    enabled: map.get("dropbox_enabled") === "true",
    basePath: normalizePath(String(map.get("dropbox_base_path") || "/Geschäftliches/Kunden")),
    customerPattern: String(map.get("dropbox_customer_pattern") || "{kunde}"),
    projectPattern: String(map.get("dropbox_project_pattern") || "{projektnr} {projektname}"),
    subfolders,
  };
}

// A single path segment must not contain slashes or characters Dropbox
// rejects; collapse whitespace so patterns with empty placeholders stay tidy.
export function sanitizeSegment(s: string): string {
  return String(s || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
}

export function normalizePath(p: string): string {
  const cleaned = "/" + String(p || "").split("/").map((s) => s.trim()).filter(Boolean).join("/");
  return cleaned === "/" ? "" : cleaned;
}

// Replace {kunde}, {kundennr}, {projektnr}, {projektname} (case-insensitive).
export function buildName(pattern: string, vars: Record<string, string | undefined>): string {
  let out = pattern;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "gi"), v || "");
  }
  return sanitizeSegment(out) || "Unbenannt";
}

// ── OAuth token handling ────────────────────────────────────────────────
export async function getDropboxAccessToken(supabase: SupabaseClient): Promise<{ token: string } | { error: string }> {
  const { data: acc } = await supabase.from("dropbox_account").select("*").eq("id", 1).maybeSingle();
  if (!acc?.app_key || !acc?.app_secret) return { error: "Dropbox App-Key/Secret fehlen (Admin → Integrationen)." };
  if (!acc?.refresh_token) return { error: "Dropbox ist nicht verbunden (Admin → Integrationen → Verbinden)." };

  const expiresAt = acc.access_token_expires_at ? new Date(acc.access_token_expires_at).getTime() : 0;
  if (acc.access_token && expiresAt > Date.now() + 60_000) {
    return { token: acc.access_token };
  }

  // Refresh
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: acc.refresh_token,
    client_id: acc.app_key,
    client_secret: acc.app_secret,
  });
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) return { error: `Dropbox Token-Refresh fehlgeschlagen (HTTP ${resp.status}): ${text.slice(0, 200)}` };
  let json: any;
  try { json = JSON.parse(text); } catch { return { error: "Dropbox Token-Refresh: keine JSON-Antwort" }; }
  const token = json.access_token as string | undefined;
  const expiresIn = Number(json.expires_in || 14400);
  if (!token) return { error: "Dropbox Token-Refresh: kein access_token" };

  await supabase.from("dropbox_account").update({
    access_token: token,
    access_token_expires_at: new Date(Date.now() + (expiresIn - 120) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", 1);

  return { token };
}

// ── Folder ops ──────────────────────────────────────────────────────────
// create_folder_v2 creates missing parent folders implicitly; a
// path/conflict/folder error means it already exists — that's success for us.
export async function dbxEnsureFolder(token: string, path: string): Promise<{ ok: boolean; existed?: boolean; error?: string }> {
  const resp = await fetch(`${API_BASE}/files/create_folder_v2`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, autorename: false }),
  });
  const text = await resp.text();
  if (resp.ok) return { ok: true, existed: false };
  try {
    const j = JSON.parse(text);
    const tag = j?.error?.path?.[".tag"] ?? j?.error?.[".tag"];
    if (tag === "conflict" || j?.error?.path?.conflict || text.includes("conflict")) {
      return { ok: true, existed: true };
    }
  } catch { /* fall through */ }
  return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
}

// Ensure a folder plus a list of relative subfolders exist. Returns the list
// of paths that were newly created (for logging).
export async function dbxEnsureTree(token: string, folderPath: string, subfolders: string[]): Promise<{ ok: boolean; created: string[]; error?: string }> {
  const created: string[] = [];
  const main = await dbxEnsureFolder(token, folderPath);
  if (!main.ok) return { ok: false, created, error: main.error };
  if (!main.existed) created.push(folderPath);
  for (const rel of subfolders) {
    const relPath = rel.split("/").map(sanitizeSegment).filter(Boolean).join("/");
    if (!relPath) continue;
    const sub = await dbxEnsureFolder(token, `${folderPath}/${relPath}`);
    if (!sub.ok) return { ok: false, created, error: `Unterordner "${relPath}": ${sub.error}` };
    if (!sub.existed) created.push(`${folderPath}/${relPath}`);
  }
  return { ok: true, created };
}
