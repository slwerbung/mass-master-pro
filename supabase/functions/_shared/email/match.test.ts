import { describe, expect, it } from "vitest";
import { buildPickRequest, contactAddresses, counterpart, matchMessage, normalizeCompany, PickSchema, type MatchDeps, type MatchInput } from "./match.ts";
import type { HeroContactHit, HeroProject } from "./hero.ts";

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
  it("3b. mit Hinweis/Absender-Wissen fragt auch ein einzelnes Projekt das Modell", async () => {
    const one = (pick: any) => deps({ contactsByEmail: async () => [{ id: 1, customerId: 7, name: "M", email: "x", isContactPerson: false }], openProjects: async () => [P(3, "WER-3")], pick: async () => pick });
    const g = input({ guidance: "Korrektur: gehoert zu keinem laufenden Projekt\n\n" });
    const none = await matchMessage(g, one({ projectId: null, confidence: 0.9, reason: "neues Thema" }));
    expect(none).toMatchObject({ method: null, projectId: null, knownContact: true });
    expect(none.candidates).toHaveLength(1);
    expect(await matchMessage(g, one({ projectId: 3, confidence: 0.8, reason: "" }))).toMatchObject({ method: "ki", projectId: 3 });
    // Ohne Hinweis bleibt es beim kostenlosen Weg.
    const d = one(null);
    expect(await matchMessage(input(), d)).toMatchObject({ method: "kontakt", projectId: 3 });
    expect(d.calls).not.toContain("pick");
  });
  it("Projektnummer aus der Korrektur geht Thread und Betreff vor", async () => {
    const d = deps({ threadProject: async () => 55, projectByNumber: async (rel) => (rel === 1820 ? P(18, "WER-1820") : rel === 5 ? P(5, "WER-5") : null) });
    const r = await matchMessage(input({ subject: "WER-5", correction: "Gehoert zu WER-1820 (Carport)" }), d);
    expect(r).toMatchObject({ method: "manuell", projectId: 18, certain: true });
    // ohne Nummer in der Korrektur bleibt der Thread vorn
    expect(await matchMessage(input({ correction: "falsches Projekt" }), d)).toMatchObject({ method: "thread", projectId: 55 });
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
  it("Hinweis steht vor den Kandidaten, allgemeines Wissen im Systemteil", () => {
    const r = buildPickRequest([P(3, "WER-3")], input({ guidance: "HINWEIS\n\n", knowledge: ["Carports laufen immer als eigenes Projekt"] }));
    expect(r.user.startsWith("HINWEIS")).toBe(true);
    expect(r.system[0].text).toContain("- Carports laufen immer als eigenes Projekt");
  });
  it("Schema toleriert Muell", () => {
    expect(PickSchema.parse({ project_id: "4", confidence: "x" })).toEqual({ project_id: 4, confidence: 0, reason: "" });
    expect(PickSchema.parse({ project_id: null, confidence: 1, reason: "r" }).project_id).toBeNull();
  });
});

describe("Kunde finden – nicht nur ueber die exakte Absenderadresse", () => {
  const hit = (id: number, customerId: number, email: string, company: string | null = null): HeroContactHit =>
    ({ id, customerId, name: company ?? email, email, isContactPerson: false, company });

  it("Formular-Mail (notifications@…): sucht mit der Kundenadresse aus der Mail", async () => {
    const asked: string[] = [];
    const d = deps({
      contactsByEmail: async (e) => (asked.push(e), e === "info@arslan-events.com" ? [hit(8, 8, e, "Arslan Event GmbH")] : []),
    });
    const r = await matchMessage(input({ from: "notifications@captfix.app", altEmails: ["Info@Arslan-Events.com"] }), d);
    expect(asked).toEqual(["notifications@captfix.app", "info@arslan-events.com"]);
    expect(r).toMatchObject({ knownContact: true, customer: { id: 8, via: "email" } });
    expect(r.reason).toContain("aus der Mail");
  });

  it("andere Adresse derselben Firma: Treffer ueber die Domain", async () => {
    const d = deps({ searchContacts: async (t) => (t === "bestcare.de" ? [hit(5, 5, "schneider@bestcare.de", "BestCare GmbH")] : []) });
    const r = await matchMessage(input({ from: "helmut.schneider@bestcare.de" }), d);
    expect(r).toMatchObject({ knownContact: true, customer: { id: 5, via: "domain", email: "schneider@bestcare.de" } });
  });

  it("Freemail-Domain wird nie als Firma gesucht, Firmenname schon", async () => {
    const terms: string[] = [];
    const d = deps({
      searchContacts: async (t) => (terms.push(t), t === "Müller Bau GmbH" ? [hit(9, 9, "x@mueller-bau.de", "Müller Bau")] : []),
    });
    const r = await matchMessage(input({ from: "max@gmx.de", company: "Müller Bau GmbH" }), d);
    expect(terms).toEqual(["Müller Bau GmbH"]);
    expect(r.customer).toMatchObject({ id: 9, via: "firma" });
  });

  it("unscharf nur bei genau einem Kunden; die eigene Firma zaehlt nie", async () => {
    const two = deps({ searchContacts: async () => [hit(1, 1, "a@firma.de"), hit(2, 2, "b@firma.de")] });
    expect((await matchMessage(input({ from: "c@firma.de" }), two)).knownContact).toBe(false);
    const own = deps({ searchContacts: async () => [hit(3, 3, "info@slwerbung.de", "SL WERBUNG")] });
    expect((await matchMessage(input({ from: "notifications@captfix.app", company: "SL WERBUNG" }), own)).knownContact).toBe(false);
  });

  it("Adressliste: eigene Adressen und Domain raus, keine Doppelten", () => {
    expect(contactAddresses(input({ altEmails: ["max@muster.de", "werner@slwerbung.de", "kunde@x.de"] }), ["info@slwerbung.de"]))
      .toEqual(["max@muster.de", "kunde@x.de"]);
    expect(normalizeCompany("Firma BestCare Intensivpflege GmbH")).toBe(normalizeCompany("BestCare Intensivpflege"));
  });
});
