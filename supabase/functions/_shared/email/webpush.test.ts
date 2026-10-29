import { describe, expect, it } from "vitest";
import { b64url, encryptPayload, fromB64url, generateVapid, isPushEndpoint, sendPush, vapidAuth } from "./webpush.ts";

const enc = new TextEncoder();
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

/** Empfaengerseite nach RFC 8291 – unabhaengig nachgebaut, wie es der Browser tut. */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hmac(await hmac(auth, ecdh), cat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function subscriber() {
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { ua, auth, sub: { endpoint: "https://fcm.googleapis.com/fcm/send/xyz", p256dh: b64url(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey))), auth: b64url(auth) } };
}

describe("webpush", () => {
  it("verschluesselt so, dass der Empfaenger es lesen kann (aes128gcm, rs 4096)", async () => {
    const { ua, auth, sub } = await subscriber();
    const body = await encryptPayload(sub, enc.encode("Grüße 🙂"));
    expect([...body.slice(16, 20)]).toEqual([0, 0, 16, 0]);
    expect(body[20]).toBe(65);
    expect(await decrypt(body, ua, auth)).toBe("Grüße 🙂");
  });

  it("VAPID-JWT: ES256, Empfaenger-Herkunft, gueltige Signatur", async () => {
    const keys = await generateVapid("mailto:info@slwerbung.de");
    const h = await vapidAuth("https://fcm.googleapis.com/fcm/send/xyz", keys, Date.UTC(2026, 9, 29));
    const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [hd, cl, sig] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64url(cl)))).toEqual({ aud: "https://fcm.googleapis.com", exp: Date.UTC(2026, 9, 29) / 1000 + 43200, sub: "mailto:info@slwerbung.de" });
    const pub = await crypto.subtle.importKey("raw", fromB64url(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromB64url(sig), enc.encode(`${hd}.${cl}`))).toBe(true);
  });

  it("sendPush: Kopfzeilen; 410 = Abo weg", async () => {
    const { ua, auth, sub } = await subscriber();
    const keys = await generateVapid("mailto:x@y.de");
    let seen: RequestInit | null = null;
    const ok = await sendPush(sub, { title: "T" }, keys, (async (_u: string, init: RequestInit) => { seen = init; return new Response("", { status: 201 }); }) as any);
    expect(ok).toEqual({ ok: true });
    const h = seen!.headers as Record<string, string>;
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h.TTL).toBe("86400");
    expect(JSON.parse(await decrypt(seen!.body as Uint8Array, ua, auth))).toEqual({ title: "T" });
    const gone = await sendPush(sub, {}, keys, (async () => new Response("weg", { status: 410 })) as any);
    expect(gone).toMatchObject({ ok: false, gone: true, status: 410 });
  });

  it("nimmt nur bekannte Push-Dienste an", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QAB")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("https://evil.example.com/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://tocukaqhclkskpvvxmrr.supabase.co/x")).toBe(false);
  });
});
