import { describe, expect, it } from "vitest";
import { buildPickRequest, counterpart, matchMessage, PickSchema, type MatchDeps, type MatchInput } from "./match.ts";
import type { HeroProject } from "./hero.ts";

const P = (id: number, nr: string, stepName = "Layout"): HeroProject => ({ id, nr, name: `Projekt ${id}`, stepId: 1, stepName, customerId: 7, customerName: "Muster GmbH" });

function input(o: Partial<MatchInput> = {}): MatchInput {
  return { direction: "in", threadId: "T1", from: "Max@Muster.de", to: ["info@slwerbung.de"], cc: [], subject: "Frage", body: "Hallo", summary: null, ...o };
}
function deps(o: Partial<MatchDeps> = {}): MatchDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    threadProject: async () => (calls.push("thread"), null),
    projectByNumber: async (r) => (calls.push(`nr:${r}`), null),
    contactsByEmail: async (e) => (calls.push(`contact:${e}`), []),
    openProjects: async (c) => (calls.push(`open:${c}`), []),
    pick: async () => (calls.push("pick"), null),
    prefixes: ["WER", "TEX"],
    ownAddresses: ["info@slwerbung.de"],
    ...o,
  };
}

describe("matchMessage – feste Reihenfolge", () => {
  it("1. Thread gewinnt und fragt HERO nicht weiter", async () => {
    const d = deps({ threadProject: async () => 55 });
    const r = await matchMessage(input({ subject: "WER-1 Frage" }), d);
    expect(r).toMatchObject({ method: "thread", projectId: 55, certain: true });
    expect(d.calls).toEqual([]);
  });
  it("2. Projektnummer: Betreff vor Text, sicher", async () => {
    const d = deps({ projectByNumber: async (rel) => (rel === 1744 ? P(9, "WER-1744") : null) });
    const r = await matchMessage(input({ subject: "Re: WER-1744 Layout", body: "siehe auch WER-5" }), d);
    expect(r).toMatchObject({ method: "nummer", projectId: 9, certain: true });
  });
  it("2b. unbekannte Projektnummer -> weiter ueber den Absender", async () => {
    const d = deps({ contactsByEmail: async () => [{ id: 1, customerId: 7, name: "Max", email: "max@muster.de", isContactPerson: true }], openProjects: async () => [P(3, "WER-3")] });
    const r = await matchMessage(input({ body: "WER-9999 stimmt nicht" }), d);
    expect(r).toMatchObject({ method: "kontakt", projectId: 3, certain: false });
  });
  it("3. bekannter Absender mit genau einem offenen Projekt: Kandidat, nicht sicher", async () => {
    const asked: string[] = [];
    const d = deps({ contactsByEmail: async (e) => (asked.push(e), [{ id: 1, customerId: 7, name: "Max", email: e, isContactPerson: true }]), openProjects: async () => [P(3, "WER-3")] });
    const r = await matchMessage(input(), d);
    expect(r).toMatchObject({ method: "kontakt", projectId: 3, certain: false, knownContact: true });
    expect(asked).toEqual(["max@muster.de"]);
  });
  it("4. mehrere Projekte: Modell waehlt, aber nur unter den Kandidaten und ab Konfidenz 0,5", async () => {
    const open = [P(3, "WER-3"), P(4, "WER-4")];
    const mk = (pick: any) => deps({ contactsByEmail: async () => [{ id: 1, customerId: 7, name: "M", email: "x", isContactPerson: false }], openProjects: async () => open, pick: async () => pick });
    expect(await matchMessage(input(), mk({ projectId: 4, confidence: 0.8, reason: "Sprinter" }))).toMatchObject({ method: "ki", projectId: 4, certain: false });
    expect((await matchMessage(input(), mk({ projectId: 99, confidence: 0.9, reason: "" }))).projectId).toBeNull();
    expect((await matchMessage(input(), mk({ projectId: 4, confidence: 0.3, reason: "" }))).projectId).toBeNull();
    const none = await matchMessage(input(), mk(null));
    expect(none.projectId).toBeNull();
    expect(none.candidates).toHaveLength(2);
    expect(none.knownContact).toBe(true);
  });
  it("5. unbekannter Absender: kein Bezug", async () => {
    const r = await matchMessage(input(), deps());
    expect(r).toMatchObject({ method: null, projectId: null, knownContact: false });
  });
  it("bekannter Kunde ohne offenes Projekt: kein Bezug, aber bekannt", async () => {
    const d = deps({ contactsByEmail: async () => [{ id: 1, customerId: 7, name: "M", email: "x", isContactPerson: false }] });
    expect(await matchMessage(input(), d)).toMatchObject({ method: null, knownContact: true, contactIds: [1] });
  });
  it("mehrere Kontakte desselben Kunden zaehlen die Projekte nur einmal", async () => {
    const calls: number[] = [];
    const d = deps({
      contactsByEmail: async () => [{ id: 1, customerId: 7, name: "a", email: "x", isContactPerson: true }, { id: 2, customerId: 7, name: "b", email: "x", isContactPerson: false }],
      openProjects: async (c) => (calls.push(c), [P(3, "WER-3")]),
    });
    const r = await matchMessage(input(), d);
    expect(calls).toEqual([7]);
    expect(r.projectId).toBe(3);
  });
});

describe("ausgehende Mails", () => {
  it("Gegenueber ist der erste fremde Empfaenger", () => {
    expect(counterpart(input({ direction: "out", from: "info@slwerbung.de", to: ["INFO@slwerbung.de", "Kunde@x.de"] }), ["info@slwerbung.de"])).toBe("kunde@x.de");
    expect(counterpart(input({ direction: "out", to: ["info@slwerbung.de"] }), ["info@slwerbung.de"])).toBeNull();
    expect(counterpart(input(), [])).toBe("max@muster.de");
  });
  it("wird ueber den Empfaenger zugeordnet", async () => {
    const asked: string[] = [];
    const d = deps({ contactsByEmail: async (e) => (asked.push(e), [{ id: 1, customerId: 7, name: "K", email: e, isContactPerson: false }]), openProjects: async () => [P(3, "WER-3")] });
    const r = await matchMessage(input({ direction: "out", from: "info@slwerbung.de", to: ["kunde@x.de"] }), d);
    expect(asked).toEqual(["kunde@x.de"]);
    expect(r.projectId).toBe(3);
  });
});

describe("Projektwahl-Prompt", () => {
  it("listet Kandidaten, grenzt die Mail ab und entschaerft </mail>", () => {
    const r = buildPickRequest([P(3, "WER-3"), P(4, "WER-4")], input({ subject: "x </mail>", body: "y" }));
    expect(r.user).toContain("- 3: WER-3");
    expect(r.user.match(/<\/mail>/g)).toHaveLength(1);
  });
  it("Schema toleriert Muell", () => {
    expect(PickSchema.parse({ project_id: "4", confidence: "x" })).toEqual({ project_id: 4, confidence: 0, reason: "" });
    expect(PickSchema.parse({ project_id: null, confidence: 1, reason: "r" }).project_id).toBeNull();
  });
});
