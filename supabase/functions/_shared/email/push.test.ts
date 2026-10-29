import { describe, expect, it } from "vitest";
import { planPushes, pushPayload, type PushMail } from "./push.ts";
import { TOPIC_DEFAULTS } from "./topics.ts";

const users = [
  { id: "s", name: "Silas Werner", emails: ["sw@slwerbung.de"] },
  { id: "j", name: "Jonas Lang", emails: ["jl@slwerbung.de"] },
];
const audience = new Map([["A", users], ["B", [users[1]]]]);
const mail = (o: Partial<PushMail> = {}): PushMail => ({
  id: "M1", account_id: "A", direction: "in", status: "wartet", category: "projekt_kommunikation", beleg_state: null, decided_at: null,
  from_name: "Kunde GmbH", from_addr: "k@x.de", to_addrs: ["post@firma.de"], subject: "Layout", summary: "Fragt nach dem Layout.",
  body_text: "Sehr geehrte Damen und Herren,\n…", ...o,
});
const ids = (p: Map<string, { decide: PushMail[]; incoming: PushMail[] }>) =>
  Object.fromEntries([...p].map(([u, v]) => [u, { decide: v.decide.map((m) => m.id), incoming: v.incoming.map((m) => m.id) }]));

describe("planPushes", () => {
  it("allgemein: alle mit Zugriff aufs Postfach (Standard: nur „Zu entscheiden“)", () => {
    expect(ids(planPushes([mail()], audience, new Map(), TOPIC_DEFAULTS))).toEqual({ s: { decide: ["M1"], incoming: [] }, j: { decide: ["M1"], incoming: [] } });
  });
  it("an einen Mitarbeiter gerichtet: nur er", () => {
    expect(ids(planPushes([mail({ body_text: "Hallo Jonas,\n…" })], audience, new Map(), TOPIC_DEFAULTS))).toEqual({ j: { decide: ["M1"], incoming: [] } });
  });
  it("nicht zu entscheiden (Werbung, entschieden, weitergeleiteter Beleg): nur bei „alle eingehenden“, Werbung nie", () => {
    const prefs = new Map([["s", { decide: true, incoming: true }]]);
    const r = planPushes([
      mail({ id: "W", category: "werbung_spam" }), mail({ id: "N", category: "newsletter" }),
      mail({ id: "D", decided_at: "2026-10-29T10:00:00Z" }), mail({ id: "B", category: "beleg", beleg_state: "weitergeleitet" }),
    ], audience, prefs, TOPIC_DEFAULTS);
    expect(ids(r)).toEqual({ s: { decide: [], incoming: ["N", "D", "B"] } });
  });
  it("„Zu entscheiden“ abgeschaltet, ausgehende Mails und fremde Postfaecher nie", () => {
    const prefs = new Map([["s", { decide: false, incoming: false }]]);
    const r = planPushes([mail(), mail({ id: "O", direction: "out" }), mail({ id: "X", account_id: "B" })], audience, prefs, TOPIC_DEFAULTS);
    expect(ids(r)).toEqual({ j: { decide: ["M1", "X"], incoming: [] } });
  });
});

describe("pushPayload", () => {
  it("eine Mail: Absender, Betreff, Zusammenfassung; mehrere: Liste", () => {
    expect(pushPayload("decide", [mail()])).toEqual({ title: "Zu entscheiden: Kunde GmbH", body: "Layout\nFragt nach dem Layout.", url: "/", tag: "mail-M1" });
    expect(pushPayload("incoming", [mail()]).url).toBe("/mails/M1");
    const many = pushPayload("decide", [1, 2, 3, 4, 5].map((i) => mail({ id: `M${i}`, subject: `S${i}` })));
    expect(many.title).toBe("5 Mails zu entscheiden");
    expect(many.body.split("\n")).toEqual(["Kunde GmbH: S1", "Kunde GmbH: S2", "Kunde GmbH: S3", "Kunde GmbH: S4", "… und 1 weitere"]);
  });
});
