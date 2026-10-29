// Web Push ohne Bibliothek: Nachricht verschluesseln (RFC 8291, aes128gcm) und mit VAPID signieren (RFC 8292).
// Nur WebCrypto – laeuft gleich in Deno (Edge Function) und unter vitest.
//
// Die VAPID-Schluessel erzeugt der Server selbst beim ersten Gebrauch und legt sie in `email_config` ab
// (nur service_role). Der private Schluessel verlaesst den Server nie; die Mail-App bekommt nur den oeffentlichen.

export interface PushSubscription { endpoint: string; p256dh: string; auth: string }
export interface VapidKeys { publicKey: string; privateJwk: JsonWebKey; subject: string }

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4 || 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

/** Neues VAPID-Schluesselpaar (P-256). */
export async function generateVapid(subject: string): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { publicKey: b64url(pub), privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey), subject };
}

/** VAPID-JWT (ES256) fuer den Push-Dienst des Endpunkts. */
export async function vapidAuth(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const key = await crypto.subtle.importKey("jwk", { ...keys.privateJwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto liefert r||s (64 Bytes) – genau das Format, das JWS fuer ES256 will.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

/** Nachricht fuer ein Abo verschluesseln (RFC 8291). `salt`/`serverKeys` nur fuer Tests vorgeben. */
export async function encryptPayload(
  sub: Pick<PushSubscription, "p256dh" | "auth">, payload: Uint8Array,
  opts: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("Ungültiges Push-Abo (Schlüssel).");
  const server = opts.serverKeys ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", server.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, server.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  // Ein einziger Datensatz: Inhalt + Trennzeichen 0x02 (letzter Datensatz), keine Auffuellung.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, concat(payload, new Uint8Array([2])) as BufferSource));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export const MAX_PAYLOAD_BYTES = 3000;

export type PushResult = { ok: true } | { ok: false; gone: boolean; status: number; error: string };

/** Eine Nachricht an ein Abo. `gone` = Abo existiert nicht mehr (404/410) -> loeschen. */
export async function sendPush(
  sub: PushSubscription, data: unknown, keys: VapidKeys,
  fetchImpl: typeof fetch = fetch, opts: { ttl?: number; urgency?: "normal" | "high" } = {},
): Promise<PushResult> {
  const body = enc.encode(JSON.stringify(data));
  if (body.length > MAX_PAYLOAD_BYTES) throw new Error("Push-Nachricht zu groß.");
  const cipher = await encryptPayload(sub, body);
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuth(sub.endpoint, keys),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttl ?? 24 * 3600),
        Urgency: opts.urgency ?? "normal",
      },
      body: cipher as BodyInit,
    });
    if (res.ok) return { ok: true };
    const text = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, gone: res.status === 404 || res.status === 410, status: res.status, error: text || res.statusText };
  } catch (e) {
    return { ok: false, gone: false, status: 0, error: String((e as Error)?.message || e).slice(0, 200) };
  }
}

/** Nur Endpunkte bekannter Push-Dienste annehmen (die Function ruft die Adresse spaeter selbst auf). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/,
];
export function isPushEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}
