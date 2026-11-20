import { describe, expect, it } from "vitest";
import { acceptCount, acceptEdits, canAccept, initialEdits, runOrder, runRows, shortText, shortWhen, stackLabel, type RunRow } from "./decide";
import type { Suggestion } from "./suggestions";

const sugg = (type: Suggestion["type"], payload: unknown = {}) => ({ id: type, type, payload, status: "offen", result: null, created_at: "", message: {}, attachments: [] }) as unknown as Suggestion;

describe("Ausführen: Reihenfolge und Abbruch", () => {
  const rows: RunRow[] = [
    { key: "log", type: "log_entry", checked: true }, { key: "send", type: "send_document", checked: true },
    { key: "proj", type: "create_project", checked: true }, { key: "beleg", type: "beleg", checked: true },
    { key: "step", type: "change_step", checked: false }, { key: "old", type: "link_project", checked: true, done: true },
  ];
  it("erst das Projekt, dann was daran hängt; send_document und Erledigtes nie", () => {
    expect(runOrder(rows).map((r) => r.key)).toEqual(["proj", "step", "log", "beleg"]);
    expect(acceptCount(rows)).toBe(3);
  });
  it("angehakt = accept, abgehakt = reject, Beleg ohne Haken bleibt unberührt", async () => {
    const calls: string[] = [];
    const r = await runRows([...rows.slice(0, 5)].map((x) => (x.key === "beleg" ? { ...x, checked: false } : x)), async (row, mode) => { calls.push(`${row.key}:${mode}`); });
    expect(calls).toEqual(["proj:accept", "step:reject", "log:accept"]);
    expect(r.status).toEqual({ proj: "accepted", step: "rejected", log: "accepted" });
    expect(r.failed).toBeNull();
  });
  it("hält beim ersten Fehler an, Erledigtes bleibt erledigt", async () => {
    const calls: string[] = [];
    const r = await runRows(rows, async (row) => { calls.push(row.key); if (row.key === "step") throw new Error("HERO nicht erreichbar"); });
    expect(calls).toEqual(["proj", "step"]);
    expect(r.status).toEqual({ proj: "accepted" });
    expect(r.failed).toEqual({ key: "step", error: "HERO nicht erreichbar" });
  });
});

describe("Etikett im Stapel", () => {
  it("Kategorie der Mail, Grund hat Vorrang bei Nachfassen/Unbeantwortet/Wiedervorlage", () => {
    expect(stackLabel("anfrage_neu", "neu")).toEqual({ text: "Anfrage", style: "kunde" });
    expect(stackLabel("layout_freigabe", "vorschlag")).toEqual({ text: "Freigabe", style: "auftrag" });
    expect(stackLabel("beleg", null)).toEqual({ text: "Beleg", style: "pflege" });
    expect(stackLabel("auftrag", "nachfassen")).toEqual({ text: "Nachfassen", style: "termine" });
    expect(stackLabel("auftrag", "unbeantwortet")).toEqual({ text: "Unbeantwortet", style: "kunde" });
    expect(stackLabel(null, "wiedervorlage")).toEqual({ text: "Wiedervorlage", style: "termine" });
  });
  it("Uhrzeit heute, sonst Datum", () => {
    const now = new Date("2026-11-20T10:00:00Z");
    expect(shortWhen("2026-11-20T06:12:00Z", now)).toBe("07:12");
    expect(shortWhen("2026-11-19T06:12:00Z", now)).toBe("19.11.");
    expect(shortWhen(null, now)).toBe("");
  });
});

describe("Kurztexte und Felder", () => {
  it("Kurztexte je Art", () => {
    expect(shortText(sugg("change_step", { toStepId: 5, toLabel: "Auftrag" }), { stepId: 5 })).toBe("Status → Auftrag");
    expect(shortText(sugg("change_step", { toStepId: 5, toLabel: "Auftrag", alternatives: [{ stepId: 6, label: "Produktion" }] }), { stepId: 6 })).toBe("Status → Produktion");
    expect(shortText(sugg("log_entry"), {})).toBe("Logbuch-Eintrag");
    const items = [{ filename: "a.pdf", selected: true }, { filename: "b.png", selected: false }];
    expect(shortText(sugg("upload_attachments", { items }), { items })).toBe("a.pdf hochladen");
    const two = items.map((i) => ({ ...i, selected: true }));
    expect(shortText(sugg("upload_attachments", { items: two }), { items: two })).toBe("2 Anhänge hochladen");
    expect(shortText(sugg("prepare_offer", { kind: "angebot" }), { kind: "angebot" })).toBe("Angebotsentwurf anlegen");
    expect(shortText(sugg("prepare_offer", { kind: "angebot" }), { kind: "vor_ort" })).toBe("Vor-Ort-Termin statt Angebot");
    expect(shortText(sugg("create_confirmation"), {})).toBe("AB-Entwurf anlegen");
    expect(shortText(sugg("create_project"), {})).toBe("Kontakt + Projekt anlegen");
    expect(shortText(sugg("link_project", { projectNr: "WER-1" }), {}, { linkNr: "WER-1947" })).toBe("Zu WER-1947 zuordnen + Logbuch");
    expect(shortText(sugg("send_document", { kind: "offer", documentNr: "AN-12" }), {})).toBe("Angebot AN-12 prüfen & senden");
    expect(shortText(sugg("send_document", { kind: "confirmation", documentNr: "AB-7" }), {})).toBe("AB AB-7 prüfen & senden");
  });
  it("Felder: Startwerte und Übergabe wie in den bisherigen Karten", () => {
    const cp = sugg("create_project", { contact: { email: "a@b.de" }, project: { name: "Schild", notes: "n", gewerk: { short: "WER" } }, existingCustomer: { id: 1, name: "X" } });
    const e = initialEdits(cp);
    expect(e).toMatchObject({ name: "Schild", gw: "WER", useExisting: true });
    const gewerke = [{ short: "WER", name: "Werbetechnik", measure_id: 3 }];
    expect(acceptEdits(cp, e, { gewerke })).toEqual({ contact: { email: "a@b.de" }, useExisting: true, project: { name: "Schild", notes: "n", gewerk: gewerke[0] } });
    expect(acceptEdits(cp, { ...e, useExisting: false }, { gewerke })).toMatchObject({ useExisting: false });
    const link = sugg("link_project", { projectId: 7, text: "Mail erhalten" });
    expect(acceptEdits(link, initialEdits(link), { gewerke, projectId: 9 })).toEqual({ projectId: 9, text: "Mail erhalten" });
    expect(canAccept(sugg("link_project", {}), {}, { gewerke })).toBe(false);
    expect(canAccept(sugg("upload_attachments"), { items: [{ selected: false }] }, { gewerke })).toBe(false);
  });
});
