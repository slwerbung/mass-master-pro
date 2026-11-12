import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshHeroDay } from "./hero-live.ts";

// Minimale Nachbildung des Supabase-Clients: nur die Aufrufe, die
// hero-live.ts benutzt. Schreibvorgaenge werden mitprotokolliert.
function fakeDb(tables: Record<string, any[]>) {
  const log = { upserts: [] as any[], deletes: [] as any[] };
  const from = (table: string) => {
    const filters: ((r: any) => boolean)[] = [];
    let mode: "select" | "delete" = "select";
    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
      in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return b; },
      not: (k: string) => { filters.push((r) => r[k] != null); return b; },
      gte: (k: string, v: string) => { filters.push((r) => r[k] >= v); return b; },
      lt: (k: string, v: string) => { filters.push((r) => r[k] < v); return b; },
      upsert: (rows: any[]) => { log.upserts.push(...rows); return Promise.resolve({ error: null }); },
      delete: () => { mode = "delete"; return b; },
      rows: () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r))),
      maybeSingle: () => Promise.resolve({ data: b.rows()[0] ?? null }),
      then: (res: any, rej: any) => {
        if (mode === "delete") log.deletes.push(...b.rows().map((r: any) => r.id));
        return Promise.resolve({ data: b.rows(), error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { db: { from }, log };
}

function mockHero(events: any[], absences: any[] = []) {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const data = body.query.includes("calendar_events") ? { calendar_events: events } : { absences };
    return new Response(JSON.stringify({ data }), { status: 200 });
  }));
}

const basis = {
  app_config: [],
  staff: [{ id: "s1", employee_id: "e1" }],
  employees: [{ id: "e1", hero_partner_id: 77 }],
  booking: [{ hero_event_ref: "900", status: "confirmed" }],
};
// 12.11.2026, Berliner Mitternacht (Winterzeit) = 23:00 UTC am Vortag.
const TAG = "2026-11-11T23:00:00.000Z";

afterEach(() => vi.unstubAllGlobals());

describe("refreshHeroDay", () => {
  it("sperrt einen frisch in HERO angelegten Termin sofort, in Ortszeit gelesen", async () => {
    mockHero([
      { id: 501, start: "2026-11-12T14:00:00+00:00", end: "2026-11-12T16:30:00+00:00", partners: [{ id: 77 }], category: { id: 4408 } },
      // anderer Mitarbeiter: geht ihn nichts an
      { id: 502, start: "2026-11-12T09:00:00+00:00", end: "2026-11-12T10:00:00+00:00", partners: [{ id: 12 }] },
      // unsere eigene Buchung: steht schon als source='booking' im Weg
      { id: 900, start: "2026-11-12T08:00:00+00:00", end: "2026-11-12T09:00:00+00:00", partners: [{ id: 77 }] },
      // geloescht
      { id: 503, start: "2026-11-12T11:00:00+00:00", end: "2026-11-12T12:00:00+00:00", partners: [{ id: 77 }], deleted: true },
    ]);
    const { db, log } = fakeDb({ ...basis, busy_block: [] });
    const r = await refreshHeroDay(db, "key", "s1", TAG);
    expect(r.ok).toBe(true);
    expect(log.upserts).toEqual([expect.objectContaining({
      staff_id: "s1", source: "hero", source_ref: "501",
      // 14:00 Ortszeit im November = 13:00 UTC (nicht 14:00 UTC)
      starts_at: "2026-11-12T13:00:00.000Z", ends_at: "2026-11-12T15:30:00.000Z",
      category_key: "hero:4408",
    })]);
  });

  it("entfernt Sperren des Tages, die es in HERO nicht mehr gibt", async () => {
    mockHero([]);
    const { db, log } = fakeDb({
      ...basis,
      busy_block: [
        { id: "b1", source: "hero", source_ref: "600", staff_id: "s1", starts_at: "2026-11-12T08:00:00.000Z" },
        // anderer Tag: bleibt
        { id: "b2", source: "hero", source_ref: "601", staff_id: "s1", starts_at: "2026-11-13T08:00:00.000Z" },
        // anderer Mitarbeiter: bleibt
        { id: "b3", source: "hero", source_ref: "602", staff_id: "s2", starts_at: "2026-11-12T08:00:00.000Z" },
      ],
    });
    await refreshHeroDay(db, "key", "s1", TAG);
    expect(log.deletes).toEqual(["b1"]);
  });

  it("nimmt Urlaub mit und laesst Urlaubssperren stehen, wenn die Abwesenheiten nicht ladbar sind", async () => {
    mockHero([], [{ id: 5, partner_id: 77, start: "2026-11-12", end: "2026-11-12" }]);
    const ok = fakeDb({ ...basis, busy_block: [] });
    await refreshHeroDay(ok.db, "key", "s1", TAG);
    expect(ok.log.upserts[0]).toMatchObject({ source_ref: "abs-5", category_key: null });

    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) =>
      JSON.parse(init.body).query.includes("absences")
        ? new Response("kaputt", { status: 500 })
        : new Response(JSON.stringify({ data: { calendar_events: [] } }), { status: 200 })));
    const kaputt = fakeDb({
      ...basis,
      busy_block: [{ id: "a1", source: "hero", source_ref: "abs-5", staff_id: "s1", starts_at: "2026-11-11T23:00:00.000Z" }],
    });
    const r = await refreshHeroDay(kaputt.db, "key", "s1", TAG);
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/Abwesenheiten/);
    expect(kaputt.log.deletes).toEqual([]);
  });

  it("bricht bei HERO-Fehlern nicht ab, sondern meldet nur", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const { db, log } = fakeDb({ ...basis, busy_block: [] });
    const r = await refreshHeroDay(db, "key", "s1", TAG);
    expect(r.ok).toBe(false);
    expect(log.upserts).toEqual([]);
    expect(log.deletes).toEqual([]);
  });

  it("tut nichts ohne HERO-Partner-ID oder ohne HERO", async () => {
    mockHero([]);
    const { db } = fakeDb({ ...basis, employees: [{ id: "e1", hero_partner_id: null }] });
    expect((await refreshHeroDay(db, "key", "s1", TAG)).skipped).toBeTruthy();
    expect((await refreshHeroDay(db, null, "s1", TAG)).skipped).toBeTruthy();
  });
});
