// Rechenkern für HERO-Detailkalkulationen (Spec 2.4). Reine Funktionen, keine I/O, kein Deno-spezifischer Code.
// Das HERO-Frontend rechnet, der Server nicht: alle Summen müssen hier konsistent gesetzt werden.

export const round2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;

export const round4 = (x: number): number => Math.round((x + Number.EPSILON) * 10000) / 10000;

const pct = (vk: number, ek: number): number => (ek === 0 ? 0 : round2(((vk - ek) / ek) * 100));

export interface Line {
  vk: number;
  ek: number;
  minutes: number;
  isWage: boolean;
}

/** Materialzeile: VK = q*net_price_per_unit, EK = q*base_price. Mutiert die Position. */
export function recalcMaterial(p: any): Line {
  const q = Number(p.quantity);
  const vk = round2(q * Number(p.net_price_per_unit));
  const ek = round2(q * Number(p.base_price));
  p.marge = pct(vk, ek);
  return { vk, ek, minutes: 0, isWage: false };
}

/** Lohnzeile: quantity = Minuten; Sätze (EK/h, VK/h) kommen aus wage_cost_price / wage_per_hour. */
export function recalcWage(p: any): Line {
  const m = Number(p.quantity);
  const ekH = Number(p.wage_cost_price);
  const vkH = Number(p.wage_per_hour);
  p.time_minutes = m;
  p.base_price = round4(ekH / 60); // live: 0.3733 (4 Nachkommastellen)
  p.net_price_per_unit = round4(vkH / 60);
  p.marge = pct(vkH, ekH);
  return { vk: round2((m / 60) * vkH), ek: round2((m / 60) * ekH), minutes: m, isWage: true };
}

export interface Totals {
  vk: number; ek: number; minutes: number; wageVk: number; wageEk: number;
  materialVk: number; materialEk: number;
}

export function recalcService(s: any): Totals {
  if (Number(s.quantity ?? 1) !== 1) {
    // Mengenfaktor der Leistung ist laut Spec 5.3 noch nicht getestet -> nicht raten.
    throw new Error(`Leistung ${s.uid}: quantity ${s.quantity} != 1 ist noch nicht unterstützt`);
  }
  const t: Totals = { vk: 0, ek: 0, minutes: 0, wageVk: 0, wageEk: 0, materialVk: 0, materialEk: 0 };
  for (const p of s.positions ?? []) {
    const l = p.atType === 'WageGroup' ? recalcWage(p) : recalcMaterial(p);
    t.vk += l.vk; t.ek += l.ek; t.minutes += l.minutes;
    if (l.isWage) { t.wageVk += l.vk; t.wageEk += l.ek; } else { t.materialVk += l.vk; t.materialEk += l.ek; }
  }
  for (const k of Object.keys(t) as (keyof Totals)[]) t[k] = round2(t[k]);
  s.net_price_per_unit = t.vk;
  s.base_price = t.ek;
  s.marge = pct(t.vk, t.ek);
  s.time_minutes = t.minutes;
  s.wage_costs = t.wageVk;
  s.wage_base = t.wageEk;
  return t;
}

const vatOf = (s: any): number => Number(s.vat_percent ?? 19);

/** Rechnet Tabelle(n) und Dokument komplett neu. Mutiert den Draft und gibt eine Kurzfassung zurück. */
export function recalcDraft(draft: any) {
  const data = draft.data;
  const byVat = new Map<number, { net: number; base: number; wage: number }>();
  const sum = { vk: 0, ek: 0, minutes: 0, wageVk: 0, wageEk: 0, materialVk: 0, materialEk: 0 };

  for (const table of data.items ?? []) {
    if (table.type !== 'table') continue;
    const tt = { vk: 0, ek: 0, minutes: 0, wageVk: 0, wageEk: 0 };
    const tVk: Record<string, number> = {}, tEk: Record<string, number> = {}, tWageVat: Record<string, number> = {};
    for (const s of table.items ?? []) {
      const t = recalcService(s);
      const v = vatOf(s);
      const e = byVat.get(v) ?? { net: 0, base: 0, wage: 0 };
      e.net += t.vk; e.base += t.ek; e.wage += t.wageVk;
      byVat.set(v, e);
      tVk[v] = (tVk[v] ?? 0) + t.vk; tEk[v] = (tEk[v] ?? 0) + t.ek; tWageVat[v] = (tWageVat[v] ?? 0) + t.wageVk * (v / 100);
      tt.vk += t.vk; tt.ek += t.ek; tt.minutes += t.minutes; tt.wageVk += t.wageVk; tt.wageEk += t.wageEk;
      for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += (t as any)[k];
    }
    table.total_sum = round2(tt.vk);
    table.totalTime = tt.minutes;
    table.totalBasePrice = round2(tt.ek);
    table.totalWageCosts = round2(tt.wageVk);
    table.total = Object.fromEntries(Object.entries(tVk).map(([k, v]) => [k, round2(v)]));
    table.totalBaseVat = Object.fromEntries(Object.entries(tEk).map(([k, v]) => [k, round2(v)]));
    table.totalWageVat = round2(Object.values(tWageVat).reduce((a, b) => a + b, 0));
  }

  const net = round2(sum.vk);
  const vat = round2([...byVat].reduce((a, [v, e]) => a + e.net * (v / 100), 0));
  data.totals = {
    ...(data.totals ?? {}),
    base: round2(sum.ek), net, time: sum.minutes,
    wage: round2(sum.wageVk), wage_base: round2(sum.wageEk),
    material: round2(sum.materialVk), material_base: round2(sum.materialEk),
    byVat: [...byVat].map(([v, e]) => ({ vat: v, net: round2(e.net), base: round2(e.base), wage: round2(e.wage) })),
    vat,
  };
  data.total_price = round2(net + vat);
  data.total_vat = vat;
  if ("value" in draft) draft.value = net; // live: value == Netto

  return summarize(draft);
}

/** Vorher/Nachher-Kennzahlen (EK, VK, Aufschlag, Netto, Brutto). */
export function summarize(draft: any) {
  const t = draft.data.totals;
  return {
    ek: t.base, vk: t.net, aufschlag_pct: pct(t.net, t.base),
    netto: t.net, mwst: draft.data.total_vat, brutto: draft.data.total_price,
  };
}
