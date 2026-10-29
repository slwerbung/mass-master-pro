import { describe, expect, it } from "vitest";
import { isRelevant, normalizeTopicConfig, reasonText, TOPIC_DEFAULTS, topicStatus, validSnoozeDate, type TopicFacts } from "./topics.ts";

const NOW = new Date("2026-10-29T10:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const facts = (o: Partial<TopicFacts> = {}): TopicFacts => ({
  state: "aktiv", snoozedUntil: null, reviewedAt: null, lastIn: ago(0.5), lastOut: null,
  undecided: 0, hadDecided: true, openSuggestions: 0, customer: true, ...o,
});

describe("isRelevant", () => {
  const m = (o: Record<string, unknown>) => ({ direction: "in" as const, category: "anfrage_neu", status: "klassifiziert", beleg_state: null, ...o });
  it("legt alles vor ausser Werbung/Spam und Newsletter", () => {
    expect(isRelevant(m({}), TOPIC_DEFAULTS)).toBe(true);
    expect(isRelevant(m({ category: "system" }), TOPIC_DEFAULTS)).toBe(true);
    expect(isRelevant(m({ category: "lieferant" }), TOPIC_DEFAULTS)).toBe(true);
    expect(isRelevant(m({ category: "werbung_spam" }), TOPIC_DEFAULTS)).toBe(false);
    expect(isRelevant(m({ category: "newsletter" }), TOPIC_DEFAULTS)).toBe(false);
  });
  it("ausgehende nie, unverarbeitete noch nicht, gescheiterte schon", () => {
    expect(isRelevant(m({ direction: "out" }), TOPIC_DEFAULTS)).toBe(false);
    expect(isRelevant(m({ category: null, status: "neu" }), TOPIC_DEFAULTS)).toBe(false);
    expect(isRelevant(m({ category: null, status: "fehler" }), TOPIC_DEFAULTS)).toBe(true);
  });
  it("an Lexware weitergeleitete Belege sind erledigt", () => {
    expect(isRelevant(m({ category: "beleg", beleg_state: "weitergeleitet" }), TOPIC_DEFAULTS)).toBe(false);
    expect(isRelevant(m({ category: "beleg", beleg_state: "portal_offen" }), TOPIC_DEFAULTS)).toBe(true);
  });
});

describe("topicStatus", () => {
  it("neue Mail = zu entscheiden, auch in abgeschlossenem Thema und auf Wiedervorlage", () => {
    expect(topicStatus(facts({ undecided: 1, hadDecided: false }), TOPIC_DEFAULTS, NOW)).toMatchObject({ due: true, reason: "neu" });
    expect(topicStatus(facts({ undecided: 1, state: "erledigt" }), TOPIC_DEFAULTS, NOW)).toMatchObject({ due: true, reason: "wieder_offen" });
    expect(topicStatus(facts({ undecided: 1, state: "wiedervorlage", snoozedUntil: ago(-5) }), TOPIC_DEFAULTS, NOW)).toMatchObject({ due: true, reason: "neu" });
  });

  it("abgeschlossen wird nicht verfolgt", () => {
    expect(topicStatus(facts({ state: "erledigt", lastIn: ago(30) }), TOPIC_DEFAULTS, NOW).due).toBe(false);
  });

  it("Wiedervorlage ruht bis zum Datum, dann wieder vorlegen – offene Vorschlaege warten mit", () => {
    const s = topicStatus(facts({ state: "wiedervorlage", snoozedUntil: ago(-3), openSuggestions: 2 }), TOPIC_DEFAULTS, NOW);
    expect(s).toMatchObject({ due: false, nextCheck: ago(-3) });
    expect(topicStatus(facts({ state: "wiedervorlage", snoozedUntil: ago(0.1) }), TOPIC_DEFAULTS, NOW)).toMatchObject({ due: true, reason: "wiedervorlage" });
  });

  it("offener Vorschlag = zu entscheiden", () => {
    expect(topicStatus(facts({ openSuggestions: 1 }), TOPIC_DEFAULTS, NOW)).toMatchObject({ due: true, reason: "vorschlag" });
  });

  it("Kundenmail unbeantwortet: nach 2 Tagen wieder vorlegen, gerechnet ab der letzten Entscheidung", () => {
    expect(topicStatus(facts({ lastIn: ago(1), reviewedAt: ago(1) }), TOPIC_DEFAULTS, NOW).due).toBe(false);
    expect(topicStatus(facts({ lastIn: ago(3), reviewedAt: ago(3) }), TOPIC_DEFAULTS, NOW)).toMatchObject({ due: true, reason: "unbeantwortet", days: 3 });
    // eben erst „weiter verfolgen“ geklickt -> Ruhe fuer 2 Tage
    expect(topicStatus(facts({ lastIn: ago(3), reviewedAt: ago(0.1) }), TOPIC_DEFAULTS, NOW).due).toBe(false);
  });

  it("beantwortet bzw. keine Kundenmail: nach 7 Tagen ohne Bewegung nachfassen", () => {
    const answered = facts({ lastIn: ago(9), lastOut: ago(8), reviewedAt: ago(8) });
    expect(topicStatus(answered, TOPIC_DEFAULTS, NOW)).toMatchObject({ due: true, reason: "nachfassen", days: 8 });
    expect(topicStatus({ ...answered, lastOut: ago(3) }, TOPIC_DEFAULTS, NOW)).toMatchObject({ due: false, reason: null });
    // Lieferantenmail ohne Antwort ist kein „unbeantwortet“, aber nach 7 Tagen trotzdem wieder da
    expect(topicStatus(facts({ customer: false, lastIn: ago(3), reviewedAt: ago(3) }), TOPIC_DEFAULTS, NOW).due).toBe(false);
    expect(topicStatus(facts({ customer: false, lastIn: ago(8), reviewedAt: ago(8) }), TOPIC_DEFAULTS, NOW)).toMatchObject({ due: true, reason: "nachfassen" });
  });

  it("Fristen aus der Einstellung", () => {
    const cfg = normalizeTopicConfig({ unanswered_days: 1, followup_days: 3 });
    expect(topicStatus(facts({ lastIn: ago(1.5), reviewedAt: ago(1.5) }), cfg, NOW).reason).toBe("unbeantwortet");
    expect(topicStatus(facts({ lastIn: ago(4), lastOut: ago(4), reviewedAt: ago(4) }), cfg, NOW).reason).toBe("nachfassen");
  });
});

describe("normalizeTopicConfig", () => {
  it("Standard bei Unsinn", () => {
    expect(normalizeTopicConfig(null)).toEqual(TOPIC_DEFAULTS);
    expect(normalizeTopicConfig({ unanswered_days: 0, followup_days: "x" })).toMatchObject({ unanswered_days: 2, followup_days: 7 });
    expect(normalizeTopicConfig({ skip_categories: ["werbung_spam"] }).skip_categories).toEqual(["werbung_spam"]);
  });
});

describe("validSnoozeDate", () => {
  it("ab morgen, hoechstens zwei Jahre", () => {
    expect(validSnoozeDate("2026-10-30", "2026-10-29")).toBe("2026-10-30");
    expect(validSnoozeDate("2026-10-29", "2026-10-29")).toBeNull();
    expect(validSnoozeDate("2029-01-01", "2026-10-29")).toBeNull();
    expect(validSnoozeDate("30.10.2026", "2026-10-29")).toBeNull();
  });
});

describe("reasonText", () => {
  it("nennt Tage und Notiz", () => {
    expect(reasonText({ due: true, reason: "unbeantwortet", nextCheck: null, days: 3 }, null)).toBe("Kundenmail seit 3 Tagen unbeantwortet");
    expect(reasonText({ due: true, reason: "wiedervorlage", nextCheck: null, days: null }, "Freigabe da?")).toBe("Wiedervorlage: Freigabe da?");
  });
});
