// Absicherung des neuen Versandwegs (Projekte, Phase 3). Die Projekte-Functions senden NIE selbst: der einzige Sendeaufruf
// bleibt `sendComposed` in email-send (Aktion `send`). Nachfass-Mails laufen als gespeicherter Entwurf ueber
// `send_followup` (Klick, Mitarbeiter-Sitzung) bzw. `send_followup_auto` (Autopilot, nur mit Cron-Secret).

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : files(p);
    return /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && f !== "testdb.ts" ? [p] : [];
  });
}
const read = (p: string) => readFileSync(p, "utf8");
const projectSources = [
  ...files(join(root, "_shared", "projects")),
  // Nur die Projekte-Functions (project-invite u. a. sind bestehende, andere Functions).
  ...["project-api", "project-action", "project-evaluate", "hero-sync", "followup-runner", "hero-task-callback"].flatMap((d) => files(join(root, d))),
];

describe("Projekte senden nie selbst", () => {
  it("findet den Quelltext", () => expect(projectSources.length).toBeGreaterThan(8));
  for (const [name, re] of [
    ["sendComposed", /sendComposed\s*\(/], ["sendMail", /sendMail\s*\(/], ["createTransport", /createTransport\s*\(/],
    ["nodemailer", /nodemailer/], ["Resend", /api\.resend\.com/], ["HERO send_mail", /send_mail\s*\(/], ["IMAP-Loeschen", /messageDelete|expunge/i],
  ] as const) {
    it(`enthaelt kein ${name}`, () => {
      expect(projectSources.filter((f) => re.test(read(f))).map((f) => f.split("/").pop())).toEqual([]);
    });
  }
});

describe("email-send: Nachfass-Versand", () => {
  const src = read(join(root, "email-send", "index.ts"));
  it("sendComposed bleibt der einzige Sendeaufruf, in `send`", () => {
    expect(src.match(/sendComposed\s*\(/g)).toHaveLength(1);
    expect(src.lastIndexOf("async send(sb, body, user)", src.indexOf("sendComposed(smtp"))).toBeGreaterThan(-1);
  });
  it("sendFollowup wird nur in runFollowup aufgerufen", () => {
    expect(src.match(/sendFollowup\s*\(/g)).toHaveLength(1);
    const i = src.indexOf("sendFollowup(");
    expect(i).toBeGreaterThan(src.indexOf("async function runFollowup"));
    expect(i).toBeLessThan(src.indexOf("const handlers"));
  });
  it("send_followup_auto verlangt das Cron-Secret, bevor irgendetwas laeuft", () => {
    const i = src.indexOf('action === "send_followup_auto"');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf("requireMailUser(req, sb)", i));
    expect(block.indexOf("isCronCall(req, sb)")).toBeGreaterThan(-1);
    expect(block.indexOf("isCronCall(req, sb)")).toBeLessThan(block.indexOf("runFollowup("));
    expect(block.match(/runFollowup\(/g)).toHaveLength(1);
  });
  it("Empfaenger, Betreff und Text kommen nur aus dem Entwurf (nicht aus der Anfrage)", () => {
    const fn = src.slice(src.indexOf("async function runFollowup"), src.indexOf("const handlers"));
    expect(fn).not.toMatch(/body\.(to|subject|text)/);
    expect(fn).toContain("body.draftId");
  });
});

describe("followupSend.ts: Reihenfolge der Sicherheitsregeln", () => {
  const src = read(join(root, "_shared", "projects", "followupSend.ts"));
  const at = (s: string) => src.indexOf(s);
  it("Schattenmodus, Autopilot-Pruefungen und Atom-Anspruch kommen vor dem Senden", () => {
    const deliver = at("res = await deliver(");
    expect(deliver).toBeGreaterThan(-1);
    for (const s of ["isShadow(sb)", "effectiveAutopilot(", "inSendWindow(", "projects_auto_max_per_day", 'state: "sending"', 'eq("state", "draft")']) {
      expect(at(s), s).toBeGreaterThan(-1);
      expect(at(s), s).toBeLessThan(deliver);
    }
    expect(src.match(/await deliver\(/g)).toHaveLength(1);
  });
});

describe("followup-runner", () => {
  const src = read(join(root, "followup-runner", "index.ts"));
  it("ruft nur send_followup_auto auf, nach Cron-Secret, Schattenmodus- und Fenster-Pruefung", () => {
    const call = src.indexOf("send_followup_auto");
    expect(call).toBeGreaterThan(-1);
    for (const s of ["isCronCall(req, sb)", "isShadow(sb)", "inSendWindow("]) {
      expect(src.indexOf(s), s).toBeGreaterThan(-1);
      expect(src.indexOf(s), s).toBeLessThan(call);
    }
    expect(src).not.toMatch(/action:\s*"send"\b/);
  });
});
