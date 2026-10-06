import { describe, expect, it } from "vitest";
import { learnedCategory, learnRule, type CategoryFeedback, type LearnStore } from "./learn.ts";

const fb = (...v: (string | null)[]): CategoryFeedback[] => v.map((x, i) => ({ new_value: x, created_at: `2026-10-0${9 - i}` }));

describe("learnedCategory", () => {
  it("zweimal dieselbe Kategorie -> gelernt", () => expect(learnedCategory(fb("lieferant", "lieferant"))).toBe("lieferant"));
  it("einmal, unterschiedlich, leer oder unbekannt -> nicht", () => {
    expect(learnedCategory(fb("lieferant"))).toBeNull();
    expect(learnedCategory(fb("lieferant", "beleg"))).toBeNull();
    expect(learnedCategory(fb(null, null))).toBeNull();
    expect(learnedCategory(fb("kaffee", "kaffee"))).toBeNull();
    expect(learnedCategory([])).toBeNull();
  });
  it("die LETZTEN beiden zaehlen: eine dazwischen setzt zurueck", () => {
    expect(learnedCategory(fb("beleg", "lieferant", "lieferant"))).toBeNull();
  });
});

describe("learnRule", () => {
  function store(feedback: CategoryFeedback[], existing: { source: string; category: string } | null = null) {
    const saved: any[] = [];
    const s: LearnStore = { recentCategoryFeedback: async () => feedback, existingRule: async () => existing, saveRule: async (p, c) => { saved.push([p, c]); } };
    return { s, saved };
  }
  it("legt eine Regel fuer die genaue Adresse an", async () => {
    const t = store(fb("newsletter", "newsletter"));
    expect(await learnRule(" Shop@Probo.DE ", t.s)).toEqual({ pattern: "shop@probo.de", category: "newsletter" });
    expect(t.saved).toEqual([["shop@probo.de", "newsletter"]]);
  });
  it("ueberschreibt nie von Hand angelegte oder Seed-Regeln, wiederholt keine vorhandene", async () => {
    for (const ex of [{ source: "manuell", category: "lieferant" }, { source: "seed", category: "system" }, { source: "gelernt", category: "newsletter" }]) {
      const t = store(fb("newsletter", "newsletter"), ex);
      expect(await learnRule("a@b.de", t.s)).toBeNull();
      expect(t.saved).toEqual([]);
    }
  });
  it("aktualisiert eine gelernte Regel, wenn der Mensch umlernt", async () => {
    const t = store(fb("lieferant", "lieferant"), { source: "gelernt", category: "newsletter" });
    expect(await learnRule("a@b.de", t.s)).toEqual({ pattern: "a@b.de", category: "lieferant" });
  });
  it("ungueltige Adressen", async () => {
    expect(await learnRule("", store(fb("beleg", "beleg")).s)).toBeNull();
    expect(await learnRule("keine-adresse", store(fb("beleg", "beleg")).s)).toBeNull();
  });
});
