import { describe, expect, it } from "vitest";
import {
  addLogbookEntry, contactsByEmail, preferEstablished, createContact, createDocument, createEmptyDocument, documentsOfProjects, pickTemplate, sendDocumentMail, createProject, heroGraphql,
  listServices, openProjectsOfCustomer, projectByNumber, setStep, toProject,
} from "./hero.ts";

function fakeFetch(handlers: ((q: string, v: any) => any)[]) {
  const calls: { q: string; v: any }[] = [];
  let i = 0;
  const f = (async (_u: string, init: any) => {
    const b = JSON.parse(init.body);
    calls.push({ q: b.query, v: b.variables });
    const h = handlers[Math.min(i++, handlers.length - 1)];
    const out = h(b.query, b.variables);
    return new Response(JSON.stringify(out), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("heroGraphql", () => {
  it("wirft bei errors im Body (HERO antwortet 200)", async () => {
    const { f } = fakeFetch([() => ({ errors: [{ message: "Field x unknown" }] })]);
    await expect(heroGraphql("k", "q", {}, f)).rejects.toThrow("Field x unknown");
  });
  it("wirft bei HTTP-Fehler und kaputtem JSON", async () => {
    await expect(heroGraphql("k", "q", {}, (async () => new Response("nope", { status: 502 })) as any)).rejects.toThrow(/HTTP 502/);
    await expect(heroGraphql("k", "q", {}, (async () => new Response("<html>")) as any)).rejects.toThrow(/kein JSON/);
  });
  it("schickt Bearer-Schluessel und Variablen (kein String-Einbau)", async () => {
    let seen: any;
    await heroGraphql("KEY", "query($a:Int){x}", { a: 1 }, (async (_u: string, init: any) => { seen = init; return new Response(JSON.stringify({ data: {} })); }) as any);
    expect(seen.headers.Authorization).toBe("Bearer KEY");
    expect(JSON.parse(seen.body).variables).toEqual({ a: 1 });
  });
});

describe("Lesen", () => {
  it("projectByNumber nutzt relative_id als String und liest Schritt und Kunde", async () => {
    const { f, calls } = fakeFetch([() => ({ data: { project_matches: [{ id: "9", project_nr: "WER-1744", name: "Crafter", current_project_match_status: { step_id: 5, step: { name: "Layout" } }, customer: { id: 7, company_name: "Muster GmbH" } }] } })]);
    const p = await projectByNumber("k", 1744, f);
    expect(calls[0].v).toEqual({ nr: "1744" });
    expect(p).toEqual({ id: 9, nr: "WER-1744", name: "Crafter", stepId: 5, stepName: "Layout", customerId: 7, customerName: "Muster GmbH" });
  });
  it("toProject verkraftet fehlende Felder", () => {
    expect(toProject({ id: 1 })).toMatchObject({ id: 1, nr: "", stepId: null, customerId: null });
  });
  it("contactsByEmail filtert die Teilstring-Suche auf EXAKTE Treffer und loest Ansprechpartner auf die Firma auf", async () => {
    const { f } = fakeFetch([() => ({ data: { contacts: [
      { id: 1, email: "Max@Muster.de", is_contact_person: true, parent_customer_id: 77, first_name: "Max", last_name: "M" },
      { id: 2, email: "max@muster.de.evil.com", is_contact_person: false },
      { id: 3, email: "max@muster.de", is_contact_person: false, company_name: "Muster GmbH" },
    ] } })]);
    const r = await contactsByEmail("k", "max@muster.de", f);
    expect(r.map((c) => [c.id, c.customerId])).toEqual([[3, 3], [1, 77]]);
  });
  it("Dublette: gleiche Adresse bei zwei Kunden -> das aeltere Original zuerst (live: VfR 1302092 vs. Kopie 8286198)", () => {
    const r = preferEstablished([{ id: 8286198, customerId: 8286198 }, { id: 2460033, customerId: 1302092 }]);
    expect(r.map((c) => c.customerId)).toEqual([1302092, 8286198]);
    const many = preferEstablished([{ customerId: 5 }, { customerId: 9 }, { customerId: 9 }]);
    expect(many[0].customerId).toBe(9);
  });
  it("openProjectsOfCustomer: ausgeschlossene Schritte und fremde Kunden raus", async () => {
    const mk = (id: number, step: number, cust: number) => ({ id, project_nr: `WER-${id}`, name: "", current_project_match_status: { step_id: step, step: { name: "s" } }, customer: { id: cust } });
    const { f, calls } = fakeFetch([() => ({ data: { project_matches: [mk(1, 10, 7), mk(2, 2836, 7), mk(3, 10, 8), mk(4, 2834, 7)] } })]);
    const r = await openProjectsOfCustomer("k", 7, [2834, 2836, 2837], f);
    expect(r.map((p) => p.id)).toEqual([1]);
    expect(calls[0].v).toEqual({ c: 7 });
  });
  it("listServices blaettert, bis eine Seite nicht voll ist", async () => {
    const page = (n: number, base: number) => ({ data: { supply_services: Array.from({ length: n }, (_, i) => ({ id: base + i, name: `L${base + i}` })) } });
    const { f, calls } = fakeFetch([() => page(50, 0), () => page(3, 50)]);
    expect(await listServices("k", f)).toHaveLength(53);
    expect(calls.map((c) => c.v.o)).toEqual([0, 50]);
  });
});

describe("Schreiben", () => {
  it("add_logbook_entry: custom_text, target project_match, gekuerzt auf 5000", async () => {
    const { f, calls } = fakeFetch([() => ({ data: { add_logbook_entry: { id: 1 } } })]);
    await addLogbookEntry("k", 5, "x".repeat(6000), f);
    expect(calls[0].v.entry).toMatchObject({ target: "project_match", target_id: 5 });
    expect(calls[0].v.entry.custom_text).toHaveLength(5000);
  });
  it("setStep: update_project_match mit step_id", async () => {
    const { f, calls } = fakeFetch([() => ({ data: { update_project_match: { id: 5 } } })]);
    await setStep("k", 5, 266511, f);
    expect(calls[0].v.pm).toEqual({ id: 5, step_id: 266511 });
  });
  it("createContact: findExisting, Firma -> commercial, Privatperson -> private", async () => {
    const { f, calls } = fakeFetch([() => ({ data: { create_contact: { id: "42" } } })]);
    expect(await createContact("k", { company: "Muster GmbH", last_name: null, email: "a@b.de" }, "Mail-Assistent", f)).toBe(42);
    expect(calls[0].v.findExisting).toBe(true);
    expect(calls[0].v.contact).toMatchObject({ type: "commercial", is_contact_person: false, company_name: "Muster GmbH", category: "customer" });
    await createContact("k", { first_name: "Max", last_name: "M", email: "m@b.de", street: "Weg 1", zip: "71332", city: "W" }, "Mail-Assistent", f);
    expect(calls[1].v.contact).toMatchObject({ type: "private", is_contact_person: true, address: { street: "Weg 1", zip: "71332", city: "W" } });
  });
  it("createProject: bewaehrte verschachtelte Form; faellt bei abgelehnten Zusatzfeldern auf die Minimalform zurueck", async () => {
    const { f, calls } = fakeFetch([
      () => ({ errors: [{ message: 'Field "step_id" is not defined by type ProjectMatchInput' }] }),
      () => ({ data: { create_project_match: { id: "555", project_nr: "WER-555" } } }),
    ]);
    const r = await createProject("k", { name: "Crafter", customerId: 901, measureId: 6619, typeId: 181, stepId: 2825, notes: "n" }, f);
    expect(r).toEqual({ id: 555, nr: "WER-555" });
    expect(calls[0].v.project_match).toMatchObject({ type_id: 181, step_id: 2825, project: { customer_id: 901, measure_id: 6619 } });
    expect(calls[1].v.project_match.type_id).toBeUndefined();
    expect(calls[1].v.project_match).toMatchObject({ name: "Crafter", partner_notes: "n", project: { customer_id: 901, address: { street: "", city: "", zipcode: "" } } });
  });
  it("createProject: andere Fehler (z. B. Kunde unbekannt) werden NICHT verschleiert", async () => {
    const { f, calls } = fakeFetch([() => ({ errors: [{ message: "Kunde nicht gefunden" }] })]);
    await expect(createProject("k", { name: "x", customerId: 1, measureId: null, typeId: 181, stepId: 1, notes: "" }, f)).rejects.toThrow("Kunde nicht gefunden");
    expect(calls).toHaveLength(1);
  });
});

describe("Dokumente", () => {
  it("legt einen Entwurf mit Aktionen an (nie abgeschlossen) und liefert die Dokument-ID", async () => {
    const { f, calls } = fakeFetch([() => ({ data: { create_document: { id: 7, customer_document_id: 88, nr: "0" } } })]);
    expect(await createDocument("k", 5, 171301, [{ add_text: { text: "x" } }], f)).toEqual({ id: 88, nr: null });
    expect(calls[0].v.input).toEqual({ document_type_id: 171301, project_match_id: 5, publish: false, with_defaults: true });
    expect(calls[0].v.actions).toEqual([{ add_text: { text: "x" } }]);
    // Leeres Dokument: die Aktionsliste ist Pflicht, also leer statt weggelassen.
    const e = fakeFetch([() => ({ data: { create_document: { id: 9, customer_document_id: 99 } } })]);
    expect(await createEmptyDocument("k", 5, 171300, e.f)).toEqual({ id: 99 });
    expect(e.calls[0].v.actions).toEqual([]);
  });
  it("liest nur Dokumente der angefragten Projekte, ohne geloeschte, neueste zuerst", async () => {
    const { f } = fakeFetch([() => ({ data: { customer_documents: [
      { id: 1, nr: "AB-1", date: "2026-01-01", status_code: 200, project_match: { id: 5, project_nr: "WER-5" } },
      { id: 2, nr: "AB-2", date: "2026-03-01", status_code: 100, project_match: { id: 5 } },
      { id: 3, nr: "AB-3", date: "2026-04-01", status_code: 1000, project_match: { id: 5 } },
      { id: 4, nr: "AB-4", date: "2026-05-01", status_code: 200, project_match: { id: 6 } },
    ] } })]);
    expect((await documentsOfProjects("k", [5], [171301], 20, f)).map((d) => d.nr)).toEqual(["AB-2", "AB-1"]);
  });
  it("waehlt die Vorlage nach Anrede", () => {
    const t = [{ id: 1, name: "Auftragsbestätigung verschicken (PER SIE)" }, { id: 2, name: "Auftragsbestätigung verschicken (PER DU)" }];
    expect(pickTemplate(t, "du")?.id).toBe(2);
    expect(pickTemplate(t, "sie")?.id).toBe(1);
    expect(pickTemplate(t, null)?.id).toBe(1);
    expect(pickTemplate([], null)).toBeNull();
  });
  it("versendet mit Kontext, Dokument, Vorlage und PDF – Betreff/Text aus der Vorlage", async () => {
    const { f, calls } = fakeFetch([() => ({ data: { send_mail: { __typename: "OutboxMail" } } })]);
    await sendDocumentMail("k", { kind: "confirmation", documentId: 88, recipient: "k@x.de", templateId: 5187, fileUuid: "u-1" }, f);
    expect(calls[0].v.email).toEqual({ context: "CUSTOMER_DOCUMENT_CONFIRMATION", context_id: 88, recipient_email: "k@x.de", template_id: 5187, uuids: ["u-1"] });
  });
});
