import { describe, expect, it } from "vitest";
import { projectDigest } from "./digest.ts";
import { fakeDb } from "./testdb.ts";

const NOW = new Date("2026-11-13T05:00:00Z"); // 06:00 Berlin
const card = (hero: number, category: string, extra: any = {}) => ({ hero_id: hero, category, bundled: false, state: "open", priority: hero, reasons: { text: `Warum ${hero}` }, ...extra });
const proj = (id: number, assignees: string[] = []) => ({ hero_id: id, project_nr: `WER-${id}`, name: `P${id}`, assignee_emails: assignees });
const admin = { role: "admin", email: "a@x.de" };

describe("projectDigest", () => {
  it("zaehlt je Kategorie, trennt die Aufraeum-Karte ab und nennt die ersten Kundenkarten", async () => {
    const db = fakeDb({
      project_cards: [card(1, "kunde"), card(2, "kunde"), card(3, "auftrag"), card(4, "termine"), card(5, "pflege", { bundled: true }), card(6, "kunde", { state: "done" })],
      followups: [], hero_projects: [proj(1), proj(2), proj(3), proj(4), proj(5), proj(6)],
    });
    const d = await projectDigest(db, admin, NOW);
    expect(d).toMatchObject({ cards: 4, byCategory: { kunde: 2, auftrag: 1, termine: 1, pflege: 0 }, cleanup: 1, followupsToday: 0 });
    expect(d.topCustomer.map((x) => x.nr)).toEqual(["WER-1", "WER-2"]);
    expect(d.text).toBe("Projekte: 4 Projekt-Karten (Kunde 2, Auftrag 1, Termine 1, Pflege 0), 1 in der Aufräum-Karte.");
  });
  it("Wiedervorlagen bis Ende heute (Berliner Zeit), morgen nicht", async () => {
    const db = fakeDb({
      project_cards: [], hero_projects: [proj(1), proj(2), proj(3)],
      followups: [
        { hero_id: 1, target_type: "project", due_at: "2026-11-13T04:00:00Z", done_at: null },   // heute 05:00 Berlin
        { hero_id: 2, target_type: "project", due_at: "2026-11-13T22:30:00Z", done_at: null },   // heute 23:30 Berlin
        { hero_id: 3, target_type: "project", due_at: "2026-11-13T23:30:00Z", done_at: null },   // morgen 00:30 Berlin
      ],
    });
    const d = await projectDigest(db, admin, NOW);
    expect(d.followupsToday).toBe(2);
    expect(d.text).toBe("Projekte: 2 Wiedervorlagen heute.");
  });
  it("Mitarbeiter sehen nur eigene oder nicht zugewiesene Projekte", async () => {
    const db = fakeDb({ project_cards: [card(1, "kunde"), card(2, "kunde"), card(3, "kunde")], followups: [], hero_projects: [proj(1, ["me@x.de"]), proj(2, ["other@x.de"]), proj(3)] });
    const d = await projectDigest(db, { role: "mitarbeiter", email: "ME@x.de" }, NOW);
    expect(d.cards).toBe(2);
    expect(d.topCustomer.map((x) => x.nr)).toEqual(["WER-1", "WER-3"]);
  });
  it("nichts offen", async () => {
    const d = await projectDigest(fakeDb({ project_cards: [], followups: [], hero_projects: [] }), admin, NOW);
    expect(d.text).toBe("Projekte: nichts offen.");
  });
});
