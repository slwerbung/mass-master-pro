import { describe, expect, it } from "vitest";
import { decideSuggestion, type ActionDeps, type ActionHero, type ActionStore, type SuggestionRow } from "./action.ts";

function row(o: Partial<SuggestionRow> & { payload?: any } = {}): SuggestionRow {
  return {
    id: "S1", message_id: "M1", type: "link_project", status: "offen", payload: { projectId: 5, candidates: [], text: "📥 Text" },
    message: {
      id: "M1", account_id: "A", thread_id: "T1", direction: "in", from_addr: "Kunde@X.de", from_name: "Max", to_addrs: ["info@s.de"], subject: "Frage",
      summary: "Sum", has_attachments: false, hero_project_match_id: null, hero_logged_at: null, match_info: { certain: false, knownContact: true, reason: "" }, account_label: "info@",
    },
    ...o,
  };
}

function setup(s: SuggestionRow | null, o: { hero?: Partial<ActionHero> | null; open?: number; claim?: boolean } = {}) {
  const log: any = { claimed: [], finished: [], assigned: [], logged: [], feedback: [], status: [], logbook: [], steps: [], contacts: [], projects: [], dropped: [] };
  const store: ActionStore = {
    getSuggestion: async () => s,
    claim: async (id) => (log.claimed.push(id), o.claim !== false),
    finish: async (id, st, r) => { log.finished.push([id, st, r]); },
    assignProject: async (m, t, p, info) => { log.assigned.push([m, t, p, info]); },
    markLogged: async (m) => { log.logged.push(m); },
    openCount: async () => o.open ?? 0,
    setMessageStatus: async (m, st) => { log.status.push([m, st]); },
    addFeedback: async (m, f, a, b) => { log.feedback.push([m, f, a, b]); },
    dropContactCache: async (e) => { log.dropped.push(e); },
  };
  const hero: ActionHero | null = o.hero === null ? null : {
    addLogbook: async (id, t) => { log.logbook.push([id, t]); },
    setStep: async (id, st) => { log.steps.push([id, st]); },
    projectById: async (id) => (id === 404 ? null : { id, nr: `WER-${id}`, name: `P${id}`, stepId: 1, stepName: "x", customerId: 7, customerName: "K" }),
    createContact: async (c, src) => (log.contacts.push([c, src]), 900),
    contactsByEmail: async () => [{ id: 900, customerId: 901, name: "Max", email: "kunde@x.de", isContactPerson: true }],
    createProject: async (p) => (log.projects.push(p), { id: 555, nr: "WER-555" }),
    ...(o.hero ?? {}),
  };
  const deps: ActionDeps = { hero, store, config: { stepIds: [10, 11, 13], projectTypeId: 181, startStepId: 2825, gewerke: [{ short: "WER", name: "W", measure_id: 6619, default: true }] } };
  return { deps, log };
}

describe("link_project / log_entry", () => {
  it("ordnet zu, schreibt genau einmal ins Logbuch, setzt die Mail auf erledigt", async () => {
    const t = setup(row());
    const r = await decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps);
    expect(r).toMatchObject({ status: "angenommen", projectId: 5, logged: true });
    expect(t.log.assigned[0]).toEqual(["M1", "T1", 5, expect.objectContaining({ certain: true, projectNr: "WER-5" })]);
    expect(t.log.logbook).toEqual([[5, "📥 Text"]]);
    expect(t.log.logged).toEqual(["M1"]);
    expect(t.log.finished[0]).toEqual(["S1", "angenommen", expect.objectContaining({ projectId: 5 })]);
    expect(t.log.status).toEqual([["M1", "erledigt"]]);
  });
  it("Auswahl eines anderen Projekts ist eine Korrektur (Feedback) und wird geprueft", async () => {
    const t = setup(row());
    await decideSuggestion({ suggestionId: "S1", decision: "accept", edits: { projectId: 9 } }, t.deps);
    expect(t.log.feedback).toEqual([["M1", "hero_project", "5", "9"]]);
    expect(t.log.logbook[0][0]).toBe(9);
    const t2 = setup(row());
    await expect(decideSuggestion({ suggestionId: "S1", decision: "accept", edits: { projectId: 404 } }, t2.deps)).rejects.toThrow(/gibt es in HERO nicht/);
    expect(t2.log.finished[0][1]).toBe("fehlgeschlagen");
    expect(t2.log.logbook).toEqual([]);
  });
  it("ohne Projektwahl (mehrere Kandidaten) kommt eine klare Meldung", async () => {
    const t = setup(row({ payload: { projectId: null, candidates: [{ id: 1 }, { id: 2 }] } }));
    await expect(decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps)).rejects.toThrow(/Projekt auswählen/);
  });
  it("kein zweiter Logbucheintrag, wenn die Mail schon protokolliert ist", async () => {
    const s = row(); s.message.hero_logged_at = "2026-01-01";
    const t = setup(s);
    const r = await decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps);
    expect(r.logged).toBe(false);
    expect(t.log.logbook).toEqual([]);
  });
  it("ein Logbuch-Fehler macht die Zuordnung nicht rueckgaengig, sondern wird gemeldet", async () => {
    const t = setup(row(), { hero: { addLogbook: async () => { throw new Error("HERO 500"); } } });
    const r: any = await decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps);
    expect(r.warnings[0]).toMatch(/HERO 500/);
    expect(t.log.assigned).toHaveLength(1);
  });
  it("offene weitere Vorschlaege lassen die Mail auf „wartet“", async () => {
    const t = setup(row({ type: "log_entry" }), { open: 1 });
    await decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps);
    expect(t.log.status).toEqual([["M1", "wartet"]]);
  });
});

describe("Schutz", () => {
  it("Doppelklick: wer den Vorschlag nicht beanspruchen kann, fasst HERO nicht an", async () => {
    const t = setup(row(), { claim: false });
    await expect(decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps)).rejects.toThrow(/schon entschieden/);
    expect(t.log.logbook).toEqual([]);
    expect(t.log.finished).toEqual([]);
  });
  it("ohne HERO nichts ausfuehren", async () => {
    const t = setup(row(), { hero: null });
    await expect(decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps)).rejects.toThrow(/nicht aktiviert/);
    expect(t.log.claimed).toEqual([]);
  });
  it("unbekannter Vorschlag und unbekannte Art", async () => {
    await expect(decideSuggestion({ suggestionId: "x", decision: "accept" }, setup(null).deps)).rejects.toThrow(/nicht gefunden/);
    const t = setup(row({ type: "prepare_offer" }));
    await expect(decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps)).rejects.toThrow(/noch nicht unterstützt/);
    expect(t.log.finished[0][1]).toBe("fehlgeschlagen");
  });
});

describe("Ablehnen", () => {
  it("merkt sich die Ablehnung als Korrektur und raeumt die Mail auf", async () => {
    const t = setup(row());
    expect(await decideSuggestion({ suggestionId: "S1", decision: "reject" }, t.deps)).toEqual({ status: "abgelehnt" });
    expect(t.log.finished[0]).toEqual(["S1", "abgelehnt", {}]);
    expect(t.log.feedback[0]).toEqual(["M1", "suggestion.link_project", "vorgeschlagen", "abgelehnt"]);
    expect(t.log.status).toEqual([["M1", "erledigt"]]);
    expect(t.log.claimed).toEqual([]);
  });
  it("schon Entschiedenes laesst sich nicht noch einmal ablehnen", async () => {
    const t = setup(row({ status: "angenommen" }));
    await expect(decideSuggestion({ suggestionId: "S1", decision: "reject" }, t.deps)).rejects.toThrow(/schon entschieden/);
  });
});

describe("change_step", () => {
  const s = () => row({ type: "change_step", payload: { projectId: 5, toStepId: 13, toKey: "materialbestellung", toLabel: "Materialbestellung" } });
  it("wechselt den Schritt", async () => {
    const t = setup(s());
    expect(await decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps)).toMatchObject({ status: "angenommen", stepId: 13 });
    expect(t.log.steps).toEqual([[5, 13]]);
  });
  it("Alternative aus der Liste ist erlaubt, eine fremde Schritt-ID nicht", async () => {
    const t = setup(s());
    await decideSuggestion({ suggestionId: "S1", decision: "accept", edits: { toStepId: 11 } }, t.deps);
    expect(t.log.steps).toEqual([[5, 11]]);
    const t2 = setup(s());
    await expect(decideSuggestion({ suggestionId: "S1", decision: "accept", edits: { toStepId: 2836 } }, t2.deps)).rejects.toThrow(/nicht als Ziel freigegeben/);
    expect(t2.log.steps).toEqual([]);
  });
});

describe("create_project", () => {
  const s = () => row({
    type: "create_project",
    payload: {
      contact: { first_name: "Max", last_name: "Muster", company: null, email: null, street: "Weg 1", zip: "71332", city: "Waiblingen" },
      project: { name: "Fahrzeugbeschriftung VW Crafter", gewerk: { short: "WER", measure_id: 6619 }, notes: "Sprinter" },
      request: { service: "Fahrzeugbeschriftung", quantity: "1" },
    },
  });
  it("legt Kontakt (findExisting) und Projekt an, protokolliert, haengt Mail und Thread ans Projekt", async () => {
    const t = setup(s());
    const r = await decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps);
    expect(r).toMatchObject({ status: "angenommen", contactId: 900, customerId: 901, projectId: 555, projectNr: "WER-555" });
    expect(t.log.contacts[0][0]).toMatchObject({ email: "kunde@x.de", last_name: "Muster" });
    expect(t.log.projects[0]).toMatchObject({ name: "Fahrzeugbeschriftung VW Crafter", customerId: 901, measureId: 6619, typeId: 181, stepId: 2825 });
    expect(t.log.logbook[0][0]).toBe(555);
    expect(t.log.logbook[0][1]).toContain("Anfrage: Fahrzeugbeschriftung · Menge: 1");
    expect(t.log.assigned[0].slice(0, 3)).toEqual(["M1", "T1", 555]);
    expect(t.log.dropped).toEqual(["kunde@x.de"]);
  });
  it("Pflichtangaben werden vor dem Anlegen geprueft – nichts landet halb in HERO", async () => {
    const bad = s(); bad.payload.contact.last_name = null;
    const t = setup(bad);
    await expect(decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps)).rejects.toThrow(/Nachname oder Firma/);
    expect(t.log.contacts).toEqual([]);
    expect(t.log.finished[0][1]).toBe("fehlgeschlagen");
    const t2 = setup(s());
    await expect(decideSuggestion({ suggestionId: "S1", decision: "accept", edits: { project: { name: "  " } } }, t2.deps)).rejects.toThrow(/Projektname/);
  });
  it("bearbeitete Felder aus der Mail-App gelten", async () => {
    const t = setup(s());
    await decideSuggestion({ suggestionId: "S1", decision: "accept", edits: { contact: { first_name: "Maxi", email: "neu@x.de" }, project: { name: "Anders" } } }, t.deps);
    expect(t.log.contacts[0][0]).toMatchObject({ first_name: "Maxi", last_name: "Muster", email: "neu@x.de" });
    expect(t.log.projects[0]).toMatchObject({ name: "Anders", measureId: 6619, notes: "Sprinter" });
  });
  it("scheitert das Projekt, bleibt der Vorschlag wiederholbar und der Kontakt wird nicht doppelt angelegt", async () => {
    const t = setup(s(), { hero: { createProject: async () => { throw new Error("InvalidPrimaryKeyException"); } } });
    await expect(decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps)).rejects.toThrow(/InvalidPrimaryKey/);
    expect(t.log.finished[0]).toEqual(["S1", "fehlgeschlagen", { error: "InvalidPrimaryKeyException" }]);
    expect(t.log.assigned).toEqual([]);
  });
  it("Nacharbeiten-Fehler nach dem Anlegen brechen NICHT ab (sonst gaebe es beim Wiederholen ein zweites Projekt)", async () => {
    const t = setup(s(), { hero: { addLogbook: async () => { throw new Error("Logbuch kaputt"); } } });
    const r: any = await decideSuggestion({ suggestionId: "S1", decision: "accept" }, t.deps);
    expect(r.projectId).toBe(555);
    expect(r.warnings[0]).toMatch(/Logbuch/);
    expect(t.log.finished[0][1]).toBe("angenommen");
  });
});
