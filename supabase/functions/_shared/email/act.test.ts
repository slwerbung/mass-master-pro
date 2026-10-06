import { describe, expect, it } from "vitest";
import { actOn, actPending, buildCreateProjectPayload, logbookText, matchConfidence, type ActContext, type ActDeps, type ActMessage, type ActStore } from "./act.ts";
import { AUTOPILOT_DEFAULTS, type Autopilot } from "./types.ts";

const INBOX = "INBOX";
const folders = { kunden: "1 Kunden", lieferanten: "2 Lieferanten", belege: "3 Belege", verwaltung: "5 Verwaltung", newsletter: "6 News", system: "7 System", aussortiert: "9 Aussortiert" };

function msg(o: Partial<ActMessage> = {}): ActMessage {
  return {
    id: "M1", account_id: "A", thread_id: "T1", direction: "in", current_folder: INBOX, current_uid: 100, from_addr: "kunde@x.de", from_name: "Max Muster",
    to_addrs: ["info@slwerbung.de"], subject: "Anfrage Sprinter", category: "projekt_kommunikation", confidence: 0.9, summary: "Fragt nach dem Stand.",
    extracted: { reply: { needed: false }, signal: null, contact: {}, request: {} }, hero_project_match_id: null, match_method: null,
    match_info: { certain: false, knownContact: false, reason: "" }, hero_logged_at: null, has_attachments: false, plan: [], status: "zugeordnet", attempts: 0, ...o,
  };
}
function ctx(o: Partial<ActContext> & { autopilot?: Partial<Autopilot> } = {}): ActContext {
  const { autopilot, ...rest } = o;
  return {
    autopilot: { ...AUTOPILOT_DEFAULTS, ...autopilot }, shadowMode: false, inbox: INBOX, folders, accountLabel: "info@",
    steps: { detailgespraech: 10, projektplanung: 11, visualisierung: 12, materialbestellung: 13, produktionsdaten: 14, reklamation: 15, warten_auftrag: 20, warten_layout: 21, warten_ware: 22 },
    gewerke: [{ short: "WER", name: "Werbetechnik", measure_id: 6619, default: true }], ...rest,
  };
}
function mk(o: { openAfter?: boolean; earlier?: ActMessage[]; step?: number | null; hero?: boolean; imap?: boolean } = {}) {
  const log = { logbook: [] as [number, string][], moves: [] as any[], keywords: [] as any[], suggestions: [] as any[], progress: [] as any[], saved: [] as any[], steps: [] as any[] };
  const open = new Set<string>();
  const store: ActStore = {
    loadActable: async () => [],
    save: async (id, p) => { log.saved.push([id, p]); },
    progress: async (id, p) => { log.progress.push([id, p]); },
    createSuggestion: async (id, type, payload) => { const k = `${id}:${type}`; if (open.has(k)) return false; open.add(k); log.suggestions.push({ type, payload }); return true; },
    hasOpenSuggestions: async () => open.size > 0 || !!o.openAfter,
    unansweredIncoming: async () => o.earlier ?? [],
    hasOutgoingAfter: async () => false,
    loadAttachments: async () => [],
  };
  const deps: ActDeps = {
    store,
    imap: o.imap === false ? null : { move: async (f, u, d) => { log.moves.push([f, u, d]); return 7; }, addKeywords: async (f, u, k) => { log.keywords.push([f, u, k]); } },
    hero: o.hero === false ? null : {
      addLogbook: async (id, t) => { log.logbook.push([id, t]); },
      projectStep: async (id) => ({ stepId: o.step ?? null, nr: "WER-1", name: "P" + id }),
      setStep: async (id, s) => { log.steps.push([id, s]); },
    },
    now: () => new Date("2026-10-07T10:00:00Z"),
  };
  return { deps, log };
}

describe("Logbuch", () => {
  it("sichere Zuordnung (Thread/Nummer): automatisch, genau einmal, sofort festgehalten", async () => {
    const t = mk();
    const m = msg({ hero_project_match_id: 5, match_method: "nummer", match_info: { certain: true, knownContact: true, reason: "", projectNr: "WER-1744" } });
    const r = await actOn(m, ctx(), t.deps);
    expect(t.log.logbook).toEqual([[5, "📥 Mail von Max Muster (info@): Anfrage Sprinter – Fragt nach dem Stand."]]);
    expect(r.patch.hero_logged_at).toBe("2026-10-07T10:00:00.000Z");
    expect(t.log.progress[0]).toEqual(["M1", { hero_logged_at: "2026-10-07T10:00:00.000Z" }]);
    // zweiter Lauf mit gesetztem hero_logged_at schreibt nichts mehr
    const t2 = mk();
    await actOn({ ...m, hero_logged_at: "2026-10-07T10:00:00.000Z" }, ctx(), t2.deps);
    expect(t2.log.logbook).toEqual([]);
  });
  it("vermutete Zuordnung: Vorschlag „Projekt zuordnen“, kein Logbuch", async () => {
    const t = mk();
    const m = msg({ hero_project_match_id: 5, match_method: "kontakt", match_info: { certain: false, knownContact: true, reason: "ein offenes Projekt", projectNr: "WER-2" } });
    const r = await actOn(m, ctx(), t.deps);
    expect(t.log.logbook).toEqual([]);
    expect(t.log.suggestions[0]).toMatchObject({ type: "link_project", payload: { projectId: 5, projectNr: "WER-2" } });
    expect(r.status).toBe("wartet");
    expect(t.log.keywords[0][2]).toEqual(["WER-2", "Freigabe-offen"]);
  });
  it("vermutet + Stufe „Automatisch“: nur bei ausreichender Sicherheit", async () => {
    const t = mk();
    const m = msg({ hero_project_match_id: 5, match_method: "kontakt", match_info: { certain: false, knownContact: true, reason: "" } });
    await actOn(m, ctx({ autopilot: { log_assumed: "auto" } }), t.deps);
    expect(t.log.logbook).toHaveLength(1);
    const t2 = mk();
    await actOn({ ...m, match_method: "kontakt", confidence: 0.2 }, ctx({ autopilot: { log_assumed: "auto" } }), t2.deps);
    expect(t2.log.logbook).toHaveLength(1); // Zuordnungssicherheit zaehlt, nicht die Kategorie-Konfidenz
    const t3 = mk();
    await actOn({ ...m, match_method: null }, ctx({ autopilot: { log_assumed: "auto" } }), t3.deps);
    expect(t3.log.logbook).toHaveLength(0);
  });
  it("ausgehend: 📤-Format", () => {
    expect(logbookText(msg({ direction: "out", to_addrs: ["k@x.de"], summary: "Termin vorgeschlagen." }), "info@")).toBe("📤 Mail an k@x.de (info@): Anfrage Sprinter – Termin vorgeschlagen.");
    expect(logbookText(msg({ has_attachments: true }), "info@", 3)).toContain("Anhänge: 3");
  });
  it("matchConfidence", () => {
    expect(matchConfidence("thread", true)).toBe(1);
    expect(matchConfidence("kontakt", false)).toBe(0.75);
    expect(matchConfidence("ki", false)).toBe(0.7);
  });
});

describe("Schattenmodus", () => {
  it("rechnet nur: nichts im Postfach, nichts in HERO, aber der Plan steht da", async () => {
    const t = mk();
    const m = msg({ category: "lieferant", hero_project_match_id: 5, match_info: { certain: true, knownContact: true, reason: "", projectNr: "WER-1" }, match_method: "thread" });
    const r = await actOn(m, ctx({ shadowMode: true }), t.deps);
    expect(t.log.logbook).toEqual([]);
    expect(t.log.moves).toEqual([]);
    expect(t.log.keywords).toEqual([]);
    expect(r.plan.map((p) => [p.action, p.decision, p.done])).toEqual([["log", "shadow", false], ["move", "shadow", false], ["keywords", "shadow", false]]);
    expect(r.plan[1].detail).toContain("2 Lieferanten");
    expect(r.status).toBe("erledigt");
  });
  it("Vorschlaege entstehen auch im Schattenmodus (sie aendern selbst nichts)", async () => {
    const t = mk();
    const m = msg({ category: "anfrage_neu", extracted: { contact: { first_name: "Max", email: "max@x.de" }, request: { summary: "Sprinter", service: "Fahrzeugbeschriftung", project_name: "Fahrzeugbeschriftung VW Crafter" } } });
    const r = await actOn(m, ctx({ shadowMode: true }), t.deps);
    expect(t.log.suggestions[0].type).toBe("create_project");
    expect(r.status).toBe("wartet");
  });
});

describe("Sortieren", () => {
  it("Lieferant nach Ordner 2, Schlagwort an der NEUEN UID, Fortschritt sofort gespeichert", async () => {
    const t = mk();
    const m = msg({ category: "lieferant", hero_project_match_id: 5, match_info: { certain: true, knownContact: true, reason: "", projectNr: "WER-9" }, match_method: "nummer" });
    const r = await actOn(m, ctx(), t.deps);
    expect(t.log.moves).toEqual([[INBOX, 100, "2 Lieferanten"]]);
    expect(t.log.keywords).toEqual([["2 Lieferanten", 7, ["WER-9"]]]);
    expect(r.patch).toMatchObject({ current_folder: "2 Lieferanten", current_uid: 7 });
    expect(t.log.progress.some(([, p]) => p.current_folder === "2 Lieferanten")).toBe(true);
  });
  it("Kundenmails bleiben im Posteingang", async () => {
    for (const c of ["anfrage_neu", "projekt_kommunikation", "layout_freigabe", "auftrag", "reklamation"] as const) {
      const t = mk();
      await actOn(msg({ category: c }), ctx(), t.deps);
      expect(t.log.moves).toEqual([]);
    }
  });
  it("Unsicher (< 0,7): nicht verschieben", async () => {
    const t = mk();
    const r = await actOn(msg({ category: "newsletter", confidence: 0.6 }), ctx(), t.deps);
    expect(t.log.moves).toEqual([]);
    expect(r.plan[0]).toMatchObject({ action: "move", decision: "suggest", done: false });
  });
  it("Regel-Treffer braucht keine Modell-Konfidenz", async () => {
    const t = mk();
    await actOn(msg({ category: "system", confidence: 1, extracted: { _meta: { source: "regel" } } }), ctx(), t.deps);
    expect(t.log.moves).toEqual([[INBOX, 100, "7 System"]]);
  });
  it("Aussortieren: nur bei hoher Konfidenz, nie bei bekannten Kontakten oder geschuetzten Absendern", async () => {
    const spam = (o: Partial<ActMessage>) => msg({ category: "werbung_spam", confidence: 0.95, ...o });
    const t1 = mk(); await actOn(spam({}), ctx(), t1.deps);
    expect(t1.log.moves).toEqual([[INBOX, 100, "9 Aussortiert"]]);
    const t2 = mk(); await actOn(spam({ confidence: 0.8 }), ctx(), t2.deps);
    expect(t2.log.moves).toEqual([]);
    const t3 = mk(); const r3 = await actOn(spam({ match_info: { certain: false, knownContact: true, reason: "" } }), ctx(), t3.deps);
    expect(t3.log.moves).toEqual([]);
    expect(r3.plan[0].detail).toMatch(/nie aussortieren/);
    const t4 = mk(); await actOn(spam({ extracted: { _meta: { protect: true } } }), ctx(), t4.deps);
    expect(t4.log.moves).toEqual([]);
    const t5 = mk(); await actOn(spam({ hero_project_match_id: 3, match_info: { certain: true, knownContact: true, reason: "" } }), ctx({ autopilot: { log_certain: "off" } }), t5.deps);
    expect(t5.log.moves).toEqual([]);
  });
  it("Verwaltung mit Handlungsbedarf bleibt im Posteingang", async () => {
    const t = mk();
    await actOn(msg({ category: "verwaltung", extracted: { reply: { needed: true } } }), ctx(), t.deps);
    expect(t.log.moves).toEqual([]);
    const t2 = mk();
    await actOn(msg({ category: "verwaltung" }), ctx(), t2.deps);
    expect(t2.log.moves).toHaveLength(1);
  });
  it("Stufe „Aus“ und fehlender Zielordner", async () => {
    const t = mk(); await actOn(msg({ category: "newsletter" }), ctx({ autopilot: { move_folders: "off" } }), t.deps);
    expect(t.log.moves).toEqual([]);
    const t2 = mk(); const r = await actOn(msg({ category: "newsletter" }), ctx({ folders: {} }), t2.deps);
    expect(t2.log.moves).toEqual([]);
    expect(r.plan[0].detail).toMatch(/nicht eingerichtet/);
  });
  it("verschiebt nichts, was nicht mehr im Posteingang liegt", async () => {
    const t = mk();
    await actOn(msg({ category: "newsletter", current_folder: "6 News" }), ctx(), t.deps);
    expect(t.log.moves).toEqual([]);
  });
  it("beantwortet: fruehere Kundenmails des Threads wandern nach „1 Kunden“", async () => {
    const earlier = msg({ id: "M0", category: "projekt_kommunikation", current_uid: 50, subject: "Frage", hero_project_match_id: 5 });
    const t = mk({ earlier: [earlier] });
    await actOn(msg({ direction: "out", category: null, hero_project_match_id: 5, match_info: { certain: true, knownContact: true, reason: "" } }), ctx(), t.deps);
    expect(t.log.moves).toEqual([[INBOX, 50, "1 Kunden"]]);
    expect(t.log.saved[0]).toEqual(["M0", expect.objectContaining({ status: "erledigt", current_folder: "1 Kunden" })]);
    const t2 = mk({ earlier: [earlier] });
    await actOn(msg({ direction: "out", category: null }), ctx({ autopilot: { move_answered: "off" } }), t2.deps);
    expect(t2.log.moves).toEqual([]);
  });
  it("ohne IMAP-Zugriff wird nichts behauptet", async () => {
    const t = mk({ imap: false });
    const r = await actOn(msg({ category: "newsletter" }), ctx(), t.deps);
    expect(r.plan[0]).toMatchObject({ action: "move", decision: "skip", done: false });
  });
});

describe("Vorschlaege", () => {
  it("Neue Anfrage ohne Projekt: Kontakt + Projekt, Gewerk, Name und E-Mail-Rueckfall", () => {
    const m = msg({ category: "anfrage_neu", extracted: { contact: { first_name: "Max" }, request: { summary: "30 Hoodies", service: "Textildruck", project_name: null, location: null } } });
    const p: any = buildCreateProjectPayload(m, { gewerke: [{ short: "WER", name: "W", measure_id: 1, default: true }, { short: "TEX", name: "T", measure_id: 2, services: ["Textildruck"] }] });
    expect(p.contact.email).toBe("kunde@x.de");
    expect(p.project.gewerk).toEqual({ short: "TEX", measure_id: 2 });
    expect(p.project.name).toBe("Textildruck");
  });
  it("Mehrere offene Projekte: Auswahl-Vorschlag", async () => {
    const t = mk();
    const cands = [{ id: 1, nr: "WER-1", name: "A", stepName: "x" }, { id: 2, nr: "WER-2", name: "B", stepName: "y" }];
    const r = await actOn(msg({ match_info: { certain: false, knownContact: true, reason: "mehrere", candidates: cands } }), ctx(), t.deps);
    expect(t.log.suggestions[0]).toMatchObject({ type: "link_project", payload: { projectId: null, candidates: cands } });
    expect(r.status).toBe("wartet");
  });
  it("Statuswechsel nur bei klarem Signal im passenden Schritt", async () => {
    const m = msg({ category: "layout_freigabe", hero_project_match_id: 5, match_info: { certain: true, knownContact: true, reason: "" }, extracted: { signal: "layout_freigegeben" } });
    const t = mk({ step: 21 });
    await actOn(m, ctx(), t.deps);
    expect(t.log.suggestions.find((s) => s.type === "change_step")).toMatchObject({ payload: { toStepId: 13, fromStepId: 21, toLabel: "Materialbestellung" } });
    expect(t.log.steps).toEqual([]);
    const t2 = mk({ step: 99 });
    await actOn(m, ctx(), t2.deps);
    expect(t2.log.suggestions.find((s) => s.type === "change_step")).toBeUndefined();
  });
  it("Statuswechsel „Automatisch“ schaltet nur bei sicherer Zuordnung", async () => {
    const base = msg({ category: "layout_freigabe", hero_project_match_id: 5, extracted: { signal: "layout_freigegeben" } });
    const t = mk({ step: 21 });
    await actOn({ ...base, match_info: { certain: true, knownContact: true, reason: "" } }, ctx({ autopilot: { status_change: "auto" } }), t.deps);
    expect(t.log.steps).toEqual([[5, 13]]);
    const t2 = mk({ step: 21 });
    await actOn({ ...base, confidence: 0.3, match_info: { certain: false, knownContact: true, reason: "" } }, ctx({ autopilot: { status_change: "auto" } }), t2.deps);
    expect(t2.log.steps).toEqual([]);
    expect(t2.log.suggestions.some((s) => s.type === "change_step")).toBe(true);
  });
  it("kein zweiter offener Vorschlag derselben Art (Wiederholungslauf)", async () => {
    const t = mk();
    const m = msg({ category: "anfrage_neu" });
    await actOn(m, ctx(), t.deps);
    const r2 = await actOn(m, ctx(), t.deps);
    expect(t.log.suggestions.filter((s) => s.type === "create_project")).toHaveLength(1);
    expect(r2.plan.find((p) => p.action === "create_project")?.detail).toMatch(/schon offen/);
  });
});

describe("actPending", () => {
  it("ein Fehler haelt nur diese Mail an; nach drei Fehlversuchen Status „fehler“", async () => {
    const t = mk();
    const bad = msg({ id: "B", category: "newsletter", attempts: 2 });
    const good = msg({ id: "G", category: "newsletter" });
    t.deps.store.loadActable = async () => [bad, good];
    let n = 0;
    t.deps.imap!.move = async () => { if (n++ === 0) throw new Error("IMAP weg"); return 3; };
    const s = await actPending("A", ctx(), t.deps);
    expect(s).toMatchObject({ processed: 1, errors: 1, moved: 1 });
    expect(t.log.saved[0]).toEqual(["B", expect.objectContaining({ status: "fehler", attempts: 3, error: "IMAP weg" })]);
    expect(t.log.saved[1][1]).toMatchObject({ status: "erledigt", current_folder: "6 News" });
  });
});
