import { compare } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(password));
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

export async function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) return false;
  if (storedHash.startsWith("sha256:")) {
    const computed = await hashPassword(password);
    return computed === storedHash;
  }
  try {
    return await compare(password, storedHash);
  } catch {
    return false;
  }
}
