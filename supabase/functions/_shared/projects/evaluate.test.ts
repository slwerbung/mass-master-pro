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
