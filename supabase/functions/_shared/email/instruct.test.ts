import { describe, expect, it } from "vitest";
import { berlinToIso, buildInstructionRequest, InstructionSchema, nextWorkday, runInstruction, toPlan, type InstructionContext, type RunDeps } from "./instruct";

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
      appointment: { category: "büro", date: null, time: null, duration_min: null, title: null }, not_doable: [], summary: "x",
    });
    const p = toPlan(r, ctx, "Anhänger Beschriftung");
    expect(p.project).toEqual({ mode: "new", name: "Anhänger Beschriftung", existingCustomer: { id: 4469248, name: "Firma Elektro Heinle" } });
    expect(p.offer).toBe(true);
    expect(p.appointment).toEqual({ categoryId: 32131, categoryLabel: "Büro", date: "2026-10-28", time: "09:00", durationMin: 30, title: "Büro: WG: Anhänger" });
  });
  it("bestehendes Projekt aus den Kandidaten; unbekannte Kategorie faellt auf Büro", () => {
    const r = InstructionSchema.parse({
      project: { action: "bestehend", project_nr: "wer-1270", name: null }, offer: false,
      appointment: { category: "Gibtsnicht", date: "2026-11-03", time: "14:30", duration_min: 60, title: "Rückruf" }, not_doable: ["Mail senden"], summary: "",
    });
    const p = toPlan(r, ctx, "");
    expect(p.project).toEqual({ mode: "link", projectNr: "WER-1270", projectId: 6620478 });
    expect(p.appointment).toMatchObject({ categoryId: 32131, date: "2026-11-03", time: "14:30", durationMin: 60, title: "Rückruf" });
    expect(p.notDoable).toEqual(["Mail senden"]);
  });
  it("kaputte Modellantwort -> nichts tun", () => {
    const p = toPlan(InstructionSchema.parse({}), ctx, "");
    expect(p).toMatchObject({ project: { mode: "keep" }, offer: false, appointment: null });
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
  project: { mode: "new" as const, name: "Anhänger", existingCustomer: { id: 1, name: "K" } }, offer: true,
  appointment: { categoryId: 32131, categoryLabel: "Büro", date: "2026-10-28", time: "09:00", durationMin: 30, title: "Büro: Anhänger" },
  notDoable: [], summary: "",
};

describe("runInstruction", () => {
  it("legt Projekt an, dann Angebot im neuen Projekt, dann Termin am Projekt", async () => {
    const t = deps();
    const r = await runInstruction(plan, "Neues Projekt, Angebot, Büro morgen", t.d);
    expect(r.map((x) => [x.step, x.ok])).toEqual([["project", true], ["offer", true], ["appointment", true]]);
    expect(t.log.decided[0]).toEqual(["S-create_project", { project: { name: "Anhänger" }, useExisting: true }]);
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
    const r = await runInstruction({ ...plan, project: { mode: "link", projectNr: "WER-9", projectId: null }, offer: false, appointment: null }, "x", t.d);
    expect(r).toEqual([{ step: "project", ok: true, text: "Zu WER-1270 zugeordnet und ins Logbuch geschrieben" }]);
    expect(t.log.ensured[0]).toEqual(["link_project", { projectId: 9, manual: true }]);
  });
});
