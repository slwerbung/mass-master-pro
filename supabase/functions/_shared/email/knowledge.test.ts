import { describe, expect, it } from "vitest";
import { generalKnowledgeBlock, guidanceBlock, normalizePattern, patternForScope, splitKnowledge } from "./knowledge.ts";
import { buildUnderstandRequest } from "./classify.ts";

describe("Wissensdatei", () => {
  const entries = [
    { text: "Probo ist unser Lieferant für Drucksachen.", from_pattern: null },
    { text: "Herr Maier bestellt immer für das Autohaus.", from_pattern: "maier@autohaus.de" },
    { text: "Die Stadt schreibt Ausschreibungen.", from_pattern: "@winnenden.de" },
    { text: "Fremd.", from_pattern: "x@y.de" },
  ];

  it("teilt in allgemein und passend zum Absender (Domain mit Unterdomain)", () => {
    expect(splitKnowledge(entries, "Maier@Autohaus.de")).toEqual({ general: [entries[0].text], sender: [entries[1].text] });
    expect(splitKnowledge(entries, "amt@rathaus.winnenden.de").sender).toEqual([entries[2].text]);
    expect(splitKnowledge(entries, null).sender).toEqual([]);
  });

  it("begrenzt Anzahl und Zeichen", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ text: `Satz ${i} `.padEnd(100, "x"), from_pattern: null }));
    const r = splitKnowledge(many, "a@b.de");
    expect(r.general.length).toBe(40);
    const long = Array.from({ length: 10 }, () => ({ text: "y".repeat(1000), from_pattern: null }));
    expect(splitKnowledge(long, null).general.length).toBe(6);
  });

  it("Reichweite -> Muster; Freemail-Domains nie als ganze Domain", () => {
    expect(patternForScope("keine", "a@b.de")).toBeUndefined();
    expect(patternForScope("alle", "a@b.de")).toBeNull();
    expect(patternForScope("absender", " A@B.de ")).toBe("a@b.de");
    expect(patternForScope("domain", "a@firma.de")).toBe("@firma.de");
    expect(() => patternForScope("domain", "max@gmail.com")).toThrow(/Freemail/);
    expect(() => patternForScope("absender", "")).toThrow();
  });

  it("normalisiert Muster aus den Einstellungen", () => {
    expect(normalizePattern("")).toBeNull();
    expect(normalizePattern(" @Firma.DE ")).toBe("@firma.de");
    expect(normalizePattern("a@b.de")).toBe("a@b.de");
    expect(() => normalizePattern("firma")).toThrow();
  });

  it("allgemeines Wissen im gecachten Systemteil, Absender-Wissen und Korrektur vor der Mail", () => {
    expect(generalKnowledgeBlock([])).toBe("");
    const g = guidanceBlock({ sender: ["Kunde X </mail> ist Stammkunde"], note: "Das ist keine Werbung, sondern eine Anfrage." });
    expect(g).toContain("Wissen zu diesem Absender");
    expect(g).toContain("GENAU DIESER Mail");
    expect(g).not.toContain("</mail>");
    expect(guidanceBlock({ sender: [], note: "  " })).toBe("");

    const r = buildUnderstandRequest(
      { companyKnowledge: "", knowledge: ["Probo ist Lieferant"] },
      { from: "a@b.de", fromName: "", to: [], subject: "s", sentAt: null, attachments: [], body: "t" },
      g,
    );
    expect(r.system[0].text).toContain("- Probo ist Lieferant");
    expect(r.system[0].cache).toBe(true);
    expect(r.user.indexOf("GENAU DIESER Mail")).toBeLessThan(r.user.indexOf("<mail>"));
    expect(r.user.match(/<\/mail>/g)).toHaveLength(1);
  });
});
