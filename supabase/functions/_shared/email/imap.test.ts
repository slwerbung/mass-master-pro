// Absicherung der harten Regel „Kein Versand, kein Loeschen" („Loeschen" in der Mail-App = Verschieben in den Papierkorb): der Quelltext des
// gesamten Mail-Assistenten darf kein IMAP-Loeschen und – bis auf lexwareSend.ts (Belege an Lexware) und den
// Dokumentversand ueber HERO nach Klick (hero.ts sendDocumentMail, nur aus action.ts sendDocument) – keinen Versand enthalten.

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

  // ZWEITE Ausnahme (ausdruecklich freigegeben, Okt. 2026): geprueftes Angebot / geprueft AB per Klick ueber HERO
  // an den Kunden. Die HERO-Mutation steht nur in hero.ts; aufgerufen wird sie nur in action.ts `sendDocument`.
  it("HERO-send_mail nur in hero.ts, Aufruf nur aus action.ts (sendDocument)", () => {
    const mut = sources.filter((f) => /send_mail\s*\(/.test(readFileSync(f, "utf8")));
    expect(mut.map((f) => f.split("/").pop())).toEqual(["hero.ts"]);
    const callers = sources.filter((f) => /\.sendDocumentMail\s*\(/.test(readFileSync(f, "utf8")));
    // email-action/index.ts reicht die Funktion nur durch (Verdrahtung), aufgerufen wird sie in action.ts.
    expect(callers.map((f) => f.split("/").slice(-2).join("/")).sort()).toEqual(["email-action/index.ts", "email/action.ts"]);
    const wiring = readFileSync(callers.find((f) => f.endsWith("email-action/index.ts"))!, "utf8");
    expect(wiring.match(/\.sendDocumentMail\s*\(/g)).toHaveLength(1);
    callers.splice(callers.findIndex((f) => f.endsWith("email-action/index.ts")), 1);
    const src = readFileSync(callers[0], "utf8");
    expect(src.match(/\.sendDocumentMail\s*\(/g)).toHaveLength(1);
    const i = src.indexOf(".sendDocumentMail(");
    expect(src.lastIndexOf("async function sendDocument(", i)).toBeGreaterThan(-1);
    // Vor dem Versand: PDF/Status geprueft und Vorlage aus HERO
    expect(src.lastIndexOf("NotReadyError(`${doc.nr", i)).toBeGreaterThan(src.lastIndexOf("async function sendDocument(", i));
  });
});
