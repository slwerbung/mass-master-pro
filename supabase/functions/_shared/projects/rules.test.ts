import { describe, expect, it } from "vitest";
import { evaluateProject, priorityOf, type EvalContext, type ProjectRow, type RuleRow, type StepSetting } from "./rules.ts";
import { defaultCloseness, defaultExcluded, stepKey } from "./steps.ts";

const NOW = new Date("2026-11-09T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const R = (key: string, category: RuleRow["category"], threshold: number | null = null, active = true): RuleRow => ({
  key, label: key, category, threshold_days: threshold, suggestion: "", channel: "api", followup_days: null, followup_reason: "", autopilot: "off", sort: 0, active,
});
const rules = [
  R("reklamation", "kunde"), R("freigabe_offen", "kunde", 5), R("abholung", "kunde", 7), R("anfrage_ohne_angebot", "auftrag"),
  R("anfrage_status_alt", "auftrag"), R("angebot_entwurf", "auftrag"), R("nachfassen", "auftrag", 7), R("ab_fehlt", "auftrag", 2),
  R("termine_fehlen", "termine", 7), R("haengt", "termine"), R("waise", "pflege"),
];
const NAMES: Record<string, string> = {
  anfragen: "📬Anfragen", angebot: "📄 Angeboterstellung", warten_auftrag: "⏳ Warten auf Auftrag", planung: "🚧 Projektplanung",
  material: "🧾 Materialbestellung", freigabe: "Warten auf Layoutfreigabe", abholung: "💱 Fertig zur Abholung", reklamation: "Reklamation",
  druck: "Druck", bezahlung: "⌚ Warten auf Bezahlung",
};
const steps: StepSetting[] = Object.entries(NAMES).map(([key, name], i) => ({
  step_id: 100 + i, name, key, target_days: 7, excluded: defaultExcluded(key), closeness: defaultCloseness(key),
}));
const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  now: NOW, bundleAfterDays: 60, rules: new Map(rules.map((r) => [r.key, r])), steps: new Map(steps.map((s) => [s.step_id, s])), ...over,
});
const doc = (type: string, status: string, daysAgo: number) => ({ nr: "X-1", type, status_name: status, created: ago(daysAgo) });
const project = (key: string, days: number, documents: unknown[] = []): ProjectRow => {
  const s = steps.find((x) => x.key === key)!;
  return { hero_id: 1, project_nr: "WER-1", name: "Test", step_id: s.step_id, step_name: NAMES[key], step_key: key, step_since: ago(days), hero_created: ago(200), documents };
};
const rule = (p: ProjectRow, c = ctx()) => evaluateProject(p, c)?.ruleKey ?? null;

describe("Regeln", () => {
  it("Reklamation immer", () => expect(rule(project("reklamation", 0))).toBe("reklamation"));
  it("Freigabe offen erst ueber 5 Tage", () => {
    expect(rule(project("freigabe", 5))).toBeNull();
    expect(rule(project("freigabe", 6))).toBe("freigabe_offen");
  });
  it("Abholung erst ueber 7 Tage", () => {
    expect(rule(project("abholung", 7))).toBeNull();
    expect(rule(project("abholung", 8))).toBe("abholung");
  });
  it("Anfrage ohne / mit versendetem Angebot", () => {
    expect(rule(project("anfragen", 1))).toBe("anfrage_ohne_angebot");
    expect(rule(project("anfragen", 1, [doc("offer", "Versendet", 1)]))).toBe("anfrage_status_alt");
    expect(rule(project("anfragen", 1, [doc("offer", "Gelöscht", 1)]))).toBe("anfrage_ohne_angebot");
  });
  it("Angebot fertigstellen: Status Angeboterstellung oder Entwurf ausserhalb Warten auf Auftrag", () => {
    expect(rule(project("angebot", 0))).toBe("angebot_entwurf");
    expect(rule(project("druck", 1, [doc("offer", "Entwurf", 1)]))).toBe("angebot_entwurf");
    expect(rule(project("druck", 1, [doc("offer", "Entwurf", 1), doc("confirmation", "Versendet", 1)]))).toBeNull();
    expect(rule(project("warten_auftrag", 1, [doc("offer", "Erstellt", 1)]))).toBeNull();
  });
  it("Nachfassen: Tage seit letztem versendeten Angebot, nicht seit Statuswechsel", () => {
    expect(rule(project("warten_auftrag", 30, [doc("offer", "Versendet", 6)]))).not.toBe("nachfassen");
    expect(rule(project("warten_auftrag", 5, [doc("offer", "Versendet", 6)]))).toBeNull();
    const s = evaluateProject(project("warten_auftrag", 30, [doc("offer", "Erneut versendet", 8)]), ctx());
    expect(s?.ruleKey).toBe("nachfassen");
    expect(s?.days).toBe(8);
  });
  it("AB fehlt / Termine fehlen", () => {
    expect(rule(project("planung", 2))).toBeNull();
    expect(rule(project("planung", 3))).toBe("ab_fehlt");
    expect(rule(project("material", 3, [doc("confirmation", "Versendet", 3)]))).toBeNull();
    expect(rule(project("planung", 8, [doc("confirmation", "Erstellt", 8)]))).toBe("termine_fehlen");
  });
  it("haengt nur fuer Status ohne eigene Regel, nach target_days", () => {
    expect(rule(project("druck", 7))).toBeNull();
    expect(rule(project("druck", 8))).toBe("haengt");
  });
  it("Buchhaltung ist ausgeschlossen", () => expect(rule(project("bezahlung", 99))).toBeNull());
  it("inaktive Regel wird uebersprungen", () => {
    const rs = rules.map((r) => (r.key === "haengt" ? { ...r, active: false } : r));
    expect(rule(project("druck", 20), ctx({ rules: new Map(rs.map((r) => [r.key, r])) }))).toBe("waise");
  });
  it("Waise als Auffangnetz: Regelstatus ausserhalb Sollzeit ohne passende Regel", () => {
    const c = ctx();
    const id = steps.find((x) => x.key === "freigabe")!.step_id;
    c.steps.set(id, { ...c.steps.get(id)!, target_days: 1 }); // freigabe: Sollzeit 1, Regel erst > 5
    expect(rule(project("freigabe", 3), c)).toBe("waise");
  });
  it("Aufraeumen ab mehr als 60 Tagen", () => {
    expect(evaluateProject(project("druck", 60), ctx())?.bundled).toBe(false);
    expect(evaluateProject(project("druck", 61), ctx())?.bundled).toBe(true);
  });
  it("Sortierung: Kategorie, dann naeher am Abschluss, dann laenger", () => {
    expect(priorityOf("kunde", 10, 1)).toBeLessThan(priorityOf("auftrag", 99, 99));
    expect(priorityOf("auftrag", 80, 1)).toBeLessThan(priorityOf("auftrag", 20, 99));
    expect(priorityOf("auftrag", 20, 30)).toBeLessThan(priorityOf("auftrag", 20, 3));
  });
});

describe("Status", () => {
  it("Schluessel aus dem Namen, Emoji egal", () => {
    expect(stepKey("🚧 Projektplanung")).toBe("planung");
    expect(stepKey("⏳ Warten auf Auftrag")).toBe("warten_auftrag");
    expect(stepKey("📬Anfragen")).toBe("anfragen");
    expect(stepKey("🎨 Warten auf Layoutfreigabe")).toBe("freigabe");
    expect(stepKey("💱 Fertig zur Abholung")).toBe("abholung");
    expect(stepKey("⌚ Warten auf Bezahlung")).toBe("bezahlung");
    expect(stepKey("✅ Abgeschlossen")).toBe("abgeschlossen");
    expect(stepKey("🖨 Druck")).toBe("druck");
    expect(stepKey("✂ Plott / Schnitt")).toBe("plott");
    expect(stepKey("⏲ Warten auf Ware / Daten")).toBe("ware_daten");
  });
  it("Ausschluss: Buchhaltung, Abgeschlossen, Archiviert", () => {
    for (const k of ["abrechnung", "bezahlung", "abgeschlossen", "archiviert"]) expect(defaultExcluded(k)).toBe(true);
    expect(defaultExcluded("planung")).toBe(false);
  });
});
