import { describe, expect, it } from "vitest";
import { evaluateAll } from "./evaluate.ts";

import { fakeDb } from "./testdb.ts";

const NOW = new Date("2026-11-09T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const rule = (key: string, category: string, threshold: number | null = null) => ({ key, label: key, category, threshold_days: threshold, active: true });
const base = () => ({
  project_step_settings: [
    { step_id: 1, name: "Druck", key: "druck", target_days: 7, excluded: false, closeness: 60 },
    { step_id: 2, name: "Bezahlung", key: "bezahlung", target_days: 7, excluded: true, closeness: 95 },
  ],
  project_rules: [rule("haengt", "termine"), rule("waise", "pflege"), rule("reklamation", "kunde")],
  app_config: [{ key: "projects_bundle_after_days", value: "60" }],
  project_cards: [] as any[], followups: [] as any[], project_rule_mutes: [] as any[],
});
const proj = (id: number, days: number, step = 1) => ({
  hero_id: id, project_nr: `WER-${id}`, name: "P", step_id: step, step_name: step === 1 ? "Druck" : "Bezahlung", step_key: step === 1 ? "druck" : "bezahlung",
  step_since: ago(days), hero_created: ago(300), documents: [],
});

describe("evaluateAll", () => {
  it("legt Karten an, sammelt alte in der Aufraeum-Karte, ignoriert Buchhaltung und Sollzeit", async () => {
    const db = fakeDb({ ...base(), hero_projects: [proj(1, 10), proj(2, 90), proj(3, 3), proj(4, 99, 2)] });
    const s = await evaluateAll(db, NOW);
    expect(s).toMatchObject({ created: 2, cards: 2, bundled: 1, orphans: 0 });
  });

  it("zweiter Lauf legt nichts doppelt an", async () => {
    const db = fakeDb({ ...base(), hero_projects: [proj(1, 10)] });
    await evaluateAll(db, NOW);
    expect(await evaluateAll(db, NOW)).toMatchObject({ created: 0, updated: 0, cards: 1 });
  });

  it("schliesst die Karte, wenn das Signal weg ist oder das Projekt nicht mehr offen ist", async () => {
    const t: any = { ...base(), hero_projects: [proj(1, 10), proj(2, 10)] };
    const db = fakeDb(t);
    await evaluateAll(db, NOW);
    t.hero_projects[0].step_since = ago(1); // Projekt 1 wieder in Sollzeit
    t.hero_projects.pop();                  // Projekt 2 abgeschlossen
    const s = await evaluateAll(db, NOW);
    expect(s.closed).toBe(2);
    expect(t.project_cards.every((c: any) => c.state === "done")).toBe(true);
    expect(t.project_cards.map((c: any) => c.close_reason).sort()).toEqual(["Projekt nicht mehr offen", "Signal erledigt"]);
  });

  it("Wiedervorlage in der Zukunft verhindert eine neue Karte, eine faellige weckt sie", async () => {
    const t: any = { ...base(), hero_projects: [proj(1, 10)] };
    t.followups.push({ id: "f1", target_type: "project", hero_id: 1, due_at: ago(-3), reason: "Nachhaken", done_at: null });
    const db = fakeDb(t);
    let s = await evaluateAll(db, NOW);
    expect(s).toMatchObject({ created: 0, cards: 0, orphans: 0 });

    t.followups[0].due_at = ago(1);
    s = await evaluateAll(db, NOW);
    expect(s.woken).toBe(1);
    expect(t.followups[0].done_at).not.toBeNull();
    expect(t.project_cards).toHaveLength(1);
    expect(t.project_cards[0]).toMatchObject({ state: "open" });
    expect(t.project_cards[0].reasons.text).toContain("Nachhaken");
  });

  it("weckt eine zurueckgestellte Karte, auch ohne Signal, und schliesst sie nicht gleich wieder", async () => {
    const t: any = { ...base(), hero_projects: [proj(1, 2)] };
    t.project_cards.push({ id: "c1", hero_id: 1, rule_key: "haengt", state: "snoozed", reasons: {}, priority: 1, bundled: false, category: "termine" });
    t.followups.push({ id: "f1", target_type: "project", hero_id: 1, due_at: ago(0.5), reason: "Prüfen", done_at: null });
    const db = fakeDb(t);
    await evaluateAll(db, NOW);
    expect(t.project_cards[0].state).toBe("open");
    expect(t.project_cards[0].reasons.manual).toBe(true);
    await evaluateAll(db, NOW);
    expect(t.project_cards[0].state).toBe("open");
  });

  it("Stummschaltung unterdrueckt die Karte, ohne dass das Projekt als Waise gilt", async () => {
    const t: any = { ...base(), hero_projects: [proj(1, 10)] };
    t.project_rule_mutes.push({ hero_id: 1, rule_key: "haengt", until: ago(-5) });
    const s = await evaluateAll(fakeDb(t), NOW);
    expect(s).toMatchObject({ created: 0, orphans: 0 });
  });
});

describe("Phase 5: Wiedervorlage wecken", () => {
  const fu = (created: number, due = -5) => ({ id: "f1", target_type: "project", hero_id: 1, due_at: ago(due), reason: "Nachhaken", done_at: null, created_at: ago(created) });
  const mail = (sentDaysAgo: number, extra: any = {}) => ({ id: "m1", thread_id: "t1", direction: "in", hero_project_match_id: 1, category: "projekt_kommunikation", subject: "Frage", sent_at: ago(sentDaysAgo), trashed_at: null, ...extra });

  it("neue Kundenmail nach dem Anlegen holt die Karte vor die Zeit", async () => {
    const t: any = { ...base(), hero_projects: [proj(1, 1)], followups: [fu(3)], email_messages: [mail(1)] };
    const s = await evaluateAll(fakeDb(t), NOW);
    expect(s.woken).toBe(1);
    expect(t.followups[0].done_at).not.toBeNull();
    expect(t.project_cards).toHaveLength(1);
    expect(t.project_cards[0].reasons.text).toBe("Wiedervorlage vorgezogen: Kunde hat geschrieben.");
  });
  it("eine Mail VOR der Wiedervorlage, Werbung oder ausgehende Post wecken nicht", async () => {
    for (const m of [mail(5), mail(1, { category: "werbung_spam" }), mail(1, { direction: "out" }), mail(1, { trashed_at: ago(0) })]) {
      const t: any = { ...base(), hero_projects: [proj(1, 5)], followups: [fu(3)], email_messages: [m] }; // Status seit 5 Tagen: vor dem Anlegen
      const s = await evaluateAll(fakeDb(t), NOW);
      expect(s.woken).toBe(0);
      expect(t.followups[0].done_at).toBeNull();
    }
  });
  it("Statuswechsel in HERO nach dem Anlegen weckt – aber nicht innerhalb der Zeitzonen-Toleranz", async () => {
    const wake = async (stepSinceDaysAgo: number, createdDaysAgo: number) => {
      const t: any = { ...base(), hero_projects: [proj(1, stepSinceDaysAgo)], followups: [fu(createdDaysAgo)] };
      return { s: await evaluateAll(fakeDb(t), NOW), t };
    };
    expect((await wake(1, 3)).s.woken).toBe(1);                       // Wechsel 2 Tage nach dem Anlegen
    expect((await wake(3, 1)).s.woken).toBe(0);                       // Wechsel VOR dem Anlegen
    // Wechsel eine Stunde nach dem Anlegen (HERO-Zeit bis 2 h „zu spaet“) wuerde sonst sofort wecken
    const t: any = { ...base(), hero_projects: [{ ...proj(1, 0), step_since: new Date(NOW.getTime() - 3_600_000 + 2 * 3_600_000).toISOString() }], followups: [{ ...fu(0), created_at: new Date(NOW.getTime() - 3_600_000).toISOString() }] };
    expect((await evaluateAll(fakeDb(t), NOW)).woken).toBe(0);
  });
  it("ohne created_at (alte Zeilen) bleibt alles wie vorher", async () => {
    const t: any = { ...base(), hero_projects: [proj(1, 1)], followups: [{ ...fu(3), created_at: undefined }], email_messages: [mail(1)] };
    expect((await evaluateAll(fakeDb(t), NOW)).woken).toBe(0);
  });
});

describe("Phase 5: Regel Kundenmail unbeantwortet", () => {
  const withRule = () => ({ ...base(), project_rules: [...base().project_rules, rule("kunde_mail_offen", "kunde", 2)] });
  const msg = (daysAgo: number, extra: any = {}) => ({ id: "m1", thread_id: "t1", direction: "in", hero_project_match_id: 1, category: "anfrage_neu", subject: "Wann geht es los?", sent_at: ago(daysAgo), trashed_at: null, ...extra });
  const run = async (m: any, thread: any = { id: "t1", answered: false, topic_state: "aktiv" }) => {
    const t: any = { ...withRule(), hero_projects: [proj(1, 1)], email_messages: [m], email_threads: [thread] };
    await evaluateAll(fakeDb(t), NOW);
    return t.project_cards as any[];
  };
  it("legt nach mehr als 2 Tagen eine Kunden-Karte mit Mail-Bezug an", async () => {
    const cards = await run(msg(3));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ rule_key: "kunde_mail_offen", category: "kunde" });
    expect(cards[0].reasons).toMatchObject({ messageId: "m1", subject: "Wann geht es los?" });
    expect(cards[0].reasons.text).toContain("seit 3 Tagen unbeantwortet");
  });
  it("genau 2 Tage, beantwortet, von Hand erledigt, Werbung oder gelöscht: keine Karte", async () => {
    expect(await run(msg(2))).toHaveLength(0);
    expect(await run(msg(5), { id: "t1", answered: true, topic_state: "aktiv" })).toHaveLength(0);
    expect(await run(msg(5), { id: "t1", answered: false, topic_state: "erledigt" })).toHaveLength(0);
    expect(await run(msg(5, { category: "werbung_spam" }))).toHaveLength(0);
    expect(await run(msg(5, { trashed_at: ago(1) }))).toHaveLength(0);
  });
  it("nimmt die aelteste unbeantwortete Mail", async () => {
    const t: any = { ...withRule(), hero_projects: [proj(1, 1)], email_messages: [msg(3), msg(8, { id: "m0" })], email_threads: [{ id: "t1", answered: false, topic_state: "aktiv" }] };
    await evaluateAll(fakeDb(t), NOW);
    expect(t.project_cards[0].reasons.messageId).toBe("m0");
  });
});
