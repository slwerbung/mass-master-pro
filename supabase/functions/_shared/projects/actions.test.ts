import { describe, expect, it } from "vitest";
import { archiveAction, berlinWallToIso, bulkArchiveAction, completeAction, eventsAction, noteAction, setStepAction, type ActionCtx, type HeroOps } from "./actions.ts";
import { fakeDb } from "./testdb.ts";

const STEPS = [
  { id: 1, name: "📬Anfragen" }, { id: 2, name: "🚧 Projektplanung" }, { id: 2836, name: "✅ Abgeschlossen" }, { id: 2837, name: "📦 Archiviert" },
];

function setup(opts: { shadow: boolean; failStep?: boolean; failLogbook?: boolean; failEventTitle?: string }) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const ops: HeroOps = {
    listSteps: async () => { calls.push({ fn: "listSteps", args: [] }); return STEPS; },
    setStep: async (id, s) => { calls.push({ fn: "setStep", args: [id, s] }); if (opts.failStep) throw new Error("HERO kaputt"); },
    addLogbook: async (id, t) => { calls.push({ fn: "addLogbook", args: [id, t] }); if (opts.failLogbook) throw new Error("Logbuch kaputt"); },
    createEvent: async (a) => { calls.push({ fn: "createEvent", args: [a] }); return a.title === opts.failEventTitle ? { id: null, error: "abgelehnt" } : { id: 100 + calls.length }; },
  };
  const tables: any = {
    hero_projects: [
      { hero_id: 7, project_nr: "WER-7", name: "Schild", step_id: 2, step_name: "🚧 Projektplanung", step_key: "planung", step_since: "2026-10-01T00:00:00Z", hero_created: "2026-09-01T00:00:00Z", documents: [], assignee_emails: [] },
      { hero_id: 8, project_nr: "WER-8", name: "Banner", step_id: 1, step_name: "📬Anfragen", step_key: "anfragen", step_since: "2026-10-01T00:00:00Z", hero_created: "2026-09-01T00:00:00Z", documents: [], assignee_emails: [] },
    ],
    project_step_settings: [{ step_id: 1, name: "Anfragen", key: "anfragen", target_days: 7, excluded: false, closeness: 10 }, { step_id: 2, name: "Projektplanung", key: "planung", target_days: 7, excluded: false, closeness: 30 }],
    project_rules: [], project_cards: [], followups: [], project_rule_mutes: [], app_config: [], project_actions_log: [],
    employees: [{ id: "e1", hero_partner_id: 555 }, { id: "e2", hero_partner_id: null }],
  };
  const ctx: ActionCtx = { sb: fakeDb(tables), ops, user: "Silas", shadow: opts.shadow, now: new Date("2026-11-12T10:00:00Z") };
  const wrote = () => calls.filter((c) => c.fn !== "listSteps");
  return { ctx, tables, calls, wrote };
}

describe("Schattenmodus", () => {
  it("schreibt nichts nach HERO, protokolliert aber jede Aktion", async () => {
    const { ctx, tables, wrote } = setup({ shadow: true });
    await completeAction(ctx, 7);
    await archiveAction(ctx, 8);
    await setStepAction(ctx, 7, 1);
    await noteAction(ctx, 7, "Hallo");
    await eventsAction(ctx, 7, [{ title: "Montage", date: "2026-11-20", durationMinutes: 120 }], 999);
    const bulk = await bulkArchiveAction(ctx, [7, 8]);
    expect(wrote()).toEqual([]);
    expect(tables.hero_projects).toHaveLength(2); // Spiegel unveraendert
    expect(tables.project_actions_log.map((l: any) => l.action)).toEqual(["complete", "archive", "set_step", "logbook_note", "create_events", "bulk_archive", "bulk_archive"]);
    expect(tables.project_actions_log.every((l: any) => l.shadow === true)).toBe(true);
    expect(bulk.shadow).toBe(true);
  });
});

describe("Aktionen scharf", () => {
  it("Abschliessen: Status in HERO (ID aus der HERO-Liste), Logbuch, Spiegel und Karte bereinigt", async () => {
    const { ctx, tables, wrote } = setup({ shadow: false });
    tables.project_cards.push({ id: "c1", hero_id: 7, rule_key: "haengt", state: "open", reasons: {}, priority: 1, bundled: false, category: "termine" });
    const r = await completeAction(ctx, 7);
    expect(r).toMatchObject({ ok: true, shadow: false });
    expect(wrote()[0]).toEqual({ fn: "setStep", args: [7, 2836] });
    expect(wrote()[1].fn).toBe("addLogbook");
    expect(String(wrote()[1].args[1])).toContain("abgeschlossen");
    expect(tables.hero_projects.map((p: any) => p.hero_id)).toEqual([8]);
    expect(tables.project_cards[0].state).toBe("done");
    expect(tables.project_actions_log[0]).toMatchObject({ action: "complete", hero_id: 7, shadow: false, error: null });
  });

  it("Status ändern: Spiegel bekommt neuen Status, nur bekannte HERO-Status erlaubt", async () => {
    const { ctx, tables } = setup({ shadow: false });
    await setStepAction(ctx, 8, 2);
    expect(tables.hero_projects.find((p: any) => p.hero_id === 8)).toMatchObject({ step_id: 2, step_key: "planung" });
    await expect(setStepAction(ctx, 8, 99999)).rejects.toThrow("gibt es in HERO nicht");
  });

  it("scheitert HERO beim Statuswechsel, bleibt alles unverändert und der Fehler steht im Log", async () => {
    const { ctx, tables, wrote } = setup({ shadow: false, failStep: true });
    await expect(completeAction(ctx, 7)).rejects.toThrow("HERO kaputt");
    expect(wrote().map((c) => c.fn)).toEqual(["setStep"]); // kein Logbuch
    expect(tables.hero_projects).toHaveLength(2);
    expect(tables.project_actions_log[0]).toMatchObject({ action: "complete", error: "HERO kaputt" });
  });

  it("Logbuch-Fehler nach erfolgreichem Statuswechsel ist nur eine Warnung", async () => {
    const { ctx } = setup({ shadow: false, failLogbook: true });
    const r = await archiveAction(ctx, 8);
    expect(r.ok).toBe(true);
    expect(r.warnings?.[0]).toContain("Logbuch-Eintrag fehlgeschlagen");
  });

  it("Notiz: Pflichttext, Länge, schreibt ins Logbuch", async () => {
    const { ctx, wrote } = setup({ shadow: false });
    await expect(noteAction(ctx, 7, "  ")).rejects.toThrow("Text");
    await expect(noteAction(ctx, 7, "x".repeat(2001))).rejects.toThrow("2000");
    await noteAction(ctx, 7, "Kunde ruft zurück");
    expect(String(wrote()[0].args[1])).toContain("Kunde ruft zurück");
  });

  it("Termine: alle drei mit Mitarbeiter (hero_partner_id) und Logbuch; ohne Kategorie nichts", async () => {
    const { ctx, wrote } = setup({ shadow: false });
    const events = [
      { title: "Gestaltung", date: "2026-11-16", time: "09:00", durationMinutes: 120, employeeId: "e1" },
      { title: "Produktion", date: "2026-11-19", durationMinutes: 240 },
      { title: "Montage", date: "2026-11-23", time: "08:00", durationMinutes: 240, employeeId: "e2" },
    ];
    await expect(eventsAction(ctx, 7, events, null)).rejects.toThrow("Terminkategorie");
    expect(wrote()).toEqual([]);
    const r = await eventsAction(ctx, 7, events, 224953);
    expect(r.message).toContain("3 Termin");
    const ev = wrote().filter((c) => c.fn === "createEvent").map((c) => c.args[0] as any);
    expect(ev.map((e) => e.partnerId)).toEqual([555, null, null]);
    expect(ev.every((e) => e.categoryId === 224953 && e.heroId === 7)).toBe(true);
    expect(new Date(ev[0].endIso).getTime() - new Date(ev[0].startIso).getTime()).toBe(120 * 60_000);
    expect(wrote().at(-1)!.fn).toBe("addLogbook");
  });

  it("Termine: Tippfehler in einer Zeile legt gar nichts an; Teilfehler wird gemeldet", async () => {
    const { ctx, wrote } = setup({ shadow: false, failEventTitle: "Montage" });
    await expect(eventsAction(ctx, 7, [{ title: "A", date: "2026-11-16", durationMinutes: 60 }, { title: "B", date: "morgen", durationMinutes: 60 }], 1)).rejects.toThrow("ungültig");
    await expect(eventsAction(ctx, 7, [{ title: "", date: "2026-11-16", durationMinutes: 60 }], 1)).rejects.toThrow("Titel");
    await expect(eventsAction(ctx, 7, [{ title: "A", date: "2026-11-16", durationMinutes: 5 }], 1)).rejects.toThrow("Dauer");
    expect(wrote()).toEqual([]);
    const r = await eventsAction(ctx, 7, [{ title: "Gestaltung", date: "2026-11-16", durationMinutes: 60 }, { title: "Montage", date: "2026-11-23", durationMinutes: 60 }], 1);
    expect(r.warnings?.[0]).toContain("Montage: abgelehnt");
    expect((r.created as unknown[]).length).toBe(1);
  });

  it("Aufräumen: archiviert die Auswahl, ein Fehler stoppt die anderen nicht, höchstens 25 je Aufruf", async () => {
    const { ctx, tables } = setup({ shadow: false });
    const r = await bulkArchiveAction(ctx, [7, 8, 12345]);
    expect(r.done).toEqual([7, 8]);
    expect((r.failed as { heroId: number }[]).map((f) => f.heroId)).toEqual([12345]);
    expect(tables.hero_projects).toHaveLength(0);
    await expect(bulkArchiveAction(ctx, Array.from({ length: 26 }, (_, i) => i + 1))).rejects.toThrow("25");
    await expect(bulkArchiveAction(ctx, [])).rejects.toThrow("Keine Projekte");
  });
});

describe("Berliner Zeit", () => {
  it("Winter und Sommer: Wanduhrzeit bleibt erhalten", () => {
    expect(berlinWallToIso("2026-11-16", "09:00")).toBe("2026-11-16T08:00:00.000Z");
    expect(berlinWallToIso("2026-07-16", "09:00")).toBe("2026-07-16T07:00:00.000Z");
    expect(() => berlinWallToIso("2026-02-30", "09:00")).toThrow();
    expect(() => berlinWallToIso("16.11.2026", "9")).toThrow();
  });
});
