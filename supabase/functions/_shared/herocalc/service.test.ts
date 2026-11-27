import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOverview, runCommand, runUndo, type Ctx } from "./service.ts";
import { DOC, FakeDb, FakeHero, mkDraft } from "./testkit.ts";
import { draftHash } from "./guard.ts";

let hero: FakeHero, db: FakeDb, ctx: Ctx;
const qty = (n: number) => ({ cmd: "set_quantity" as const, position_uid: "u1", quantity: n });

beforeEach(() => {
  hero = new FakeHero(mkDraft());
  db = new FakeDb();
  ctx = { supabase: db, apiKey: "KEY", caller: "admin:admin" };
  vi.stubGlobal("fetch", hero.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("runCommand", () => {
  it("dry_run schreibt nichts (kein Speichern, keine Sicherung)", async () => {
    const r = await runCommand(ctx, DOC, qty(2), true);
    expect([r.dry_run, r.wrote, r.after.vk]).toEqual([true, false, 336]);
    expect([hero.saves, db.undo.length, db.locks.size]).toEqual([0, 0, 0]);
  });

  it("Schreiben: Sicherung mit Hash, genau ein Speichern, Sperre wieder frei", async () => {
    const before = hero.draft;
    const r: any = await runCommand(ctx, DOC, qty(2), false);
    expect([r.wrote, r.undo_id, r.before.vk, r.after.vk]).toEqual([true, 1, 168, 336]);
    expect(hero.saves).toBe(1);
    expect(hero.draft.data.items[0].items[0].quantity).toBe(2);
    expect(hero.draft.data.items[0].totals).toMatchObject({ net: 336, time: 180 }); // table.totals nachgezogen
    expect(db.undo[0]).toMatchObject({ document_id: DOC, command: "set_quantity", caller: "admin:admin", draft_hash: await draftHash(before) });
    expect(db.locks.size).toBe(0);
  });

  it("Konflikt: ändert sich der Draft zwischen Lesen und Schreiben, wird nichts geschrieben", async () => {
    hero.onGet = (n) => { if (n === 2) hero.draft.data.items[0].items[0].positions[1].quantity = 91; }; // modified bleibt gleich!
    await expect(runCommand(ctx, DOC, qty(2), false)).rejects.toThrow(/geändert/);
    expect([hero.saves, db.undo.length, db.locks.size]).toEqual([0, 0, 0]);
  });

  it("drei parallele Schreibaufrufe: genau einer läuft durch, die anderen brechen ab", async () => {
    const res = await Promise.allSettled([2, 3, 4].map((n) => runCommand(ctx, DOC, qty(n), false)));
    const ok = res.filter((r) => r.status === "fulfilled");
    const bad = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect([ok.length, bad.length]).toEqual([1, 2]);
    for (const b of bad) expect(String(b.reason.message)).toMatch(/gerade bearbeitet|geändert/);
    expect([hero.saves, db.undo.length, db.locks.size]).toEqual([1, 1, 0]);
  });

  it("lehnt Nicht-Entwürfe und ungetestete Strukturen ab, ohne zu schreiben", async () => {
    hero.draft.status_code = 1;
    await expect(runCommand(ctx, DOC, qty(2), false)).rejects.toThrow(/Kein Entwurf/);
    hero.draft.status_code = 0;
    hero.draft.data.items[0].items[0].is_fixed_net_price = true;
    await expect(runCommand(ctx, DOC, qty(2), false)).rejects.toThrow(/Festpreis/);
    expect([hero.saves, db.undo.length]).toEqual([0, 0]);
  });

  it("Sperre wird auch nach einem Fehler beim Speichern freigegeben", async () => {
    const orig = hero.fetch;
    vi.stubGlobal("fetch", async (u: string, i?: any) => (i?.method === "POST" ? new Response("x", { status: 500 }) : orig(u, i)));
    await expect(runCommand(ctx, DOC, qty(2), false)).rejects.toThrow(/ajax_save antwortete mit HTTP 500/);
    expect(db.locks.size).toBe(0);
  });
});

describe("runUndo", () => {
  it("stellt den Stand vor dem Schreiben exakt wieder her, selbst gesichert; wiederholt = idempotent", async () => {
    const original = structuredClone(hero.draft.data);
    const w: any = await runCommand(ctx, DOC, qty(2), false);
    const dry: any = await runUndo(ctx, DOC, undefined, true);
    expect([dry.wrote, dry.undo_id, dry.before.vk, dry.after.vk]).toEqual([false, w.undo_id, 336, 168]);
    expect(hero.saves).toBe(1);

    const u: any = await runUndo(ctx, DOC, undefined, false);
    expect([u.wrote, u.before.vk, u.after.vk, u.new_undo_id]).toEqual([true, 336, 168, 2]);
    expect(hero.draft.data).toEqual(original);
    expect(db.undo[1].command).toBe("undo");

    // zweites Undo ohne undo_id nimmt wieder die letzte NICHT-Undo-Sicherung (Nr. 1)
    const again: any = await runUndo(ctx, DOC, undefined, true);
    expect(again.undo_id).toBe(1);
    // gezielt auf die Undo-Sicherung (Nr. 2) -> zurück auf Menge 2
    const redo: any = await runUndo(ctx, DOC, 2, false);
    expect(redo.after.vk).toBe(336);
  });

  it("ohne Sicherung kommt ein klarer Fehler", async () => {
    await expect(runUndo(ctx, DOC, undefined, false)).rejects.toThrow(/Keine Undo-Sicherung/);
  });

  it("Undo bricht bei Änderung zwischen Lesen und Schreiben ab", async () => {
    await runCommand(ctx, DOC, qty(2), false);
    const base = hero.gets;
    hero.onGet = (n) => { if (n === base + 2) hero.draft.data.items[0].items[0].positions[0].quantity = 5; };
    await expect(runUndo(ctx, DOC, undefined, false)).rejects.toThrow(/geändert/);
    expect(hero.saves).toBe(1);
  });
});

describe("getOverview", () => {
  it("ohne include_draft nur Übersicht + Hash, mit include_draft der volle Draft", async () => {
    const o: any = await getOverview(ctx, DOC, false);
    expect(o.draft).toBeUndefined();
    expect(o.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(o.summary.vk).toBe(168);
    const full: any = await getOverview(ctx, DOC, true);
    expect(full.draft.customer_document_id).toBe(DOC);
  });
});
