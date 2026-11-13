import { describe, expect, it } from "vitest";
import { fetchAllProjectMatches, gewerkOf, mapProject } from "./sync.ts";
import { normalizeDocuments } from "./docs.ts";

const pm = (id: number, over: any = {}) => ({
  id, is_deleted: false, project_nr: `WER-${id}`, name: "Schild", created: "2026-01-01T00:00:00Z",
  customer: { first_name: "Max", last_name: "Muster", company_name: "", email: " Max@Muster.DE ", phone_mobile: "", phone_home: "0731 123" }, address: { city: "Ulm" },
  current_project_match_status: { created: "2026-11-01T08:00:00Z", step_id: 266512, step: { id: 266512, name: "🚧 Projektplanung" } },
  project_match_assignments: [{ user: { email: "JL@slwerbung.de" } }, { user: { email: "jl@slwerbung.de" } }, { user: { email: "info@slwerbung.de" } }],
  customer_documents: [{ nr: "A-1", type: "offer", created: "2026-10-20", status_name: "Versendet", value: 100 }, { nr: "A-2", type: "offer", created: "2026-10-21", status_name: "Gelöscht" }],
  ...over,
});

describe("hero-sync", () => {
  it("mappt Projekt: Bearbeiter dedupliziert ohne info@, Dokumente ohne geloeschte", () => {
    const r = mapProject(pm(5), ["info@slwerbung.de"])!;
    expect(r).toMatchObject({ hero_id: 5, kunde: "Max Muster", ort: "Ulm", gewerk: "Werbetechnik", step_id: 266512, step_key: "planung", step_since: "2026-11-01T08:00:00Z" });
    expect(r.assignee_emails).toEqual(["jl@slwerbung.de"]);
    expect(r).toMatchObject({ kunde_email: "max@muster.de", kunde_telefon: "0731 123" });
    expect(r.documents).toHaveLength(1);
  });
  it("laesst geloeschte sowie abgeschlossene/archivierte Projekte weg", () => {
    expect(mapProject(pm(1, { is_deleted: true }), [])).toBeNull();
    expect(mapProject(pm(2, { current_project_match_status: { created: "x", step_id: 2836, step: { id: 2836, name: "✅ Abgeschlossen" } } }), [])).toBeNull();
    expect(mapProject(pm(3, { current_project_match_status: { created: "x", step_id: 2837, step: { id: 2837, name: "📦 Archiviert" } } }), [])).toBeNull();
  });
  it("merkt den HERO-Dokumentnamen (Abschlussrechnung) und liest ihn aus dem Spiegel wieder", () => {
    const docs = normalizeDocuments([{ nr: "RG-1", type: "invoice", created: "2026-11-01", status_name: "Versendet", document_type: { name: "Abschlussrechnung" } }]);
    expect(docs[0]).toMatchObject({ type: "invoice", kind: "Abschlussrechnung", status: "Versendet" });
    // bereits gespiegelte Zeile (kind statt document_type) bleibt erhalten
    expect(normalizeDocuments(docs)[0].kind).toBe("Abschlussrechnung");
    // ältere Spiegelzeile ohne Namen
    expect(normalizeDocuments([{ nr: "RG-2", type: "invoice", status: "Versendet" }])[0].kind).toBe("");
  });
  it("Gewerk aus Nummernpraefix", () => {
    expect(gewerkOf("TEX-12")).toBe("Textildruck");
    expect(gewerkOf("XYZ-1")).toBe("");
  });
  it("ignoriert Storniert und Gelöscht bei Dokumenten", () => {
    expect(normalizeDocuments([{ status_name: "Storniert" }, { status_name: "Entwurf", type: "offer" }])).toHaveLength(1);
  });
  it("holt Seiten, bis eine weniger als 50 liefert, ohne Dubletten", async () => {
    const total = 120;
    const calls: number[] = [];
    const fetchImpl = (async (_u: string, init: any) => {
      const offset = JSON.parse(init.body).variables.offset as number;
      calls.push(offset);
      const rows = Array.from({ length: Math.max(0, Math.min(50, total - offset)) }, (_, i) => ({ id: offset + i }));
      return new Response(JSON.stringify({ data: { project_matches: rows } }), { status: 200 });
    }) as unknown as typeof fetch;
    const all = await fetchAllProjectMatches("k", fetchImpl);
    expect(all).toHaveLength(total);
    expect(new Set(all.map((x) => x.id)).size).toBe(total);
  });
  it("wirft GraphQL-Fehler aus dem Body", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ errors: [{ message: "kaputt" }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchAllProjectMatches("k", fetchImpl)).rejects.toThrow("kaputt");
  });
});
