// Ver- und Entschluesselung der Postfach-Passwoerter und KI-Schluessel.
// AES-256-GCM, Schluessel aus dem Secret EMAIL_ENCRYPTION_KEY (Edge Function Secrets).
// Format: "v1:<iv base64url>:<ciphertext+tag base64url>". Nie im Klartext in
// Tabellen, Logs oder Antworten an die Oberflaeche.

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64(input: string): Uint8Array {
  const n = input.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(n + "=".repeat((4 - (n.length % 4 || 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Der Schluessel darf beliebig lang sein, muss aber mindestens 32 Zeichen haben
 * (`openssl rand -hex 32`). Er wird per SHA-256 auf 256 Bit gebracht.
 * Kein Fallback: fehlt er, scheitert alles laut.
 */
async function importKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || secret.length < 32) {
    throw new Error(
      "EMAIL_ENCRYPTION_KEY fehlt oder ist zu kurz (mind. 32 Zeichen). Erzeugen mit: openssl rand -hex 32",
    );
  }
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, secret: string | undefined): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));
  return `v1:${toB64(iv)}:${toB64(ct)}`;
}

export async function decryptSecret(stored: string, secret: string | undefined): Promise<string> {
  const key = await importKey(secret);
  const parts = String(stored || "").split(":");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Unbekanntes Format des verschluesselten Werts");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(parts[1]) }, key, fromB64(parts[2]));
    return dec.decode(pt);
  } catch {
    // Falscher Schluessel oder veraenderter Wert — nie Details nach aussen geben.
    throw new Error("Entschluesselung fehlgeschlagen (falscher EMAIL_ENCRYPTION_KEY?)");
  }
}
