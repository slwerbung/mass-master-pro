// Rechenkern für HERO-Detailkalkulationen (Spec 2.4). Reine Funktionen, keine I/O, kein Deno-spezifischer Code.
// Das HERO-Frontend rechnet, der Server nicht: alle Summen müssen hier konsistent gesetzt werden.

// Live belegt: HERO rundet 9.405 auf 9.41. Binär ist 9.405*100 = 940.4999999999999, daher erst auf 12
// signifikante Stellen glätten, dann kaufmännisch runden.
const roundTo = (x: number, digits: number): number => {
  const f = Math.pow(10, digits);
  return Math.round(Number((x * f).toPrecision(12))) / f;
};

/** Abschneiden (nicht runden) auf 4 Stellen: HERO speichert den EK je Leistung abgeschnitten (live: 20.21667 -> 20.2166). */
const floor4 = (x: number): number => Math.floor(Number((x * 1e4).toPrecision(12))) / 1e4;

export const round2 = (x: number): number => roundTo(x, 2);

export const round4 = (x: number): number => roundTo(x, 4);

const pct = (vk: number, ek: number): number => (ek === 0 ? 0 : round2(((vk - ek) / ek) * 100));

export interface Line {
  vk: number;
  ek: number;
  minutes: number;
  isWage: boolean;
}

/**
 * Materialzeile: VK = q*net_price_per_unit (je Zeile auf 2 Stellen, live belegt an 13 HERO-Positionen),
 * EK = q*base_price (auf 4 Stellen, live belegt: HERO speichert EK 85.7732). Mutiert die Position.
 */
export function recalcMaterial(p: any): Line {
  const q = Number(p.quantity);
  const vk = round2(q * Number(p.net_price_per_unit));
  const ek = round4(q * Number(p.base_price));
  p.marge = pct(vk, ek);
  return { vk, ek, minutes: 0, isWage: false };
}

/** Lohnzeile: quantity = Minuten. Lohn-EK bleibt exakt (live belegt: HERO summiert ihn ungerundet), siehe recalcService. */
export function recalcWage(p: any): Line {
  const m = Number(p.quantity);
  const ekH = Number(p.wage_cost_price);
  const vkH = Number(p.wage_per_hour);
  p.time_minutes = m;
  p.base_price = round4(ekH / 60); // live: 0.3733 (4 Nachkommastellen)
  p.net_price_per_unit = round4(vkH / 60);
  p.marge = pct(vkH, ekH);
  return { vk: round2((m / 60) * vkH), ek: (m / 60) * ekH, minutes: m, isWage: true };
}

export interface Totals {
  vk: number; ek: number; minutes: number; wageVk: number; wageEk: number;
  materialVk: number; materialEk: number; discount: number;
}

// EK-Summen werden auf 4 Stellen gehalten (wie HERO), alle anderen auf 2.
const EK4 = new Set<string>(["ek", "materialEk"]);
const roundTotal = (k: string, v: number): number => (EK4.has(k) ? round4(v) : round2(v));

export function recalcService(s: any): Totals {
  // Menge der Leistung (live belegt, Spec 5.3): Felder an der Leistung bleiben je EINE Einheit; Tabelle/Dokument rechnen Menge * Einheit.
  const q = Number(s.quantity ?? 1);
  if (!Number.isFinite(q) || q <= 0) throw new Error(`Leistung ${s.uid}: quantity ${s.quantity} ungültig`);
  // Rabatt bei Menge != 1 ist noch nicht mit der HERO-Oberfläche verglichen -> nicht raten.
  if (q !== 1 && Number(s.sales) > 0) {
    throw new Error(`Leistung ${s.uid}: Rabatt bei quantity ${q} != 1 ist noch nicht unterstützt`);
  }
  const t: Totals = { vk: 0, ek: 0, minutes: 0, wageVk: 0, wageEk: 0, materialVk: 0, materialEk: 0, discount: 0 };
  for (const p of s.positions ?? []) {
    const l = p.atType === 'WageGroup' ? recalcWage(p) : recalcMaterial(p);
    t.vk += l.vk; t.ek += l.ek; t.minutes += l.minutes;
    if (l.isWage) { t.wageVk += l.vk; t.wageEk += l.ek; } else { t.materialVk += l.vk; t.materialEk += l.ek; }
  }
  // Live belegt (WER-1984, 2 Leistungen, Menge 3): EK je Leistung = Summe der Zeilen ABGESCHNITTEN auf 4 Stellen
  // (A 49.08253 -> 49.0825, B 20.21667 -> 20.2166); Dokument = Summe (EK je Leistung * Menge) = 109.7323.
  // Lohn-EK je Leistung auf 2 Stellen (2.61 / 7.72 / 3.73), Material-EK = EK - Lohn-EK.
  t.ek = floor4(t.ek);
  t.wageEk = round2(t.wageEk);
  t.materialEk = round4(t.ek - t.wageEk);
  for (const k of Object.keys(t) as (keyof Totals)[]) t[k] = roundTotal(k, t[k]);
  // Positionsrabatt in Prozent (live belegt, Spec 5.2): service.sales = Rabatt %.
  s.net_price_per_unit = t.vk;
  const f = 1 - (Number(s.sales) || 0) / 100;
  const vkNet = round2(t.vk * f);
  t.discount = round2(t.vk - vkNet);
  t.wageVk = round2(t.wageVk * f);
  t.materialVk = round2(t.materialVk * f);
  t.vk = vkNet;
  s.base_price = t.ek;
  s.marge = pct(t.vk, t.ek);
  s.time_minutes = t.minutes;
  s.wage_costs = t.wageVk;
  s.wage_base = t.wageEk;
  if (q === 1) return t;
  const scaled = { ...t };
  for (const k of Object.keys(scaled) as (keyof Totals)[]) scaled[k] = roundTotal(k, t[k] * q);
  return scaled;
}

const vatOf = (s: any): number => Number(s.vat_percent ?? 19);

type VatMap = Map<number, { net: number; base: number; wage: number }>;
type Sum = Pick<Totals, "vk" | "ek" | "minutes" | "wageVk" | "wageEk" | "materialVk" | "materialEk" | "discount">;
const emptySum = (): Sum => ({ vk: 0, ek: 0, minutes: 0, wageVk: 0, wageEk: 0, materialVk: 0, materialEk: 0, discount: 0 });

/** Summenobjekt im Format von data.totals UND table.totals (live: vat ungerundet, 4 Stellen gegen Rauschen; EK 4 Stellen). */
function mkTotals(sum: Sum, byVat: VatMap) {
  const vat = round4([...byVat].reduce((a, [v, e]) => a + e.net * (v / 100), 0));
  return {
    base: round4(sum.ek), net: round2(sum.vk), time: sum.minutes,
    wage: round2(sum.wageVk), wage_base: round2(sum.wageEk),
    material: round2(sum.materialVk), material_base: round4(sum.materialEk), sales: round2(sum.discount),
    byVat: [...byVat].map(([v, e]) => ({ vat: v, net: round2(e.net), base: round4(e.base), wage: round2(e.wage) })),
    vat,
  };
}

/** Rechnet Tabelle(n) und Dokument komplett neu. Mutiert den Draft und gibt eine Kurzfassung zurück. */
export function recalcDraft(draft: any) {
  const data = draft.data;
  const docVat: VatMap = new Map();
  const docSum = emptySum();

  for (const table of data.items ?? []) {
    if (table.type !== 'table') continue;
    const tSum = emptySum();
    const tVat: VatMap = new Map();
    const tVk: Record<string, number> = {}, tEk: Record<string, number> = {}, tWageVat: Record<string, number> = {};
    for (const s of table.items ?? []) {
      const t = recalcService(s);
      const v = vatOf(s);
      for (const m of [docVat, tVat]) {
        const e = m.get(v) ?? { net: 0, base: 0, wage: 0 };
        e.net += t.vk; e.base += t.ek; e.wage += t.wageVk;
        m.set(v, e);
      }
      tVk[v] = (tVk[v] ?? 0) + t.vk; tEk[v] = (tEk[v] ?? 0) + t.ek; tWageVat[v] = (tWageVat[v] ?? 0) + t.wageVk * (v / 100);
      for (const k of Object.keys(tSum) as (keyof Sum)[]) { tSum[k] += t[k]; docSum[k] += t[k]; }
    }
    table.total_sum = round2(tSum.vk);
    table.totalTime = tSum.minutes;
    table.totalBasePrice = round4(tSum.ek);
    table.totalWageCosts = round2(tSum.wageVk);
    table.totalSales = round2(tSum.discount);
    table.total = Object.fromEntries(Object.entries(tVk).map(([k, v]) => [k, round2(v)]));
    table.totalBaseVat = Object.fromEntries(Object.entries(tEk).map(([k, v]) => [k, round4(v)]));
    table.totalWageVat = round2(Object.values(tWageVat).reduce((a, b) => a + b, 0));
    // Auch table.totals (Rest wie netOptional/margin bleibt erhalten)
    table.totals = { ...(table.totals ?? {}), ...mkTotals(tSum, tVat) };
  }

  const totals = mkTotals(docSum, docVat);
  data.totals = { ...(data.totals ?? {}), ...totals };
  data.total_price = totals.net; // live: total_price == Netto (nicht Brutto)
  data.total_vat = round2(totals.vat); // live: total_vat auf 2 Stellen, totals.vat ungerundet
  if ("value" in draft) draft.value = totals.net; // live: value == Netto

  return summarize(draft);
}

/** Vorher/Nachher-Kennzahlen (EK, VK, Aufschlag, Netto, Brutto). */
export function summarize(draft: any) {
  const t = draft.data.totals;
  return {
    ek: t.base, vk: t.net, aufschlag_pct: pct(t.net, t.base),
    netto: t.net, mwst: draft.data.total_vat, brutto: round2(t.net + draft.data.total_vat),
  };
}
