import { describe, expect, it } from "vitest";
import { berlinToIso, buildInstructionRequest, defaultSubfolder, findPerson, InstructionSchema, matchSubfolder, nextWorkday, resolveCustomer, runInstruction, toPlan, type InstructionContext, type RunDeps } from "./instruct";

const ctx: InstructionContext = {
  subject: "WG: Anhänger", summary: "Anfrage Beschriftung Anhänger", fromName: "Peter Heinle", projectNr: null,
  candidates: [{ id: 6620478, nr: "WER-1270", name: "Werbestele" }], existingCustomer: { id: 4469248, name: "Firma Elektro Heinle" },
  categories: [{ id: 32131, label: "Büro" }, { id: 13649, label: "Vor-Ort-Termin" }], today: "2026-10-27",
};

describe("Termin-Hilfen", () => {
  it("naechster Werktag springt ueber das Wochenende", () => {
    expect(nextWorkday("2026-10-27")).toBe("2026-10-28"); // Di -> Mi
    expect(nextWorkday("2026-10-30")).toBe("2026-11-02"); // Fr -> Mo
  });
  it("Berliner Uhrzeit -> echter Zeitpunkt (Sommer- und Winterzeit)", () => {
    expect(berlinToIso("2026-10-28", "09:00")).toBe("2026-10-28T08:00:00.000Z");
    expect(berlinToIso("2026-07-01", "14:00")).toBe("2026-07-01T12:00:00.000Z");
  });
  it("Prompt nennt Wochentag und Kategorien, die Anweisung steht getrennt von der Mail", () => {
    const r = buildInstructionRequest("Büro-Termin morgen", ctx);
    expect(r.system[0].text).toContain("Dienstag, 2026-10-27");
    expect(r.system[0].text).toContain("Büro, Vor-Ort-Termin");
    expect(r.user).toContain("<anweisung>\nBüro-Termin morgen\n</anweisung>");
  });
});

describe("toPlan", () => {
  it("neues Projekt beim bekannten Kunden, Angebot, Büro-Termin mit Voreinstellungen", () => {
    const r = InstructionSchema.parse({
      project: { action: "neu", project_nr: null, name: null }, offer: true,
      appointments: [{ category: "büro", date: null, time: null, duration_min: null, title: null, person: null }], not_doable: [], summary: "x",
    });
    const p = toPlan(r, ctx, "Anhänger Beschriftung");
    expect(p.project).toEqual({ mode: "new", name: "Anhänger Beschriftung", existingCustomer: { id: 4469248, name: "Firma Elektro Heinle" }, requireExisting: false, customerOptions: [] });
    expect(p.offer).toBe(true);
    expect(p.appointments).toEqual([{ categoryId: 32131, categoryLabel: "Büro", date: "2026-10-28", time: "09:00", durationMin: 30, title: "Büro: WG: Anhänger", partnerId: null, partnerName: null }]);
  });
  it("bestehendes Projekt aus den Kandidaten; unbekannte Kategorie faellt auf Büro", () => {
    const r = InstructionSchema.parse({
      project: { action: "bestehend", project_nr: "wer-1270", name: null }, offer: false,
      appointments: [{ category: "Gibtsnicht", date: "2026-11-03", time: "14:30", duration_min: 60, title: "Rückruf" }], not_doable: ["Mail senden"], summary: "",
    });
    const p = toPlan(r, ctx, "");
    expect(p.project).toEqual({ mode: "link", projectNr: "WER-1270", projectId: 6620478 });
    expect(p.appointments[0]).toMatchObject({ categoryId: 32131, date: "2026-11-03", time: "14:30", durationMin: 60, title: "Rückruf" });
    expect(p.notDoable).toEqual(["Mail senden"]);
  });
  it("kaputte Modellantwort -> nichts tun", () => {
    const p = toPlan(InstructionSchema.parse({}), ctx, "");
    expect(p).toMatchObject({ project: { mode: "keep" }, offer: false, appointments: [] });
  });
});

function deps(o: { failProject?: boolean; noOffer?: boolean; current?: { id: number; nr: string } | null } = {}) {
  const log: any = { ensured: [], decided: [], appts: [], finished: null };
  let current = o.current ?? null;
  const d: RunDeps = {
    ensureSuggestion: async (type, extra) => (log.ensured.push([type, extra]), type === "prepare_offer" && o.noOffer ? null : `S-${type}`),
    decide: async (id, edits) => {
      log.decided.push([id, edits]);
      if (id === "S-create_project") {
        if (o.failProject) throw new Error("HERO 500");
        current = { id: 555, nr: "WER-555" };
        return { projectId: 555, projectNr: "WER-555" };
      }
      if (id === "S-prepare_offer") return { documentId: 88, positions: 2, warnings: ["1 Position ohne Leistung"] };
      return { projectNr: "WER-1270", logged: true };
    },
    currentProject: async () => current,
    projectByNr: async (nr) => (nr === "WER-9" ? { id: 9, nr } : null),
    createAppointment: async (a) => (log.appts.push(a), { id: 77 }),
    finish: async (note) => { log.finished = note; },
  };
  return { d, log };
}

const plan = {
  project: { mode: "new" as const, name: "Anhänger", existingCustomer: { id: 1, name: "K" }, requireExisting: false, customerOptions: [] }, offer: true,
  appointments: [{ categoryId: 32131, categoryLabel: "Büro", date: "2026-10-28", time: "09:00", durationMin: 30, title: "Büro: Anhänger", partnerId: null, partnerName: null }],
  notDoable: [], summary: "",
};

describe("runInstruction", () => {
  it("legt Projekt an, dann Angebot im neuen Projekt, dann Termin am Projekt", async () => {
    const t = deps();
    const r = await runInstruction(plan, "Neues Projekt, Angebot, Büro morgen", t.d);
    expect(r.map((x) => [x.step, x.ok])).toEqual([["project", true], ["offer", true], ["appointment", true]]);
    expect(t.log.decided[0]).toEqual(["S-create_project", { project: { name: "Anhänger" }, useExisting: true, existingCustomer: { id: 1, name: "K" } }]);
    expect(t.log.decided[1]).toEqual(["S-prepare_offer", { projectId: 555, projectNr: "WER-555", kind: "angebot" }]);
    expect(r[1].text).toContain("Hinweis: 1 Position ohne Leistung");
    expect(t.log.appts[0]).toMatchObject({ projectId: 555, categoryId: 32131, startIso: "2026-10-28T08:00:00.000Z", endIso: "2026-10-28T08:30:00.000Z" });
    expect(t.log.finished).toContain("✓ Projekt WER-555");
  });
  it("scheitert das Projekt, gibt es kein Angebot – der Termin entsteht trotzdem (ohne Projekt)", async () => {
    const t = deps({ failProject: true });
    const r = await runInstruction(plan, "x", t.d);
    expect(r.map((x) => [x.step, x.ok])).toEqual([["project", false], ["offer", false], ["appointment", true]]);
    expect(t.log.appts[0].projectId).toBeNull();
  });
  it("Zuordnung ueber eine Projektnummer ausserhalb der Kandidaten", async () => {
    const t = deps();
    const r = await runInstruction({ ...plan, project: { mode: "link", projectNr: "WER-9", projectId: null }, offer: false, appointments: [] }, "x", t.d);
    expect(r).toEqual([{ step: "project", ok: true, text: "Zu WER-1270 zugeordnet und ins Logbuch geschrieben" }]);
    expect(t.log.ensured[0]).toEqual(["link_project", { projectId: 9, manual: true }]);
  });
});

describe("„Den Kontakt gibt es schon“", () => {
  const unknown = { ...ctx, existingCustomer: null };
  const said = InstructionSchema.parse({
    project: { action: "neu", project_nr: null, name: "Weihnachtsgeschenke 26" }, contact: "vorhanden", customer_hint: "VfR Birkmannsweiler",
    offer: false, appointments: [], not_doable: [], summary: "",
  });
  const lookup = (hits: Record<string, { id: number; name: string }[]>) => {
    const asked: string[] = [];
    return { asked, search: async (t: string) => (asked.push(t), hits[t] ?? []) };
  };

  it("die Anweisung wird erkannt und im Plan festgehalten", () => {
    expect(toPlan(said, unknown, "").project).toMatchObject({ mode: "new", existingCustomer: null, requireExisting: true });
    expect(buildInstructionRequest("x", ctx).system[0].text).toContain("contact: „vorhanden“");
  });
  it("genau ein Kunde gefunden -> der wird genommen (Name aus der Anweisung zuerst)", async () => {
    const l = lookup({ "VfR Birkmannsweiler": [{ id: 1302092, name: "Firma VfR Birkmannsweiler e.V." }] });
    const p = await resolveCustomer(toPlan(said, unknown, ""), said.customer_hint, ["vfr-bmw.de"], l);
    expect(p.project).toMatchObject({ existingCustomer: { id: 1302092 }, customerOptions: [] });
    expect(l.asked).toEqual(["VfR Birkmannsweiler"]);
  });
  it("mehrere Kunden -> Auswahl, nichts vorgewaehlt", async () => {
    const l = lookup({ "vfr-bmw.de": [{ id: 1302092, name: "A" }, { id: 8286198, name: "B" }] });
    const p = await resolveCustomer(toPlan(said, unknown, ""), null, ["", "vfr-bmw.de"], l);
    expect(p.project).toMatchObject({ existingCustomer: null, customerOptions: [{ id: 1302092 }, { id: 8286198 }] });
  });
  it("kein Kunde gefunden -> Hinweis, und Ausfuehren legt NICHTS an (kein neuer Kontakt)", async () => {
    const p = await resolveCustomer(toPlan(said, unknown, ""), said.customer_hint, [], lookup({}));
    expect(p.notDoable.join()).toContain("kein neuer Kontakt");
    const t = deps();
    const r = await runInstruction({ ...p, appointments: [] }, "x", t.d);
    expect(r).toEqual([expect.objectContaining({ step: "project", ok: false })]);
    expect(t.log.ensured).toEqual([]);
    expect(t.log.decided).toEqual([]);
  });
  it("ohne diese Aussage wird nicht gesucht", async () => {
    const r = InstructionSchema.parse({ ...said, contact: "unklar" });
    const l = lookup({ "VfR Birkmannsweiler": [{ id: 1, name: "X" }] });
    const p = await resolveCustomer(toPlan(r, unknown, ""), r.customer_hint, [], l);
    expect(p.project).toMatchObject({ existingCustomer: null, requireExisting: false });
    expect(l.asked).toEqual([]);
  });
});

describe("Mehrere Termine mit Mitarbeiter (Weihnachtsbanner aufhängen + abhängen)", () => {
  const people = [{ id: 33288, name: "Jens Langner" }, { id: 33287, name: "Silas Layer" }];
  const cats = [...ctx.categories, { id: 74899, label: "Montage vor Ort" }];
  const c = { ...ctx, categories: cats, people, projectNr: "WER-1949", bodyText: "bitte vom 13. – 30.11. einplanen" };
  const r = InstructionSchema.parse({
    project: { action: "bestehend", project_nr: "wer-1949", name: null }, offer: false,
    appointments: [
      { category: "Montage vor Ort", date: "2026-11-13", time: null, duration_min: null, title: "Weihnachtsbanner aufhängen", person: "jens Langner" },
      { category: "Montage vor Ort", date: "2026-11-30", time: null, duration_min: null, title: "Weihnachtsbanner abhängen", person: "jens" },
    ],
    not_doable: [], summary: "",
  });

  it("zwei Termine, beide Jens zugewiesen; schon zugeordnetes Projekt bleibt", () => {
    const p = toPlan(r, c, "");
    expect(p.project).toEqual({ mode: "keep" });
    expect(p.appointments.map((a) => [a.date, a.time, a.durationMin, a.categoryId, a.partnerId])).toEqual([
      ["2026-11-13", "08:00", 240, 74899, 33288], ["2026-11-30", "08:00", 240, 74899, 33288],
    ]);
    expect(p.notDoable).toEqual([]);
  });
  it("Prompt kennt Mitarbeiter, Mailtext und die Zeitraum-Regel", () => {
    const req = buildInstructionRequest("x", c);
    expect(req.system[0].text).toContain("Mitarbeiter: Jens Langner, Silas Layer");
    expect(req.system[0].text).toContain("am ERSTEN Tag");
    expect(req.user).toContain("13. – 30.11.");
  });
  it("findPerson nur bei eindeutigem Treffer", () => {
    expect(findPerson("Langner", people)?.id).toBe(33288);
    expect(findPerson("silas", people)?.id).toBe(33287);
    expect(findPerson("Max", people)).toBeNull();
    expect(findPerson("", people)).toBeNull();
  });
  it("unbekannter Mitarbeiter -> Termin ohne Zuweisung + Hinweis", () => {
    const x = InstructionSchema.parse({ ...r, appointments: [{ ...r.appointments[0], person: "Kai" }] });
    const p = toPlan(x, c, "");
    expect(p.appointments[0].partnerId).toBeNull();
    expect(p.notDoable[0]).toContain("Kai");
  });
  it("Ausführen legt jeden Termin mit Mitarbeiter an", async () => {
    const t = deps({ current: { id: 1949, nr: "WER-1949" } });
    const out = await runInstruction(toPlan(r, c, ""), "x", t.d);
    expect(out.map((o) => o.ok)).toEqual([true, true]);
    expect(t.log.appts.map((a: any) => [a.projectId, a.partnerId, a.startIso])).toEqual([
      [1949, 33288, "2026-11-13T07:00:00.000Z"], [1949, 33288, "2026-11-30T07:00:00.000Z"],
    ]);
    expect(out[0].text).toContain("für Jens Langner");
  });
});

describe("Weitere HERO-Aktionen im Plan", () => {
  it("Ansprechpartner + Status kommen in den Plan und laufen nach dem Projekt, vor dem Angebot", async () => {
    const c = { ...ctx, people: [{ id: 33288, name: "Jens Langner", userId: 184738 }], ops: { contacts: [{ id: 1, name: "Firma X", email: "", isCustomer: true }], steps: [{ id: 266648, name: "⏳ Warten auf Auftrag" }], sender: "a@x.de" } };
    const r = InstructionSchema.parse({
      project: { action: "unveraendert" }, offer: true, appointments: [], not_doable: [], summary: "",
      actions: [
        { op: "ansprechpartner_anlegen", last_name: "Muster", email: "m@x.de" },
        { op: "status_setzen", step: "Warten auf Auftrag" },
        { op: "gibtsnicht" },
      ],
    });
    const p = toPlan(r, c, "");
    expect(p.ops.map((o) => o.op)).toEqual(["ansprechpartner_anlegen", "status_setzen"]);
    expect(buildInstructionRequest("x", c).system[0].text).toContain("ansprechpartner_anlegen");
    const t = deps({ current: { id: 5, nr: "WER-5" } });
    const order: string[] = [];
    t.d.heroOp = async (o) => (order.push(o.op), `ok ${o.op}`);
    const decide = t.d.decide;
    t.d.decide = async (id, e) => (order.push(id), decide(id, e));
    const out = await runInstruction({ ...p, appointments: [] }, "x", t.d);
    expect(order).toEqual(["ansprechpartner_anlegen", "status_setzen", "S-prepare_offer"]);
    expect(out.map((o) => o.step)).toEqual(["hero", "hero", "offer"]);
  });
});

describe("Anhänge in HERO und Dropbox", () => {
  const subs = ["01 Gelieferte Daten", "02 Produktion/Druckdaten", "03 Layouts"];
  const c = { ...ctx, dropboxSubfolders: subs, attachmentCount: 2, dropboxEnabled: true };
  const base = { project: { action: "unveraendert" }, offer: false, appointments: [], actions: [], not_doable: [], summary: "" };

  it("Unterordner: genannt (auch ohne Nummer) oder „Gelieferte Daten“", () => {
    expect(defaultSubfolder(subs)).toBe("01 Gelieferte Daten");
    expect(defaultSubfolder(["Daten", "Layout"])).toBe("Daten");
    expect(matchSubfolder("Druckdaten", subs)).toBe("02 Produktion/Druckdaten");
    expect(matchSubfolder("03 layouts", subs)).toBe("03 Layouts");
    expect(matchSubfolder("Rechnungen", subs)).toBeNull();
  });

  it("„in HERO und Dropbox hochladen“ -> beides, Standard-Unterordner; Prompt kennt die Ordner", () => {
    const p = toPlan(InstructionSchema.parse({ ...base, files: { hero: true, dropbox: true, subfolder: null } }), c, "");
    expect(p.files).toEqual({ hero: true, dropbox: true, subfolder: "01 Gelieferte Daten" });
    expect(buildInstructionRequest("x", c).system[0].text).toContain("Dropbox-Unterordner: 01 Gelieferte Daten, 02 Produktion/Druckdaten");
    const q = toPlan(InstructionSchema.parse({ ...base, files: { hero: false, dropbox: true, subfolder: "Ablage" } }), c, "");
    expect(q.files?.subfolder).toBe("01 Gelieferte Daten");
    expect(q.notDoable.join()).toContain("Ablage");
  });

  it("ohne Anhänge oder ohne Dropbox-Anbindung: nichts davon, mit Hinweis", () => {
    const p = toPlan(InstructionSchema.parse({ ...base, files: { hero: true, dropbox: true, subfolder: null } }), { ...c, attachmentCount: 0 }, "");
    expect(p.files).toMatchObject({ hero: false, dropbox: false });
    expect(p.notDoable.join()).toContain("keine gespeicherten Anhänge");
    const q = toPlan(InstructionSchema.parse({ ...base, files: { hero: true, dropbox: true, subfolder: null } }), { ...c, dropboxEnabled: false }, "");
    expect(q.files).toMatchObject({ hero: true, dropbox: false });
  });

  it("Ausführen: nach dem Projekt, HERO und Dropbox einzeln; ohne Projekt nichts", async () => {
    const p = toPlan(InstructionSchema.parse({ ...base, files: { hero: true, dropbox: true, subfolder: "Druckdaten" } }), c, "");
    const t = deps({ current: { id: 5, nr: "WER-5" } });
    const calls: string[] = [];
    t.d.uploadToHero = async (pr) => (calls.push(`hero ${pr.nr}`), "2 hochgeladen");
    t.d.saveToDropbox = async (sf) => { calls.push(`dbx ${sf}`); throw new Error("Dropbox weg"); };
    const out = await runInstruction(p, "x", t.d);
    expect(calls).toEqual(["hero WER-5", "dbx 02 Produktion/Druckdaten"]);
    expect(out.filter((o) => o.step === "files").map((o) => o.ok)).toEqual([true, false]);
    const none = deps({ current: null });
    none.d.uploadToHero = async () => "nie";
    const o2 = await runInstruction(p, "x", none.d);
    expect(o2.filter((o) => o.step === "files").every((o) => !o.ok && /kein Projekt/.test(o.text))).toBe(true);
  });
});

describe("Thema per Anweisung", () => {
  it("Wiedervorlage mit Datum und Notiz; ohne Datum eine Woche + Hinweis", () => {
    const base = { project: { action: "unveraendert" }, offer: false, appointments: [], actions: [], not_doable: [], summary: "" };
    const p = toPlan(InstructionSchema.parse({ ...base, topic: { action: "wiedervorlage", date: "2026-11-10", note: "Freigabe da?" } }), ctx, "");
    expect(p.topic).toEqual({ mode: "wiedervorlage", date: "2026-11-10", note: "Freigabe da?" });
    const q = toPlan(InstructionSchema.parse({ ...base, topic: { action: "wiedervorlage", date: null, note: null } }), ctx, "");
    expect(q.topic.date).toBe("2026-11-03");
    expect(q.notDoable.join()).toContain("Wiedervorlage");
    expect(toPlan(InstructionSchema.parse(base), ctx, "").topic.mode).toBe("keine");
    expect(buildInstructionRequest("x", ctx).system[0].text).toContain("wiedervorlage");
  });

  it("das Thema wird zuletzt entschieden – auch ohne Angabe (weiter verfolgen)", async () => {
    const t = deps({ current: { id: 5, nr: "WER-5" } });
    const seen: string[] = [];
    t.d.topic = async (x) => (seen.push(x.mode), x.mode === "erledigt" ? "Thema abgeschlossen" : null);
    const out = await runInstruction({ project: { mode: "keep" }, offer: false, appointments: [], ops: [], notDoable: [], summary: "", topic: { mode: "erledigt", date: null, note: null } }, "x", t.d);
    expect(out).toEqual([{ step: "topic", ok: true, text: "Thema abgeschlossen" }]);
    await runInstruction({ ...plan, ops: [], appointments: [], offer: false, project: { mode: "keep" } } as any, "x", t.d);
    expect(seen).toEqual(["erledigt", "keine"]);
  });
});
