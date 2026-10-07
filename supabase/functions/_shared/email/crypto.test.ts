import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto.ts";

const KEY = "0123456789abcdef0123456789abcdef";

describe("crypto", () => {
  it("verschluesselt hin und zurueck, auch mit Umlauten", async () => {
    const enc = await encryptSecret("Pässwört 🔑", KEY);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("Pässwört");
    expect(await decryptSecret(enc, KEY)).toBe("Pässwört 🔑");
  });
  it("erzeugt jedes Mal einen anderen Chiffretext (zufaelliger IV)", async () => {
    expect(await encryptSecret("x", KEY)).not.toBe(await encryptSecret("x", KEY));
  });
  it("lehnt falschen Schluessel und manipulierte Daten ab", async () => {
    const enc = await encryptSecret("geheim", KEY);
    await expect(decryptSecret(enc, "f".repeat(32))).rejects.toThrow(/Entschl/);
    const parts = enc.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -2)}AA`;
    await expect(decryptSecret(tampered, KEY)).rejects.toThrow();
  });
  it("hat keinen Fallback: fehlender oder kurzer Schluessel scheitert laut", async () => {
    await expect(encryptSecret("x", undefined)).rejects.toThrow(/EMAIL_ENCRYPTION_KEY/);
    await expect(encryptSecret("x", "kurz")).rejects.toThrow(/EMAIL_ENCRYPTION_KEY/);
  });
  it("lehnt fremde Formate ab", async () => {
    await expect(decryptSecret("klartext", KEY)).rejects.toThrow(/Format/);
  });
});
