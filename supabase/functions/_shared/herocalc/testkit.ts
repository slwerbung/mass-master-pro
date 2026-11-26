// Test-Hilfen: simuliertes HERO (Edit-Seite + ajax_save) und simulierte Datenbank (Sperre, Undo). Nur für Tests.
import { recalcDraft } from "./calc.ts";

export const DOC = 22589010;

export function mkDraft(): any {
  const d: any = {
    id: 100, customer_document_id: DOC, modified: "t0", status_code: 0, value: 0,
    data: { version: 38, totals: {}, items: [{ type: "table", items: [{ atType: "SupplyService", uid: "u1", quantity: 1, vat_percent: 19, positions: [
      { atType: "SupplyProduct", id: "p1", quantity: 2, base_price: 15, net_price_per_unit: 30 },
      { atType: "WageGroup", id: 6824, quantity: 90, wage_cost_price: 22.4, wage_per_hour: 72 },
    ] }] }] },
  };
  recalcDraft(d);
  return d;
}

/** Simuliertes HERO: Edit-Seite (GET) und ajax_save (POST) wie live – neue Draft-id und neues modified bei jedem Speichern. */
export class FakeHero {
  saves = 0; gets = 0; counter = 0;
  onGet: ((n: number) => void) | null = null;
  constructor(public draft: any) {}
  html() {
    const store = { draft: this.draft, document: { id: DOC, project_match_id: 12886720 } };
    return `<html><script>var s={"x":1,"DocumentStore":${JSON.stringify(store)},"y":2};</script></html>`;
  }
  fetch = async (_url: string, init?: any) => {
    await Promise.resolve();
    if (init?.method === "POST") {
      const body = JSON.parse(init.body);
      this.saves++; this.counter++;
      this.draft = { ...body.draft, id: body.draft.id + 1, modified: `t${this.counter}` };
      return new Response(JSON.stringify(this.draft));
    }
    this.gets++;
    this.onGet?.(this.gets);
    return new Response(this.html());
  };
}

class UndoQuery {
  private ins: any; private filters: Array<(r: any) => boolean> = []; private desc = false; private lim = Infinity; private one = false;
  constructor(private db: FakeDb) {}
  insert(row: any) { this.ins = row; return this; }
  select(_c?: string) { return this; }
  single() { this.one = true; return this; }
  eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this; }
  neq(k: string, v: any) { this.filters.push((r) => r[k] !== v); return this; }
  order(_k: string, o: any) { this.desc = o?.ascending === false; return this; }
  limit(n: number) { this.lim = n; return this; }
  then(res: any, rej?: any) { return Promise.resolve(this.run()).then(res, rej); }
  private run() {
    if (this.ins) {
      const row = { id: ++this.db.seq, created_at: "now", ...this.ins };
      this.db.undo.push(row);
      return { data: this.one ? { id: row.id } : [{ id: row.id }], error: null };
    }
    const rows = this.db.undo.filter((r) => this.filters.every((f) => f(r)))
      .sort((a, b) => (this.desc ? b.id - a.id : a.id - b.id)).slice(0, this.lim);
    return { data: rows, error: null };
  }
}

export class FakeDb {
  locks = new Map<number, number>(); undo: any[] = []; seq = 0;
  rpc = async (name: string, args: any) => {
    await Promise.resolve();
    if (name === "hero_calc_acquire_lock") {
      const until = this.locks.get(args.p_document_id);
      if (until !== undefined && until > Date.now()) return { data: false, error: null };
      this.locks.set(args.p_document_id, Date.now() + args.p_seconds * 1000);
      return { data: true, error: null };
    }
    this.locks.delete(args.p_document_id);
    return { data: null, error: null };
  };
  from = (_t: string) => new UndoQuery(this);
}

