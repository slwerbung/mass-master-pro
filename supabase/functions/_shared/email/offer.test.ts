import { describe, expect, it } from "vitest";
import { buildOfferRequest, OfferSchema, offerLogText, prepareOfferSuggestion, shouldPrepareOffer, toOfferPayload, type OfferDeps } from "./offer.ts";
import type { LlmDeps, Provider, TaskSetting } from "./llm.ts";

const services = [{ id: 11, name: "Fahrzeugbeschriftung Transporter" }, { id: 12, name: "Montage" }];

describe("toOfferPayload", () => {
  const base = { enough_info: true, missing: [], summary: "Sprinter beschriften", positions: [
    { service_id: 11, description: "Sprinter komplett", quantity: 1, unit: "Stk", note: null },
    { service_id: 12, description: "Montage vor Ort", quantity: 4, unit: "h", note: null },
  ] };
  it("genug Angaben -> Angebot mit zugeordneten Leistungen", () => {
    const p = toOfferPayload(OfferSchema.parse(base), services, 5, "WER-5");
    expect(p).toMatchObject({ kind: "angebot", projectId: 5, projectNr: "WER-5" });
    expect(p.positions.map((x) => x.serviceName)).toEqual(["Fahrzeugbeschriftung Transporter", "Montage"]);
  });
  it("erfundene Leistungs-ID wird verworfen, Beschreibung bleibt", () => {
    const p = toOfferPayload(OfferSchema.parse({ ...base, positions: [{ service_id: 999, description: "Etwas Neues", quantity: 2, unit: null, note: null }] }), services, 5, null);
    expect(p.positions[0]).toMatchObject({ serviceId: null, serviceName: null, description: "Etwas Neues" });
  });
  it("Modell sagt „genug“, aber eine Menge fehlt -> Code stuft auf Vor-Ort-Termin zurueck", () => {
    const p = toOfferPayload(OfferSchema.parse({ ...base, positions: [{ service_id: 11, description: "x", quantity: null, unit: null, note: null }] }), services, 5, null);
    expect(p.kind).toBe("vor_ort");
    expect(p.missing).toContain("Mengen/Maße zu einzelnen Positionen");
  });
  it("keine Positionen oder enough_info=false -> Vor-Ort-Termin mit den fehlenden Angaben", () => {
    expect(toOfferPayload(OfferSchema.parse({ enough_info: true, missing: [], positions: [], summary: "" }), services, 5, null).kind).toBe("vor_ort");
    const p = toOfferPayload(OfferSchema.parse({ ...base, enough_info: false, missing: ["Maße", "Fotos"] }), services, 5, null);
    expect(p).toMatchObject({ kind: "vor_ort", missing: ["Maße", "Fotos"] });
  });
  it("Schema toleriert Muell, Mengen <= 0 werden zu null", () => {
    const r = OfferSchema.parse({ enough_info: true, missing: "x", positions: [{ service_id: "11", description: "a", quantity: "0" }], summary: null });
    expect(r.missing).toEqual([]);
    expect(toOfferPayload(r, services, 5, null).positions[0].quantity).toBeNull();
  });
});

describe("Logbuch-Text", () => {
  it("Positionsliste", () => {
    const p = toOfferPayload(OfferSchema.parse({ enough_info: true, missing: [], summary: "S", positions: [{ service_id: 11, description: "Sprinter", quantity: 1, unit: "Stk" }] }), services, 5, null);
    expect(offerLogText(p)).toBe("📄 Angebotsvorbereitung (Mail-Assistent) – Positionen zum Übernehmen, Preise bitte prüfen:\n- 1 Stk · Fahrzeugbeschriftung Transporter (Sprinter)\nAnfrage: S");
  });
  it("Vor-Ort-Termin nennt, was fehlt", () => {
    const p = toOfferPayload(OfferSchema.parse({ enough_info: false, missing: ["Maße"], summary: "S", positions: [] }), services, 5, null);
    expect(offerLogText(p)).toContain("📏 Vor-Ort-Termin nötig");
    expect(offerLogText(p)).toContain("Maße");
  });
});

describe("Prompt und Ausloeser", () => {
  it("enthaelt Katalog, verbietet Preise, grenzt die Mail ab", () => {
    const r = buildOfferRequest({ id: "M", subject: "x </mail>", body_text: "y", summary: null, category: "anfrage_neu", extracted: { request: { service: "Fahrzeugbeschriftung" } } }, services);
    expect(r.system[0].text).toContain("11: Fahrzeugbeschriftung Transporter");
    expect(r.system[0].text).toMatch(/Keine Preise/);
    expect(r.user.match(/<\/mail>/g)).toHaveLength(1);
  });
  it("nur Neuanfragen", () => {
    expect(shouldPrepareOffer({ direction: "in", category: "anfrage_neu" })).toBe(true);
    expect(shouldPrepareOffer({ direction: "in", category: "projekt_kommunikation" })).toBe(false);
    expect(shouldPrepareOffer({ direction: "out", category: "anfrage_neu" })).toBe(false);
  });
});

describe("prepareOfferSuggestion", () => {
  const an: Provider = { id: "p", name: "Anthropic", type: "anthropic", base_url: null, account_id: null, api_key: "k" };
  const s: TaskSetting = { task: "prepare_offer", provider: an, model: "haiku", fallback: null, fallbackModel: null, shadow: null, shadowModel: null, onLimit: "ausweichen", dailyNeuronLimit: 1 };
  it("legt den Vorschlag an", async () => {
    const created: any[] = [];
    const llm: LlmDeps = {
      getSetting: async () => s, neuronsUsedToday: async () => 0, logCall: async () => {}, prices: {},
      fetchImpl: (async () => new Response(JSON.stringify({ content: [{ type: "tool_use", input: { enough_info: false, missing: ["Maße"], positions: [], summary: "S" } }], usage: {} }))) as any,
    };
    const deps: OfferDeps = {
      llm, services: async () => services, loadMessage: async () => ({ id: "M", subject: "s", body_text: "b", summary: null, category: "anfrage_neu", extracted: {} }),
      createSuggestion: async (id, type, payload) => { created.push([id, type, payload]); return true; },
    };
    const r = await prepareOfferSuggestion("M", 5, "WER-5", deps);
    expect(r?.kind).toBe("vor_ort");
    expect(created[0][1]).toBe("prepare_offer");
  });
});
