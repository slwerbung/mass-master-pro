import { describe, expect, it } from "vitest";
import { ActionSchema, describeOp, findContact, findStep, runOp, sanitizeOps, toOps, type HeroOpsApi, type OpContext } from "./heroOps";

const ctx: OpContext = {
  people: [{ id: 33288, name: "Jens Langner", userId: 184738 }, { id: 33287, name: "Silas Layer", userId: 184737 }],
  contacts: [
    { id: 1302092, name: "Firma VfR Birkmannsweiler e.V.", email: "", isCustomer: true },
    { id: 2460033, name: "Frau Alina Klöpfer", email: "a.kloepfer@vfr-bmw.de", isCustomer: false },
    { id: 3103094, name: "Herr Philip Lagelstorfer", email: "p.lagelstorfer@vfr-bmw.de", isCustomer: false },
    { id: 3104584, name: "Herr Kurt Lagelstorfer", email: "kl6@gmx.de", isCustomer: false },
  ],
  steps: [{ id: 2825, name: "📬Anfragen" }, { id: 266511, name: "📄 Angeboterstellung" }, { id: 266648, name: "⏳ Warten auf Auftrag" }],
  sender: "a.kloepfer@vfr-bmw.de",
};
const act = (x: Record<string, unknown>) => ActionSchema.parse({
  contact: null, salutation: null, first_name: null, last_name: null, email: null, phone: null, mobile: null, position: null, street: null,
  zip: null, city: null, label: null, project_name: null, note: null, person: null, step: null, title: null, due_date: null, ...x,
});

describe("toOps – Namen werden zu HERO-IDs", () => {
  it("Kontakt über Name, E-Mail, „Absender“ und „Kunde“; mehrdeutig = keiner", () => {
    expect(findContact("Frau Klöpfer", ctx)?.id).toBe(2460033);
    expect(findContact("p.lagelstorfer@vfr-bmw.de", ctx)?.id).toBe(3103094);
    expect(findContact("Absender", ctx)?.id).toBe(2460033);
    expect(findContact("Kunde", ctx)?.id).toBe(1302092);
    expect(findContact("Lagelstorfer", ctx)).toBeNull();
  });
  it("Schritt über den Namen ohne Emojis", () => {
    expect(findStep("Warten auf Auftrag", ctx.steps)?.id).toBe(266648);
    expect(findStep("angeboterstellung", ctx.steps)?.id).toBe(266511);
    expect(findStep("Gibtsnicht", ctx.steps)).toBeNull();
  });
  it("mehrere Aktionen; nicht Auflösbares landet in notDoable", () => {
    const r = toOps([
      act({ op: "ansprechpartner_anlegen", salutation: "Herr", first_name: "Max", last_name: "Muster", email: "max@vfr-bmw.de", phone: "07195 123" }),
      act({ op: "kontakt_aendern", phone: "0171 999" }),
      act({ op: "status_setzen", step: "Warten auf Auftrag" }),
      act({ op: "aufgabe_anlegen", title: "Banner bestellen", person: "jens", due_date: "2026-11-05" }),
      act({ op: "mitarbeiter_zuweisen", person: "Kai" }),
      act({ op: "ansprechpartner_anlegen", first_name: "Ohne" }),
      act({ op: "kontakt_aendern", contact: "Fremder", phone: "1" }),
    ], ctx);
    expect(r.ops.map((o) => [o.op, o.contactId, o.userId, o.stepId])).toEqual([
      ["ansprechpartner_anlegen", null, null, null], ["kontakt_aendern", 2460033, null, null], ["status_setzen", null, null, 266648],
      ["aufgabe_anlegen", null, 184738, null], ["mitarbeiter_zuweisen", null, null, null],
    ]);
    expect(r.notDoable).toHaveLength(3);
    expect(r.notDoable.join(" ")).toContain("Kai");
    expect(r.notDoable.join(" ")).toContain("Nachname oder E-Mail fehlt");
    expect(describeOp(r.ops[0])).toBe("Ansprechpartner Herr Max Muster anlegen (E-Mail max@vfr-bmw.de, Telefon 07195 123)");
  });
});

function api(contacts = ctx.contacts) {
  const calls: any[] = [];
  const a: HeroOpsApi = {
    customerContacts: async () => contacts,
    createContactPerson: async (id, c) => (calls.push(["createContactPerson", id, c]), 1),
    updateContact: async (id, p) => { calls.push(["updateContact", id, p]); },
    createCustomerAddress: async (id, t, ad) => (calls.push(["createCustomerAddress", id, t, ad]), 2),
    updateProject: async (id, p) => { calls.push(["updateProject", id, p]); },
    assignUsers: async (id, u) => { calls.push(["assignUsers", id, u]); },
    createTask: async (t) => (calls.push(["createTask", t]), 3),
    addLogbook: async (id, t) => { calls.push(["addLogbook", id, t]); },
  };
  return { a, calls };
}
const t = { projectId: 12503890, customerId: 1302092, allowedUserIds: [184737, 184738], allowedStepIds: [2825, 266648] };
const op = (x: any) => sanitizeOps([{ fields: {}, ...x }])[0];

describe("runOp – schreibt nur Geprüftes", () => {
  it("Ansprechpartner: neu beim Kunden, als Ansprechpartner; gleiche E-Mail = nicht doppelt", async () => {
    const { a, calls } = api();
    await runOp(op({ op: "ansprechpartner_anlegen", fields: { first_name: "Max", last_name: "Muster", email: "max@x.de", phone: "1" } }), t, a);
    expect(calls).toEqual([["createContactPerson", 1302092, { title: null, first_name: "Max", last_name: "Muster", email: "max@x.de", phone_home: "1", phone_mobile: null, position: null }]]);
    const r = await runOp(op({ op: "ansprechpartner_anlegen", fields: { last_name: "K", email: "A.Kloepfer@vfr-bmw.de" } }), t, a);
    expect(r).toContain("gibt es beim Kunden schon");
    expect(calls).toHaveLength(1);
  });
  it("Kontakt ändern nur, wenn er zum Kunden gehört", async () => {
    const { a, calls } = api();
    await runOp(op({ op: "kontakt_aendern", contactId: 2460033, fields: { phone: "0171", city: "Winnenden", street: "Talaue 25" } }), t, a);
    expect(calls[0]).toEqual(["updateContact", 2460033, { phone_home: "0171", address: { street: "Talaue 25", zipcode: "", city: "Winnenden" } }]);
    await expect(runOp(op({ op: "kontakt_aendern", contactId: 999, fields: { phone: "1" } }), t, a)).rejects.toThrow("gehört nicht");
  });
  it("Status nur auf Schritte des Ablaufs, Zuweisung nur bekannte Mitarbeiter, ohne Projekt nichts", async () => {
    const { a, calls } = api();
    await runOp(op({ op: "status_setzen", stepId: 266648, stepName: "Warten" }), t, a);
    await expect(runOp(op({ op: "status_setzen", stepId: 1, stepName: "x" }), t, a)).rejects.toThrow("Projektablauf");
    await runOp(op({ op: "mitarbeiter_zuweisen", userId: 184738 }), t, a);
    await expect(runOp(op({ op: "mitarbeiter_zuweisen", userId: null }), t, a)).rejects.toThrow("Mitarbeiter");
    await expect(runOp(op({ op: "logbuch_notiz", fields: { note: "x" } }), { ...t, projectId: null }, a)).rejects.toThrow("kein Projekt");
    expect(calls).toEqual([["updateProject", 12503890, { step_id: 266648 }], ["assignUsers", 12503890, [184738]]]);
  });
  it("Aufgabe: Fälligkeit mittags HERO-Ortszeit, am Projekt, für den Mitarbeiter", async () => {
    const { a, calls } = api();
    await runOp(op({ op: "aufgabe_anlegen", userId: 184738, fields: { title: "Banner bestellen", due_date: "2026-11-05" } }), t, a);
    expect(calls[0]).toEqual(["createTask", { title: "Banner bestellen", comment: null, target_user_id: 184738, target_project_match_id: 12503890, due_date: "2026-11-05T12:00:00+00:00" }]);
  });
  it("sanitizeOps verwirft unbekannte Arten und Felder", () => {
    const r = sanitizeOps([{ op: "delete_document", fields: {} }, { op: "logbuch_notiz", fields: { note: " hi ", evil: "x" }, contactId: "abc" }]);
    expect(r).toEqual([{ op: "logbuch_notiz", fields: { note: "hi" }, contactId: null, contactName: null, userId: null, personName: null, stepId: null, stepName: null }]);
  });
});
