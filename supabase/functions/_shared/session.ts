export type SessionRole = "admin" | "employee" | "customer";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function sign(data: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return toBase64Url(new Uint8Array(sig));
}

/** Timing-safe string comparison to resist timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(payload: Record<string, unknown>, secret: string) {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(body, secret);
  return `${body}.${signature}`;
}

export async function verifySessionToken(token: string, secret: string) {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = await sign(body, secret);
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const payload = JSON.parse(json) as { exp?: number } & Record<string, unknown>;
    if (!payload.exp || payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Returns the HMAC signing secret for session tokens.
 * Requires SESSION_SIGNING_SECRET to be set in the environment.
 * Throws if missing – never falls back to a hardcoded value.
 *
 * To generate one: `openssl rand -hex 32`
 * Then set in Supabase:
 *   supabase secrets set SESSION_SIGNING_SECRET=<generated>
 */
export function getSessionSecret(): string {
  const secret = Deno.env.get("SESSION_SIGNING_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SIGNING_SECRET environment variable is not set or too short (min 32 chars). " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  return secret;
}
