import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/session", () => ({ getSession: () => ({ authToken: "TOKEN" }) }));

import { locationCustomerSource, locationEmployeeSource, vehicleCustomerSource, vehicleEmployeeSource } from "./sources";

const rect = { v: 1 as const, color: "#E11D48", shapes: [{ t: "rect" as const, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] };
const ref = { kind: "pdf" as const, storagePath: "pdfs/a.pdf", page: 1 };
const files = [{ storagePath: "pdfs/a.pdf", kind: "pdf" as const, name: "a.pdf" }] as any;

/** Gemockter Supabase-Client: zeichnet Tabellen-Aufrufe und Function-Aufrufe auf. */
function fakeClient(opts: { rows?: any[]; fnData?: any; fnError?: any; dbError?: any } = {}) {
  const calls: { table?: string; fn?: string; ops: [string, ...any[]][]; body?: any }[] = [];
  const builder = (table: string) => {
    const c = { table, ops: [] as [string, ...any[]][] };
    calls.push(c);
    const q: any = {};
    for (const m of ["select", "eq", "order", "insert", "update", "delete", "single"]) {
      q[m] = (...a: any[]) => { c.ops.push([m, ...a]); return q; };
    }
    q.then = (res: any, rej: any) => Promise.resolve(opts.dbError ? { data: null, error: opts.dbError } : { data: c.ops.some(([m]) => m === "insert") ? { id: "new" } : opts.rows ?? [], error: null }).then(res, rej);
    return q;
  };
  const sb: any = {
    from: builder,
    functions: { invoke: async (fn: string, { body }: any) => { calls.push({ fn, ops: [], body }); return { data: opts.fnData ?? { ok: true }, error: opts.fnError ?? null }; } },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
  return { sb, calls };
}

describe("Prüfmodus-Datenquellen (Spec C)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Standort × Kunde: liest sortiert, schreibt über customer-data mit Token, Markierung nur mit Dateibezug", async () => {
    const { sb, calls } = fakeClient({ rows: [{ id: "2", created_at: "2026-11-02" }, { id: "1", created_at: "2026-11-01" }], fnData: { feedback: { id: "f" } } });
    const s = locationCustomerSource({ locationId: "L", assignmentId: "A", files, customerId: "C", authorName: "Kunde", sb });
    expect((await s.list()).map((r) => r.id)).toEqual(["1", "2"]);
    expect(await s.create({ message: "bitte rot", markup: rect, mediaRef: ref })).toEqual({ id: "f" });
    const body = calls.find((c) => c.fn)!.body;
    expect(body).toMatchObject({ action: "create_feedback", customerToken: "TOKEN", assignmentId: "A", locationId: "L", markup: rect, mediaRef: ref });
    await s.create({ message: "nur Text", mediaRef: ref });
    expect(calls.filter((c) => c.fn).at(-1)!.body.mediaRef).toBeUndefined();
    expect(s.isOwn({ author_type: "customer", author_customer_id: "C" } as any)).toBe(true);
    expect(s.isOwn({ author_type: "employee", author_customer_id: "C" } as any)).toBe(false);
  });

  it("Standort × Kunde: ungültige Markierung wird vor dem Senden abgelehnt", async () => {
    const { sb, calls } = fakeClient();
    const s = locationCustomerSource({ locationId: "L", assignmentId: "A", files, customerId: "C", authorName: "K", sb });
    await expect(s.create({ message: "x", markup: { v: 1, color: "#E11D48", shapes: [] } as any, mediaRef: ref })).rejects.toThrow();
    expect(calls.filter((c) => c.fn)).toHaveLength(0);
  });

  it("Standort × Mitarbeiter: alles über location-feedback, Fehlermeldung des Servers kommt an", async () => {
    const { sb, calls } = fakeClient({ fnData: { messages: [{ id: "b", created_at: "2" }, { id: "a", created_at: "1" }] } });
    const s = locationEmployeeSource({ locationId: "L", files, authorName: "Max", sb });
    expect((await s.list()).map((r) => r.id)).toEqual(["a", "b"]);
    await s.toggle!("a", "done");
    expect(calls.at(-1)!.body).toMatchObject({ token: "TOKEN", action: "toggle", locationId: "L", id: "a", status: "done" });
    await expect(s.update("a", { message: "nur Text" })).rejects.toThrow("Nur die Markierung");
    const bad = fakeClient({ fnData: { error: "Kein Zugriff." } });
    await expect(locationEmployeeSource({ locationId: "L", files, authorName: "Max", sb: bad.sb }).list()).rejects.toThrow("Kein Zugriff.");
  });

  it("Fahrzeug × Kunde: direkter Insert mit Kunden-ID; Antworten tragen nie Markierung/Bezug; Ändern nur offene", async () => {
    const { sb, calls } = fakeClient();
    const s = vehicleCustomerSource({ projectId: "P", files, customerId: "C", authorName: "Kunde", sb });
    await s.create({ message: "  Logo größer  ", markup: rect, mediaRef: ref });
    const ins = calls.at(-1)!.ops.find(([m]) => m === "insert")![1];
    expect(ins).toMatchObject({ project_id: "P", message: "Logo größer", author_type: "customer", author_customer_id: "C", markup: rect, media_ref: ref, parent_id: null });
    await s.create({ message: "Antwort", parentId: "X", markup: rect, mediaRef: ref });
    expect(calls.at(-1)!.ops.find(([m]) => m === "insert")![1]).toMatchObject({ parent_id: "X", markup: null, media_ref: null });
    await s.update("X", { message: "neu" });
    expect(calls.at(-1)!.ops).toContainEqual(["eq", "status", "open"]);
    expect(s.toggle).toBeUndefined();
  });

  it("Fahrzeug × Mitarbeiter: Status umschalten setzt resolved_at; DB-Fehler werden geworfen", async () => {
    const { sb, calls } = fakeClient();
    const s = vehicleEmployeeSource({ projectId: "P", files, authorName: "Max", sb });
    await s.toggle!("X", "done");
    const upd = calls.at(-1)!.ops.find(([m]) => m === "update")![1];
    expect(upd.status).toBe("done");
    expect(typeof upd.resolved_at).toBe("string");
    await s.toggle!("X", "open");
    expect(calls.at(-1)!.ops.find(([m]) => m === "update")![1]).toEqual({ status: "open", resolved_at: null });
    const bad = fakeClient({ dbError: { message: "RLS" } });
    await expect(vehicleEmployeeSource({ projectId: "P", files, authorName: "M", sb: bad.sb }).list()).rejects.toThrow("RLS");
  });
});
