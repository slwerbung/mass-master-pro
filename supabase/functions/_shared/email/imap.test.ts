// Absicherung der harten Regel „Kein Versand, kein Loeschen": der Quelltext des
// gesamten Mail-Assistenten darf kein IMAP-Loeschen und – bis auf lexwareSend.ts (Belege an Lexware) – keinen Versand enthalten.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}

const sources = [
  ...files(join(root, "_shared", "email")),
  ...readdirSync(root).filter((d) => d.startsWith("email-")).flatMap((d) => files(join(root, d))),
];

describe("Kein Versand, kein Loeschen", () => {
  it("findet den Mail-Assistenten-Quelltext", () => {
    expect(sources.length).toBeGreaterThan(3);
  });
  for (const [name, re] of [
    ["messageDelete", /messageDelete/],
    ["\\Deleted-Flag", /\\Deleted/],
    ["expunge", /expunge/i],
    ["Mail-Versand ueber Resend", /api\.resend\.com/],
    ["nodemailer-Transport", /nodemailer\/lib\/(smtp|mailer)/],
  ] as const) {
    it(`enthaelt kein ${name}`, () => {
      const hits = sources.filter((f) => re.test(readFileSync(f, "utf8")));
      expect(hits).toEqual([]);
    });
  }

  // EINZIGE Ausnahme (ausdruecklich freigegeben): Belege automatisch an die Lexware-Belegadresse.
  // Gesendet wird ausschliesslich in lexwareSend.ts; kein anderer Code darf einen Transport anlegen.
  it("sendet nur in lexwareSend.ts (sendMail/createTransport)", () => {
    const hits = sources.filter((f) => /sendMail\s*\(|createTransport\s*\(/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => f.split("/").pop())).toEqual(["lexwareSend.ts"]);
  });
  it("lexwareSend.ts prueft den Empfaenger vor jedem Versand und hat genau einen Sendeaufruf", () => {
    const f = sources.find((x) => x.endsWith("lexwareSend.ts"))!;
    const src = readFileSync(f, "utf8");
    expect(src.match(/sendMail\s*\(/g)).toHaveLength(1);
    expect(src.indexOf("assertAllowedRecipient(to, allowedAddress)")).toBeGreaterThan(-1);
    expect(src.indexOf("assertAllowedRecipient(to, allowedAddress)")).toBeLessThan(src.indexOf("createTransport"));
  });
});
