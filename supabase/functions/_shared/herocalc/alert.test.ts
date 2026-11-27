import { describe, expect, it, vi } from "vitest";
import { alertOnFailure, buildAlert, ALERT_MAIL_TO } from "./alert.ts";
import type { Step } from "./contract.ts";

class Q {
  private filters: Array<(r: any) => boolean> = []; private op: "select" | "update" | "delete" = "select"; private patch: any; private lim = Infinity; private one = false;
  constructor(private db: FakeSb, private table: string) {}
  select(_c?: string) { return this; }
  update(p: any) { this.op = "update"; this.patch = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this; }
  in(k: string, vs: any[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
  gt(k: string, v: any) { this.filters.push((r) => r[k] > v); return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.one = true; return this; }
  then(res: any, rej?: any) { return Promise.resolve(this.run()).then(res, rej); }
  private run() {
    const rows = this.db.t[this.table]; const m = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") { m.forEach((r) => Object.assign(r, this.patch)); return { data: null, error: null }; }
    if (this.op === "delete") { this.db.t[this.table] = rows.filter((r) => !m.includes(r)); return { data: null, error: null }; }
    const out = m.slice(0, this.lim);
    return { data: this.one ? (out[0] ?? null) : out, error: null };
  }
}
class FakeSb {
  t: Record<string, any[]> = { profiles: [], email_push_subscriptions: [], email_config: [], hero_calc_contract_log: [] };
  from = (table: string) => new Q(this, table);
}

const NOW = Date.parse("2026-11-27T01:47:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const red: Step[] = [{ name: "schreiben (ajax_save)", ok: false, detail: "HERO ajax_save antwortete mit HTTP 500" }, { name: "lesen", ok: true, detail: "" }];
const okSteps: Step[] = [{ name: "lesen", ok: true, detail: "" }];
const okFetch = () => vi.fn(async () => new Response("{}", { status: 200 }));

describe("buildAlert", () => {
  it("kurzer Text, höchstens 5 Zeilen, Details gekürzt, keine Zugangsdaten", () => {
    const many: Step[] = Array.from({ length: 8 }, (_, i) => ({ name: `schritt ${i}`, ok: false, detail: "x".repeat(400) }));
    const a = buildAlert("contract", many);
    expect(a.title).toBe("hero-calc Vertragstest ROT");
    expect(a.text).toContain("… und 3 weitere");
    expect(a.text.split("\n").filter((l) => l.startsWith("- ")).length).toBe(5);
    expect(a.text).not.toContain("x".repeat(170));
    expect(a.body.length).toBeLessThanOrEqual(300);
  });
});

describe("alertOnFailure", () => {
  it("grüner Lauf: keine Meldung", async () => {
    const f = okFetch();
    const r = await alertOnFailure(new FakeSb(), 1, "contract", okSteps, { fetchFn: f, resendKey: "RK", now: NOW });
    expect([r.alerted, r.reason]).toEqual([false, "ok"]);
    expect(f).not.toHaveBeenCalled();
  });

  it("roter Lauf ohne Push-Geräte: Mail an info@slwerbung.de, Zeile als gemeldet markiert, kein Schlüssel im Text", async () => {
    const sb = new FakeSb(); sb.t.hero_calc_contract_log.push({ id: 7, created_at: hoursAgo(0), alerted: false });
    const f = okFetch();
    const r = await alertOnFailure(sb, 7, "contract", red, { fetchFn: f, resendKey: "SECRET-RK", now: NOW });
    expect([r.alerted, r.mail, r.push, r.reason]).toEqual([true, true, 0, "sent"]);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, any];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer SECRET-RK");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual([ALERT_MAIL_TO]);
    expect(body.subject).toBe("hero-calc Vertragstest ROT");
    expect(body.text).toContain("schreiben (ajax_save)");
    expect(init.body).not.toContain("SECRET-RK");
    expect(sb.t.hero_calc_contract_log[0].alerted).toBe(true);
  });

  it("höchstens eine Meldung je 24 h", async () => {
    const sb = new FakeSb(); sb.t.hero_calc_contract_log.push({ id: 1, created_at: hoursAgo(2), alerted: true });
    const f = okFetch();
    const r = await alertOnFailure(sb, 2, "contract", red, { fetchFn: f, resendKey: "RK", now: NOW });
    expect([r.alerted, r.reason]).toEqual([false, "throttled"]);
    expect(f).not.toHaveBeenCalled();
    // älter als 24 h: wieder melden
    const sb2 = new FakeSb(); sb2.t.hero_calc_contract_log.push({ id: 1, created_at: hoursAgo(30), alerted: true });
    expect((await alertOnFailure(sb2, 2, "contract", red, { fetchFn: okFetch(), resendKey: "RK", now: NOW })).alerted).toBe(true);
  });

  it("Push an alle Admin-Geräte, abgelaufene Abos werden gelöscht, Mail geht zusätzlich raus", async () => {
    const sb = new FakeSb();
    sb.t.profiles.push({ id: "u-admin", role: "admin", is_active: true }, { id: "u-ma", role: "mitarbeiter", is_active: true });
    sb.t.email_config.push({ key: "push_vapid", value: { publicKey: "pub", privateJwk: {}, subject: "mailto:x" } });
    sb.t.email_push_subscriptions.push(
      { id: "s1", user_id: "u-admin", endpoint: "https://push/1", p256dh: "a", auth: "b", failures: 0 },
      { id: "s2", user_id: "u-admin", endpoint: "https://push/2", p256dh: "a", auth: "b", failures: 0 },
      { id: "s3", user_id: "u-ma", endpoint: "https://push/3", p256dh: "a", auth: "b", failures: 0 },
    );
    const sendPushFn = vi.fn(async (sub: any) => (sub.id === "s2" ? { ok: false, gone: true } : { ok: true })) as any;
    const r = await alertOnFailure(sb, null, "contract", red, { fetchFn: okFetch(), resendKey: "RK", sendPushFn, now: NOW });
    expect([r.push, r.mail, r.alerted]).toEqual([1, true, true]);
    expect(sendPushFn).toHaveBeenCalledTimes(2); // nur Admin-Geräte
    expect(sendPushFn.mock.calls[0][1]).toMatchObject({ title: "hero-calc Vertragstest ROT", tag: "hero-calc-contract" });
    expect(sb.t.email_push_subscriptions.map((s) => s.id).sort()).toEqual(["s1", "s3"]);
  });

  it("kein Kanal funktioniert: nicht als gemeldet markiert (nächster Lauf versucht es erneut), Fehler gemeldet", async () => {
    const sb = new FakeSb(); sb.t.hero_calc_contract_log.push({ id: 5, created_at: hoursAgo(0), alerted: false });
    const r = await alertOnFailure(sb, 5, "contract", red, { fetchFn: okFetch(), resendKey: null, now: NOW });
    expect([r.alerted, r.reason]).toEqual([false, "no_channel_worked"]);
    expect(r.errors.join(" ")).toContain("RESEND_API_KEY fehlt");
    expect(sb.t.hero_calc_contract_log[0].alerted).toBe(false);
    const bad = await alertOnFailure(sb, 5, "contract", red, { fetchFn: vi.fn(async () => new Response("no", { status: 500 })), resendKey: "RK", now: NOW });
    expect(bad.alerted).toBe(false);
    expect(bad.errors.join(" ")).toContain("Resend HTTP 500");
  });
});
