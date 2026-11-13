import { describe, expect, it } from "vitest";
import { maintainFollowups } from "./followupChain.ts";
import { fakeDb } from "./testdb.ts";

const NOW = new Date("2026-11-12T10:00:00Z");
const base = () => ({
  project_rules: [
    { key: "nachfassen", label: "Nachfassen", category: "auftrag", channel: "mail", active: true, autopilot: "suggest" },
    { key: "freigabe_offen", label: "Freigabe", category: "kunde", channel: "mail", active: true, autopilot: "off" },
    { key: "kunde_antwort", label: "Kunde hat geantwortet", category: "kunde", channel: "hero", active: true, autopilot: "off" },
  ],
  project_followup_templates: [{ rule_key: "nachfassen", stage: 1, subject: "Ihr Angebot: {projekt}", body: "Hallo,\nzu „{projekt}“ vom {angebot_datum} ({angebot_nr}).\nSL WERBUNG" }],
  project_autopilot: [] as any[],
  email_accounts: [{ address: "info@slwerbung.de", username: "info@slwerbung.de" }],
  hero_projects: [{ hero_id: 7, step_name: "Warten auf Auftrag", name: "Schild", kunde: "Muster GmbH", kunde_email: "k@muster.de",
    documents: [{ nr: "A-1", type: "offer", status: "Versendet", created: "2026-11-01T09:00:00Z" }] }],
  project_cards: [{ id: "c1", hero_id: 7, rule_key: "nachfassen", state: "open", bundled: false }] as any[],
  project_followup_mails: [] as any[],
  email_messages: [] as any[],
});

describe("Entwürfe", () => {
  it("legt einen Entwurf nach Vorlage an, nur einmal", async () => {
    const t: any = base();
    const db = fakeDb(t);
    expect(await maintainFollowups(db, NOW)).toMatchObject({ drafts: 1 });
    expect(t.project_followup_mails).toHaveLength(1);
    expect(t.project_followup_mails[0]).toMatchObject({ hero_id: 7, rule_key: "nachfassen", stage: 1, state: "draft", to_email: "k@muster.de", subject: "Ihr Angebot: Schild" });
    expect(t.project_followup_mails[0].body).toContain("vom 01.11.2026 (A-1)");
    expect((await maintainFollowups(db, NOW)).drafts).toBe(0);
    expect(t.project_followup_mails).toHaveLength(1);
  });

  it("Empfänger ist die Absenderadresse der letzten Kundenmail zum Projekt", async () => {
    const t: any = base();
    t.email_messages.push({ hero_project_match_id: 7, direction: "in", from_addr: "Chef@Muster.de", sent_at: "2026-11-03T08:00:00Z", trashed_at: null });
    await maintainFollowups(fakeDb(t), NOW);
    expect(t.project_followup_mails[0].to_email).toBe("chef@muster.de");
  });

  it("ohne Empfängeradresse kein Entwurf", async () => {
    const t: any = base();
    t.hero_projects[0].kunde_email = "";
    const s = await maintainFollowups(fakeDb(t), NOW);
    expect(s).toMatchObject({ drafts: 0, noRecipient: 1 });
  });

  it("Autopilot aus = kein Entwurf; je Projekt überschreibt die Regel", async () => {
    const t: any = base();
    t.project_rules[0].autopilot = "off";
    await maintainFollowups(fakeDb(t), NOW);
    expect(t.project_followup_mails).toHaveLength(0);
    t.project_autopilot.push({ hero_id: 7, rule_key: "nachfassen", mode: "auto" });
    await maintainFollowups(fakeDb(t), NOW);
    expect(t.project_followup_mails).toHaveLength(1);

    const u: any = base();
    u.project_autopilot.push({ hero_id: 7, rule_key: "nachfassen", mode: "off" });
    await maintainFollowups(fakeDb(u), NOW);
    expect(u.project_followup_mails).toHaveLength(0);
  });

  it("Aufräum-Karten (bundled) und Regeln ohne Mailweg bekommen keinen Entwurf", async () => {
    const t: any = base();
    t.project_cards[0].bundled = true;
    t.project_cards.push({ id: "c2", hero_id: 7, rule_key: "kunde_antwort", state: "open", bundled: false });
    await maintainFollowups(fakeDb(t), NOW);
    expect(t.project_followup_mails).toHaveLength(0);
  });

  it("überholter Entwurf wird beendet, ein gerade sendender nicht", async () => {
    const t: any = base();
    const db = fakeDb(t);
    await maintainFollowups(db, NOW);
    t.project_cards[0].state = "done"; // Signal erledigt
    t.project_followup_mails.push({ id: "m9", hero_id: 8, rule_key: "nachfassen", stage: 1, state: "sending" });
    const s = await maintainFollowups(db, NOW);
    expect(s.stopped).toBe(1);
    expect(t.project_followup_mails[0]).toMatchObject({ state: "stopped", stopped_reason: "Signal erledigt" });
    expect(t.project_followup_mails.find((m: any) => m.id === "m9").state).toBe("sending");
  });
});

describe("Kunde hat geantwortet", () => {
  const withSent = () => {
    const t: any = base();
    t.project_followup_mails.push({ id: "s1", hero_id: 7, rule_key: "nachfassen", stage: 1, state: "sent", sent_at: "2026-11-05T09:00:00Z", reply_seen_at: null });
    t.project_followup_mails.push({ id: "d1", hero_id: 7, rule_key: "nachfassen", stage: 1, state: "draft" });
    return t;
  };

  it("stoppt die Kette und macht die Karte zu „Kunde hat geantwortet“ (nur einmal)", async () => {
    const t = withSent();
    t.email_messages.push({ hero_project_match_id: 7, direction: "in", from_addr: "k@muster.de", sent_at: "2026-11-08T08:00:00Z", trashed_at: null });
    const db = fakeDb(t);
    expect((await maintainFollowups(db, NOW)).replies).toBe(1);
    expect(t.project_followup_mails.find((m: any) => m.id === "d1")).toMatchObject({ state: "stopped", stopped_reason: "Kunde hat geantwortet" });
    expect(t.project_followup_mails.find((m: any) => m.id === "s1").reply_seen_at).not.toBeNull();
    expect(t.project_cards).toHaveLength(1);
    expect(t.project_cards[0]).toMatchObject({ rule_key: "kunde_antwort", category: "kunde", state: "open" });
    expect(t.project_cards[0].reasons).toMatchObject({ manual: true });
    expect(t.project_cards[0].reasons.text).toContain("08.11.2026");
    expect((await maintainFollowups(db, NOW)).replies).toBe(0); // nicht erneut
  });

  it("eine Mail VOR dem Versand ist keine Antwort", async () => {
    const t = withSent();
    t.email_messages.push({ hero_project_match_id: 7, direction: "in", from_addr: "k@muster.de", sent_at: "2026-11-04T08:00:00Z", trashed_at: null });
    expect((await maintainFollowups(fakeDb(t), NOW)).replies).toBe(0);
    expect(t.project_followup_mails.find((m: any) => m.id === "d1").state).toBe("draft");
  });

  it("Papierkorb-Mails und ausgehende Mails zählen nicht", async () => {
    const t = withSent();
    t.email_messages.push({ hero_project_match_id: 7, direction: "in", from_addr: "k@muster.de", sent_at: "2026-11-08T08:00:00Z", trashed_at: "2026-11-09T00:00:00Z" });
    t.email_messages.push({ hero_project_match_id: 7, direction: "out", from_addr: "info@slwerbung.de", sent_at: "2026-11-08T09:00:00Z", trashed_at: null });
    expect((await maintainFollowups(fakeDb(t), NOW)).replies).toBe(0);
  });
});
