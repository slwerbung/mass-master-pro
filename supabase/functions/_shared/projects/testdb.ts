// Minimale In-Memory-Datenbank fuer Tests (nur der Teil der supabase-js-API, den die Projekte-Logik braucht).

/** Minimale In-Memory-Datenbank mit dem Teil der supabase-js-API, den evaluateAll und die Aktionen brauchen. */
export function fakeDb(tables: Record<string, any[]>) {
  let seq = 0;
  class Q {
    filters: ((r: any) => boolean)[] = [];
    op: "select" | "update" | "insert" | "delete" = "select";
    payload: any; head = false; single = false; max = Infinity;
    constructor(private t: string) {}
    select(_c?: string, o?: any) { if (this.op === "select") this.head = !!o?.head; return this; }
    update(p: any) { this.op = "update"; this.payload = p; return this; }
    insert(p: any) { this.op = "insert"; this.payload = Array.isArray(p) ? p : [p]; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
    in(c: string, v: any[]) { this.filters.push((r) => v.includes(r[c])); return this; }
    gt(c: string, v: any) { this.filters.push((r) => r[c] > v); return this; }
    is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    gte(c: string, v: any) { this.filters.push((r) => r[c] >= v); return this; }
    lt(c: string, v: any) { this.filters.push((r) => r[c] < v); return this; }
    neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
    not(c: string, op: string, v: any) { if (op === "is") this.filters.push((r) => (r[c] ?? null) !== v); return this; }
    order() { return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { this.single = true; return this; }
    then(res: any, rej: any) { return Promise.resolve(this.run()).then(res, rej); }
    run() {
      const rows = (tables[this.t] ||= []);
      // Wie jsonb: Schluessel kommen in anderer Reihenfolge zurueck als geschrieben.
      const flip = (r: any) => (r && r.reasons ? { ...r, reasons: Object.fromEntries(Object.entries(r.reasons).reverse()) } : r);
      if (this.op === "insert") {
        for (const raw of this.payload) {
          const r = flip(raw);
          if (this.t === "project_cards" && ["open", "in_hero", "snoozed", "muted", "auto"].includes(r.state ?? "open")
            && rows.some((x) => x.hero_id === r.hero_id && ["open", "in_hero", "snoozed", "muted", "auto"].includes(x.state))) {
            return { data: null, error: { message: "duplicate live card" } };
          }
          rows.push({ id: `id${++seq}`, bundled: false, ...r });
        }
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "delete") { for (const r of hit) rows.splice(rows.indexOf(r), 1); return { data: null, error: null }; }
      if (this.op === "update") { hit.forEach((r) => Object.assign(r, flip(this.payload))); return { data: hit.map((r) => ({ ...r })), error: null }; }
      if (this.head) return { count: hit.length, data: null, error: null };
      return { data: this.single ? (hit[0] ?? null) : hit.slice(0, this.max).map((r) => ({ ...r })), error: null };
    }
  }
  return { from: (t: string) => new Q(t) } as any;
}
