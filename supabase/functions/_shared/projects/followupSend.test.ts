import { describe, expect, it } from "vitest";
import { selectAutoDrafts, sendFollowup, type Deliver, type DeliverArgs } from "./followupSend.ts";
import { fakeDb } from "./testdb.ts";

const NOW = new Date("2026-11-12T10:00:00Z"); // Do 11:00 Berlin: im Versandfenster

function setup(over: { shadow?: boolean; ruleAutopilot?: string; override?: string; bundled?: boolean; newerIncoming?: boolean; failDeliver?: boolean; warn?: string[]; hours?: string } = {}) {
  const calls: DeliverArgs[] = [];
  const deliver: Deliver = async (a) => {
    calls.push(a);
    if (over.failDeliver) throw new Error("SMTP kaputt");
    return { messageId: "<m1@x>", warnings: over.warn ?? [] };
  };
  const t: any = {
    app_config: [
      { key: "projects_write_enabled", value: over.shadow ? "false" : "true" },
      { key: "projects_followup_hours", value: over.hours ?? '{"days":[1,2,3,4,5],"from":8,"to":17}' },
      { key: "projects_auto_max_per_day", value: "2" },
    ],
    project_followup_mails: [{ id: "d1", hero_id: 7, rule_key: "nachfassen", stage: 1, state: "draft", to_email: "K@Muster.de", subject: "Ihr Angebot: Schild", body: "Hallo,\nkurze Nachfrage.", created_at: "2026-11-10T08:00:00Z", attempts: 0 }],
    hero_projects: [{ hero_id: 7, project_nr: "WER-7", name: "Schild", assignee_emails: [] }],
    project_rules: [{ key: "nachfassen", channel: "mail", active: true, autopilot: over.ruleAutopilot ?? "suggest", followup_days: 7, followup_reason: "Nachfassen Stufe 2" }],
    project_autopilot: over.override ? [{ hero_id: 7, rule_key: "nachfassen", mode: over.override }] : [],
    project_cards: [{ id: "c1", hero_id: 7, rule_key: "nachfassen", state: "open", bundled: !!over.bundled }],
    email_messages: [
      { id: "in1", account_id: "a1", direction: "in", hero_project_match_id: 7, sent_at: "2026-11-04T08:00:00Z", trashed_at: null },
      ...(over.newerIncoming ? [{ id: "in2", account_id: "a1", direction: "in", hero_project_match_id: 7, sent_at: "2026-11-11T08:00:00Z", trashed_at: null }] : []),
    ],
    email_accounts: [{ id: "a1", enabled: true, smtp_host: "smtp.x" }],
    followups: [], project_actions_log: [],
  };
  const sb = fakeDb(t);
  const actor = { name: "Silas", id: "u1" };
  return { t, sb, deliver, calls, actor, send: (o: Partial<Parameters<typeof sendFollowup>[2]> = {}) => sendFollowup(sb, deliver, { draftId: "d1", actor, auto: false, now: NOW, ...o }) };
}

describe("Senden per Klick", () => {
  it("Schattenmodus: nichts gesendet, nur protokolliert", async () => {
    const s = setup({ shadow: true });
    const r = await s.send();
    expect(r.shadow).toBe(true);
    expect(s.calls).toEqual([]);
    expect(s.t.project_followup_mails[0].state).toBe("draft");
    expect(s.t.project_actions_log[0]).toMatchObject({ action: "send_followup", shadow: true, hero_id: 7 });
  });

  it("sendet genau den gespeicherten Entwurf an das Postfach der letzten Kundenmail, im Thread", async () => {
    const s = setup();
    const r = await s.send();
    expect(r).toMatchObject({ ok: true, shadow: false });
    expect(s.calls).toEqual([{ accountId: "a1", to: "k@muster.de", subject: "Ihr Angebot: Schild", text: "Hallo,\nkurze Nachfrage.", replyTo: "in1", projectId: 7 }]);
    expect(s.t.project_followup_mails[0]).toMatchObject({ state: "sent", message_id: "<m1@x>", auto: false, sent_at: NOW.toISOString() });
  });

  it("setzt Wiedervorlage nach der Regel (7 Tage) und stellt die Karte zurück", async () => {
    const s = setup();
    await s.send();
    expect(s.t.followups).toHaveLength(1);
    expect(s.t.followups[0]).toMatchObject({ target_type: "project", hero_id: 7, reason: "Nachfassen Stufe 2", due_at: "2026-11-19T06:00:00.000Z" });
    expect(s.t.project_cards[0].state).toBe("snoozed");
    expect(s.t.project_actions_log[0]).toMatchObject({ action: "send_followup", shadow: false, error: null });
  });

  it("zweiter Versand desselben Entwurfs wird abgelehnt", async () => {
    const s = setup();
    await s.send();
    await expect(s.send()).rejects.toThrow("nicht mehr offen");
    expect(s.calls).toHaveLength(1);
  });

  it("zwei gleichzeitige Klicks senden nur einmal", async () => {
    const s = setup();
    const results = await Promise.allSettled([s.send(), s.send()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(s.calls).toHaveLength(1);
  });

  it("Fehler beim Senden: Entwurf bleibt offen mit Fehlermeldung, nichts sonst ändert sich", async () => {
    const s = setup({ failDeliver: true });
    await expect(s.send()).rejects.toThrow("SMTP kaputt");
    expect(s.t.project_followup_mails[0]).toMatchObject({ state: "draft", error: "SMTP kaputt" });
    expect(s.t.followups).toHaveLength(0);
    expect(s.t.project_cards[0].state).toBe("open");
    expect(s.t.project_actions_log[0]).toMatchObject({ error: "SMTP kaputt", shadow: false });
  });

  it("hat der Kunde inzwischen geantwortet, wird nicht gesendet und der Entwurf gestoppt", async () => {
    const s = setup({ newerIncoming: true });
    await expect(s.send()).rejects.toThrow("inzwischen geantwortet");
    expect(s.calls).toEqual([]);
    expect(s.t.project_followup_mails[0]).toMatchObject({ state: "stopped", stopped_reason: "Kunde hat geantwortet" });
  });

  it("ohne Zugriff auf das Projekt: nichts passiert", async () => {
    const s = setup();
    await expect(s.send({ actor: { name: "X", id: "u2", canSee: () => false } })).rejects.toThrow("Projekt nicht gefunden");
    expect(s.calls).toEqual([]);
  });

  it("kaputte Empfängeradresse oder leerer Text: nicht senden", async () => {
    const a = setup(); a.t.project_followup_mails[0].to_email = "kein-mail";
    await expect(a.send()).rejects.toThrow("Empfängeradresse");
    const b = setup(); b.t.project_followup_mails[0].body = "  ";
    await expect(b.send()).rejects.toThrow("leer");
  });

  it("Rückfall-Logbuch nur, wenn die Gesendet-Kopie fehlt (Warnung)", async () => {
    const entries: string[] = [];
    const ok = setup();
    await ok.send({ logbook: async (_h, t) => { entries.push(t); } });
    expect(entries).toEqual([]);
    const warn = setup({ warn: ["Kein Gesendet-Ordner bekannt – Kopie nicht abgelegt."] });
    const r = await warn.send({ logbook: async (_h, t) => { entries.push(t); } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("k@muster.de");
    expect(r.warnings).toHaveLength(1);
  });

  it("ohne Kundenmail im Projekt: Postfach aus der Einstellung bzw. das erste mit SMTP, ohne Thread", async () => {
    const s = setup();
    s.t.email_messages.length = 0;
    await s.send();
    expect(s.calls[0]).toMatchObject({ accountId: "a1", replyTo: null });
  });
});

describe("Automatisch (Autopilot)", () => {
  it("nur wenn der Autopilot auf „auto“ steht – Projekt schlägt Regel", async () => {
    const a = setup({ ruleAutopilot: "suggest" });
    await expect(a.send({ auto: true })).rejects.toThrow("nicht auf „Automatisch“");
    const b = setup({ ruleAutopilot: "suggest", override: "auto" });
    expect((await b.send({ auto: true })).ok).toBe(true);
    expect(b.t.project_followup_mails[0]).toMatchObject({ state: "sent", auto: true });
    expect(b.t.project_actions_log[0].action).toBe("auto_followup");
    const c = setup({ ruleAutopilot: "auto", override: "off" });
    await expect(c.send({ auto: true })).rejects.toThrow("nicht auf „Automatisch“");
  });

  it("nur im Versandfenster", async () => {
    const s = setup({ ruleAutopilot: "auto" });
    await expect(s.send({ auto: true, now: new Date("2026-11-14T10:00:00Z") })).rejects.toThrow("Versandfenster"); // Samstag
    await expect(s.send({ auto: true, now: new Date("2026-11-12T17:00:00Z") })).rejects.toThrow("Versandfenster"); // 18:00
    expect(s.calls).toEqual([]);
  });

  it("nicht für Aufräum-Karten und nicht ohne offene Karte", async () => {
    const a = setup({ ruleAutopilot: "auto", bundled: true });
    await expect(a.send({ auto: true })).rejects.toThrow("Keine offene Karte");
    const b = setup({ ruleAutopilot: "auto" });
    b.t.project_cards[0].state = "snoozed";
    await expect(b.send({ auto: true })).rejects.toThrow("Keine offene Karte");
  });

  it("Tageslimit: danach nichts mehr (nur echte Sendungen zählen, Schatten nicht)", async () => {
    const s = setup({ ruleAutopilot: "auto" });
    const today = "2026-11-12T08:00:00Z";
    s.t.project_actions_log.push({ action: "auto_followup", shadow: true, created_at: today }, { action: "auto_followup", shadow: false, created_at: "2026-11-11T08:00:00Z" });
    expect((await s.send({ auto: true })).ok).toBe(true); // bisher 0 echte heute
    const t = setup({ ruleAutopilot: "auto" });
    t.t.project_actions_log.push({ action: "auto_followup", shadow: false, created_at: today }, { action: "auto_followup", shadow: false, created_at: today });
    await expect(t.send({ auto: true })).rejects.toThrow("Tageslimit");
  });

  it("Fehler beim automatischen Senden: nicht erneut versuchen, ein Mensch entscheidet", async () => {
    const s = setup({ ruleAutopilot: "auto", failDeliver: true });
    await expect(s.send({ auto: true })).rejects.toThrow("SMTP kaputt");
    expect(s.t.project_followup_mails[0]).toMatchObject({ state: "stopped", stopped_reason: "Automatischer Versand fehlgeschlagen" });
    expect(await selectAutoDrafts(s.sb, 10)).toEqual([]);
  });

  it("im Schattenmodus wird auch automatisch nichts gesendet", async () => {
    const s = setup({ ruleAutopilot: "auto", shadow: true });
    const r = await s.send({ auto: true });
    expect(r.shadow).toBe(true);
    expect(s.calls).toEqual([]);
    expect(s.t.project_actions_log[0]).toMatchObject({ action: "auto_followup", shadow: true });
  });
});

describe("Auswahl für den Runner", () => {
  it("nur Entwürfe mit Autopilot auto, offener Karte und ohne Fehlversuch; ältester zuerst; begrenzt", async () => {
    const s = setup({ ruleAutopilot: "auto" });
    s.t.project_followup_mails.push(
      { id: "d2", hero_id: 8, rule_key: "nachfassen", stage: 1, state: "draft", created_at: "2026-11-09T08:00:00Z", attempts: 0 },
      { id: "d3", hero_id: 9, rule_key: "nachfassen", stage: 1, state: "draft", created_at: "2026-11-08T08:00:00Z", attempts: 1 },
      { id: "d4", hero_id: 10, rule_key: "nachfassen", stage: 1, state: "draft", created_at: "2026-11-07T08:00:00Z", attempts: 0 },
    );
    s.t.project_cards.push({ hero_id: 8, rule_key: "nachfassen", state: "open", bundled: false }, { hero_id: 9, rule_key: "nachfassen", state: "open", bundled: false }, { hero_id: 10, rule_key: "nachfassen", state: "open", bundled: true });
    s.t.project_autopilot.push({ hero_id: 8, rule_key: "nachfassen", mode: "off" });
    expect(await selectAutoDrafts(s.sb, 10)).toEqual(["d1"]); // d2 aus, d3 Fehlversuch, d4 Aufräum-Karte
    s.t.project_autopilot.length = 0;
    expect(await selectAutoDrafts(s.sb, 10)).toEqual(["d2", "d1"]);
    expect(await selectAutoDrafts(s.sb, 1)).toEqual(["d2"]);
    expect(await selectAutoDrafts(s.sb, 0)).toEqual([]);
  });
});
