import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allOk, runContract, runPureChecks, runSelftest } from "./contract.ts";
import { DOC, FakeDb, FakeHero, mkDraft } from "./testkit.ts";
import type { Ctx } from "./service.ts";

let hero: FakeHero, db: FakeDb, ctx: Ctx;
beforeEach(() => {
  hero = new FakeHero(mkDraft());
  db = new FakeDb();
  ctx = { supabase: db, apiKey: "KEY", caller: "cron:test" };
  vi.stubGlobal("fetch", hero.fetch);
});
afterEach(() => vi.unstubAllGlobals());

const failed = (steps: any[]) => steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.detail}`);

describe("Vertragstest", () => {
  it("läuft gegen ein HERO wie live grün und stellt den Entwurf exakt wieder her", async () => {
    const before = structuredClone(hero.draft.data);
    const steps = await runContract(ctx);
    expect(failed(steps)).toEqual([]);
    expect(allOk(steps)).toBe(true);
    expect(hero.draft.data).toEqual(before);
    expect(db.locks.size).toBe(0);
    expect(hero.saves).toBe(2); // Änderung + Rückgängig
  });

  it("wird rot, wenn HERO den Endpoint ändert (kein DocumentStore mehr)", async () => {
    vi.stubGlobal("fetch", async () => new Response("<div id=\"EditorApp\"></div>"));
    const steps = await runContract(ctx);
    expect(allOk(steps)).toBe(false);
    expect(failed(steps)[0]).toMatch(/DocumentStore/);
  });

  it("wird rot, wenn HERO die Werte beim Speichern verändert", async () => {
    const orig = hero.fetch;
    vi.stubGlobal("fetch", async (u: string, i?: any) => {
      if (i?.method === "POST") {
        const b = JSON.parse(i.body);
        b.draft.data.totals.net += 1; // HERO "rechnet" anders
        return orig(u, { ...i, body: JSON.stringify(b) });
      }
      return orig(u, i);
    });
    const steps = await runContract(ctx);
    expect(allOk(steps)).toBe(false);
    expect(hero.saves).toBeGreaterThanOrEqual(2); // Rückgängig wurde trotzdem versucht
  });

  it("verweigert fremde Projekte und Nicht-Entwürfe, ohne zu schreiben", async () => {
    hero.html = function () {
      return `<script>"DocumentStore":${JSON.stringify({ draft: this.draft, document: { id: DOC, project_match_id: 999 } })}</script>`;
    };
    expect(failed(await runContract(ctx))[0]).toMatch(/nicht zu WER-1984/);
    expect([hero.saves, db.undo.length]).toEqual([0, 0]);
  });

  it("lehnt einen Testentwurf mit Rabatt ab (Vorbedingung)", async () => {
    hero.draft.data.items[0].items[0].sales = 5;
    expect(failed(await runContract(ctx))[0]).toMatch(/keinen Rabatt/);
    expect(hero.saves).toBe(0);
  });
});

describe("Selbsttest", () => {
  it("table.totals und parallele Aufrufe grün, Entwurf danach identisch", async () => {
    const before = structuredClone(hero.draft.data);
    const steps = await runSelftest(ctx, [DOC]);
    expect(failed(steps)).toEqual([]);
    expect(steps.map((s) => s.name).some((n) => n.startsWith("parallel"))).toBe(true);
    expect(hero.draft.data).toEqual(before);
    expect(db.locks.size).toBe(0);
  });

  it("wird rot, wenn die Sperre fehlt (zwei gleichzeitige Schreiber kämen durch)", async () => {
    db.rpc = async () => ({ data: true, error: null }); // Sperre immer frei
    const steps = await runSelftest(ctx, [DOC]);
    expect(allOk(steps)).toBe(false);
    expect(failed(steps).join(" ")).toMatch(/parallel/);
  });
});

describe("Rechenfälle im Speicher (runPureChecks)", () => {
  it("alle fünf Fälle grün, nichts wird in HERO geschrieben", async () => {
    const steps = await runPureChecks(ctx);
    expect(failed(steps)).toEqual([]);
    expect(steps.length).toBeGreaterThanOrEqual(5);
    expect(steps.map((x) => x.name).join("|")).toMatch(/Netto 270,90.*Festpreis.*eigener Preis ohne Werte.*bereinigen.*recalc ohne Änderung/);
    expect(hero.saves).toBe(0);
  });
  it("wird rot, wenn die Rechenregel abweicht (z. B. Rabatt je Einheit statt auf die Gesamtsumme)", async () => {
    vi.stubGlobal("fetch", async () => new Response("<div></div>"));
    const steps = await runPureChecks(ctx);
    expect(allOk(steps)).toBe(false);
  });
});
