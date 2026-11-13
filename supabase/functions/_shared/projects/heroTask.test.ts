import { describe, expect, it } from "vitest";
import { fakeDb } from "./testdb.ts";
import { DEFAULT_CHECKLISTS, TaskError, checkTask, finishTask, lockForHero, parseChecklists, snapshotOf, type TaskSnapshot } from "./heroTask.ts";

const snap = (over: Partial<TaskSnapshot> = {}): TaskSnapshot => ({ stepId: 1, stepKey: "planung", stepName: "🚧 Projektplanung", docs: [], at: "2026-11-13T08:00:00Z", ...over });
const doc = (type: string, status = "Erstellt", nr = "X") => ({ type, status, nr });
const NOW = new Date("2026-11-13T08:00:00Z");

describe("checkTask", () => {
  it("AB erstellen: erst erledigt, wenn eine neue Auftragsbestaetigung da ist", () => {
    expect(checkTask("create_confirmation", snap(), snap()).passed).toBe(false);
    expect(checkTask("create_confirmation", snap(), snap({ docs: [doc("confirmation")] })).passed).toBe(true);
    // eine schon vorhandene AB zaehlt nicht
    expect(checkTask("create_confirmation", snap({ docs: [doc("confirmation")] }), snap({ docs: [doc("confirmation")] })).passed).toBe(false);
  });
  it("Angebot erstellen: neues Angebot (auch Entwurf mit gleicher Nummer) zaehlt", () => {
    expect(checkTask("create_offer", snap({ docs: [doc("offer", "Entwurf", "AG-xxxx")] }), snap({ docs: [doc("offer", "Entwurf", "AG-xxxx"), doc("offer", "Entwurf", "AG-xxxx")] })).passed).toBe(true);
  });
  it("Angebot fertigstellen: versendet oder Status Warten auf Auftrag", () => {
    expect(checkTask("finish_offer", snap({ docs: [doc("offer", "Entwurf")] }), snap({ docs: [doc("offer", "Versendet")] })).passed).toBe(true);
    expect(checkTask("finish_offer", snap({ docs: [doc("offer", "Entwurf")] }), snap({ docs: [doc("offer", "Erstellt")] })).passed).toBe(false);
    expect(checkTask("finish_offer", snap({ docs: [doc("offer", "Entwurf")] }), snap({ stepKey: "warten_auftrag", stepId: 2, docs: [doc("offer", "Entwurf")] })).passed).toBe(true);
  });
  it("Reklamation: Status muss weg von Reklamation", () => {
    const b = snap({ stepKey: "reklamation", stepId: 9, stepName: "⚠️ Reklamation" });
    expect(checkTask("complaint", b, b).passed).toBe(false);
    expect(checkTask("complaint", b, snap({ stepKey: "abholung", stepId: 10, stepName: "Fertig zur Abholung" })).passed).toBe(true);
  });
  it("allgemein: jede Aenderung am Status oder an den Dokumenten", () => {
    expect(checkTask("generic", snap(), snap()).passed).toBe(false);
    const r = checkTask("generic", snap(), snap({ stepId: 2, stepKey: "druck", stepName: "Druck" }));
    expect(r.passed).toBe(true);
    expect(r.changes[0]).toContain("Projektplanung");
  });
  it("snapshotOf ignoriert geloeschte Dokumente", () => {
    const s = snapshotOf({ id: 1, current_project_match_status: { step_id: 5, step: { id: 5, name: "🚧 Projektplanung" } }, customer_documents: [{ nr: "A", type: "offer", status_name: "Gelöscht" }, { nr: "B", type: "offer", status_name: "Versendet" }] }, NOW);
    expect(s.docs).toEqual([{ type: "offer", status: "Versendet", nr: "B" }]);
    expect(s.stepKey).toBe("planung");
  });
});

describe("Checklisten", () => {
  it("nimmt gepflegte Eintraege, sonst die Standardwerte", () => {
    const c = parseChecklists(JSON.stringify({ create_confirmation: { label: "AB", items: ["a", " ", "b"] }, complaint: { items: [] } }));
    expect(c.create_confirmation).toEqual({ label: "AB", items: ["a", "b"] });
    expect(c.complaint).toEqual(DEFAULT_CHECKLISTS.complaint);
    expect(parseChecklists("kaputt")).toEqual(DEFAULT_CHECKLISTS);
  });
});

const world = (over: Record<string, any[]> = {}) => fakeDb({
  project_cards: [{ id: "c1", hero_id: 100, rule_key: "ab_fehlt", state: "open", locked_until: null, locked_by: null }],
  hero_tasks: [], project_actions_log: [], ...over,
});
const me = { id: "u1", name: "Julian" };
const reader = (s: TaskSnapshot) => async () => s;

describe("lockForHero", () => {
  it("sperrt die Karte 30 Min, merkt den Vorher-Stand und waehlt die Aufgabe nach Regel", async () => {
    const db = world();
    const r = await lockForHero(db, { readState: reader(snap({ docs: [doc("offer", "Versendet")] })), now: NOW }, { heroId: 100, actor: me });
    expect(r).toMatchObject({ kind: "create_confirmation", label: "AB erstellen", reused: false });
    expect(r.checklist.length).toBeGreaterThan(0);
    expect(Date.parse(r.lockedUntil) - NOW.getTime()).toBe(30 * 60_000);
    const card = (await db.from("project_cards").select("*").eq("id", "c1")).data[0];
    expect(card).toMatchObject({ state: "in_hero", locked_by: "u1" });
    const t = (await db.from("hero_tasks").select("*")).data[0];
    expect(t).toMatchObject({ task: "create_confirmation", hero_id: 100, created_by_name: "Julian" });
    expect(t.before.docs).toHaveLength(1);
  });
  it("zweiter Klick desselben Benutzers verlaengert nur", async () => {
    const db = world();
    const deps = { readState: reader(snap()), now: NOW };
    const a = await lockForHero(db, deps, { heroId: 100, actor: me });
    const b = await lockForHero(db, { ...deps, now: new Date(NOW.getTime() + 600_000) }, { heroId: 100, actor: me });
    expect(b.reused).toBe(true);
    expect(b.taskId).toBe(a.taskId);
    expect((await db.from("hero_tasks").select("*")).data).toHaveLength(1);
  });
  it("fremde Sperre blockiert, abgelaufene nicht", async () => {
    const locked = { id: "c1", hero_id: 100, rule_key: "ab_fehlt", state: "in_hero", locked_until: new Date(NOW.getTime() + 600_000).toISOString(), locked_by: "u2" };
    const db = world({ project_cards: [locked], hero_tasks: [{ id: "t0", card_id: "c1", task: "create_confirmation", created_by_name: "Anna", finished_at: null }] });
    await expect(lockForHero(db, { readState: reader(snap()), now: NOW }, { heroId: 100, actor: me })).rejects.toThrow("Gerade von Anna");
    const expired = { ...locked, locked_until: new Date(NOW.getTime() - 60_000).toISOString() };
    const db2 = world({ project_cards: [expired] });
    await expect(lockForHero(db2, { readState: reader(snap()), now: NOW }, { heroId: 100, actor: me })).resolves.toMatchObject({ reused: false });
  });
  it("ohne offene Karte oder ohne HERO-Projekt: Fehler", async () => {
    await expect(lockForHero(world({ project_cards: [] }), { readState: reader(snap()), now: NOW }, { heroId: 100, actor: me })).rejects.toThrow(TaskError);
    await expect(lockForHero(world(), { readState: async () => null, now: NOW }, { heroId: 100, actor: me })).rejects.toThrow("nicht gefunden");
  });
});

describe("finishTask", () => {
  const started = async (db: any, before = snap()) => (await lockForHero(db, { readState: reader(before), now: NOW }, { heroId: 100, actor: me })).taskId;

  it("Erledigt + Abgleich passt: Karte wird geschlossen, Logbuch geschrieben", async () => {
    const db = world(); const logs: string[] = [];
    const taskId = await started(db);
    const r = await finishTask(db, { readState: reader(snap({ docs: [doc("confirmation")] })), logbook: async (_h, t) => { logs.push(t); }, now: NOW }, { taskId, result: "done", actor: me });
    expect(r).toMatchObject({ passed: true, closed: true });
    expect((await db.from("project_cards").select("*").eq("id", "c1")).data[0]).toMatchObject({ state: "done", close_reason: "In HERO erledigt", locked_by: null });
    expect(logs[0]).toContain("AB erstellen in HERO erledigt");
    expect((await db.from("hero_tasks").select("*")).data[0]).toMatchObject({ result: "done" });
  });
  it("Erledigt ohne Aenderung in HERO: Karte bleibt offen mit Hinweis, kein Logbuch", async () => {
    const db = world(); const logs: string[] = [];
    const taskId = await started(db);
    const r = await finishTask(db, { readState: reader(snap()), logbook: async (_h, t) => { logs.push(t); }, now: NOW }, { taskId, result: "done", actor: me });
    expect(r).toMatchObject({ passed: false, closed: false });
    expect(r.message).toContain("bleibt offen");
    expect((await db.from("project_cards").select("*").eq("id", "c1")).data[0]).toMatchObject({ state: "open", locked_by: null });
    expect(logs).toHaveLength(0);
    const t = (await db.from("hero_tasks").select("*")).data[0];
    expect(t.check_result.passed).toBe(false);
  });
  it("Teilweise und Problem geben die Karte frei, ohne HERO zu lesen", async () => {
    for (const result of ["partial", "problem"] as const) {
      const db = world(); let reads = 0;
      const taskId = await started(db);
      const r = await finishTask(db, { readState: async () => { reads++; return snap(); }, now: NOW }, { taskId, result, note: "Preis fehlt", actor: me });
      expect(r).toMatchObject({ passed: false, closed: false });
      expect(r.message).toContain("Preis fehlt");
      expect(reads).toBe(0);
      expect((await db.from("project_cards").select("*").eq("id", "c1")).data[0].state).toBe("open");
    }
  });
  it("Schattenmodus: Abgleich ja, Logbuch nein", async () => {
    const db = world(); const logs: string[] = [];
    const taskId = await started(db);
    const r = await finishTask(db, { readState: reader(snap({ docs: [doc("confirmation")] })), logbook: async (_h, t) => { logs.push(t); }, shadow: true, now: NOW }, { taskId, result: "done", actor: me });
    expect(r.closed).toBe(true);
    expect(logs).toHaveLength(0);
  });
  it("fremde Aufgabe nur fuer Admins, zweimal abschliessen geht nicht", async () => {
    const db = world();
    const taskId = await started(db);
    const deps = { readState: reader(snap({ docs: [doc("confirmation")] })), now: NOW };
    await expect(finishTask(db, deps, { taskId, result: "done", actor: { id: "u2", name: "Anna" } })).rejects.toThrow("jemand anderem");
    await finishTask(db, deps, { taskId, result: "done", actor: { id: "u2", name: "Chef", isAdmin: true } });
    await expect(finishTask(db, deps, { taskId, result: "done", actor: me })).rejects.toThrow("schon abgeschlossen");
  });
});

describe("Mail-Karte (Thema)", () => {
  const thread = "th1";
  it("startet auch ohne Projekt-Karte, merkt das Thema und waehlt die gewaehlte Aufgabe", async () => {
    const db = world({ project_cards: [] });
    const r = await lockForHero(db, { readState: reader(snap()), now: NOW }, { heroId: 100, actor: me, kind: "create_confirmation", threadId: thread });
    expect(r).toMatchObject({ kind: "create_confirmation", reused: false });
    expect((await db.from("hero_tasks").select("*")).data[0]).toMatchObject({ card_id: null, email_id: thread, task: "create_confirmation", hero_id: 100 });
  });
  it("sperrt eine offene Projekt-Karte mit; zweiter Klick verlaengert nur", async () => {
    const db = world();
    const deps = { readState: reader(snap()), now: NOW };
    const a = await lockForHero(db, deps, { heroId: 100, actor: me, kind: "create_confirmation", threadId: thread });
    expect((await db.from("project_cards").select("*").eq("id", "c1")).data[0].state).toBe("in_hero");
    const b = await lockForHero(db, deps, { heroId: 100, actor: me, kind: "create_confirmation", threadId: thread });
    expect(b.taskId).toBe(a.taskId);
  });
  it("ohne Karte und ohne Thema, mit unbekannter Aufgabe: Fehler", async () => {
    await expect(lockForHero(world({ project_cards: [] }), { readState: reader(snap()), now: NOW }, { heroId: 100, actor: me })).rejects.toThrow("keine offene Karte");
    await expect(lockForHero(world(), { readState: reader(snap()), now: NOW }, { heroId: 100, actor: me, kind: "hack", threadId: thread })).rejects.toThrow("Unbekannte Aufgabe");
  });
  it("Erledigt + Abgleich passt: Thema wird abgeschlossen, Logbuch nennt die Mail-Ansicht", async () => {
    const db = world({ project_cards: [] }); const closed: string[][] = []; const logs: string[] = [];
    const t = await lockForHero(db, { readState: reader(snap()), now: NOW }, { heroId: 100, actor: me, kind: "create_confirmation", threadId: thread });
    const r = await finishTask(db, { readState: reader(snap({ docs: [doc("confirmation")] })), closeTopic: async (id, l) => { closed.push([id, l]); }, logbook: async (_h, x) => { logs.push(x); }, now: NOW }, { taskId: t.taskId, result: "done", actor: me });
    expect(r).toMatchObject({ passed: true, closed: true, topicClosed: true });
    expect(closed).toEqual([[thread, "AB erstellen in HERO erledigt"]]);
    expect(logs[0]).toContain("Mail-Ansicht");
  });
  it("kein Treffer in HERO: Thema bleibt offen", async () => {
    const db = world({ project_cards: [] }); let closed = 0;
    const t = await lockForHero(db, { readState: reader(snap()), now: NOW }, { heroId: 100, actor: me, kind: "create_confirmation", threadId: thread });
    const r = await finishTask(db, { readState: reader(snap()), closeTopic: async () => { closed++; }, now: NOW }, { taskId: t.taskId, result: "done", actor: me });
    expect(r.passed).toBe(false);
    expect(closed).toBe(0);
  });
});
