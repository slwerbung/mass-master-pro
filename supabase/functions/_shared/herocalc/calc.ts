// Rechenkern für HERO-Detailkalkulationen (Spec 2.4). Reine Funktionen, keine I/O.

const roundTo = (x: number, digits: number): number => {
  const f = Math.pow(10, digits);
  return Math.round(Number((x * f).toPrecision(12))) / f;
};

/** Abschneiden auf 4 Stellen: HERO speichert den EK je Leistung abgeschnitten (live: 20.21667 -> 20.2166). */
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

export function recalcMaterial(p: any): Line {
  const q = Number(p.quantity);
  const vk = round2(q * Number(p.net_price_per_unit));
  const ek = round4(q * Number(p.base_price));
  p.marge = pct(vk, ek);
  return { vk, ek, minutes: 0, isWage: false };
}

/** Lohnzeile: quantity = Minuten. Lohn-EK bleibt exakt (HERO summiert ihn ungerundet). */
export function recalcWage(p: any): Line {
  const m = Number(p.quantity);
  const ekH = Number(p.wage_cost_price);
  const vkH = Number(p.wage_per_hour);
  p.time_minutes = m;
  p.base_price = round4(ekH / 60);
  p.net_price_per_unit = round4(vkH / 60);
  p.marge = pct(vkH, ekH);
  return { vk: round2((m / 60) * vkH), ek: (m / 60) * ekH, minutes: m, isWage: true };
}

export interface Totals {
  vk: number; ek: number; minutes: number; wageVk: number; wageEk: number;
  materialVk: number; materialEk: number; discount: number;
}

const EK4 = new Set<string>(["ek", "materialEk"]);
const roundTotal = (k: string, v: number): number => (EK4.has(k) ? round4(v) : round2(v));

export function recalcService(s: any): Totals {
  const q = Number(s.quantity ?? 1);
  if (!Number.isFinite(q) || q <= 0) throw new Error(`Leistung ${s.uid}: quantity ${s.quantity} ungültig`);
  const t: Totals = { vk: 0, ek: 0, minutes: 0, wageVk: 0, wageEk: 0, materialVk: 0, materialEk: 0, discount: 0 };
  for (const p of s.positions ?? []) {
    const l = p.atType === 'WageGroup' ? recalcWage(p) : recalcMaterial(p);
    t.vk += l.vk; t.ek += l.ek; t.minutes += l.minutes;
    if (l.isWage) { t.wageVk += l.vk; t.wageEk += l.ek; } else { t.materialVk += l.vk; t.materialEk += l.ek; }
  }
  // Live belegt (WER-1984): EK je Leistung = Summe der Zeilen abgeschnitten auf 4 Stellen; Lohn-EK auf 2 Stellen, Material-EK = EK - Lohn-EK.
  t.ek = floor4(t.ek);
  t.wageEk = round2(t.wageEk);
  t.materialEk = round4(t.ek - t.wageEk);
  for (const k of Object.keys(t) as (keyof Totals)[]) t[k] = roundTotal(k, t[k]);
  if (s.is_custom_price) {
    // Eigener Preis ("VK Netto neu", live belegt 27.11. an 22637283): VK je Einheit = custom_material_price + custom_wage_price, die Zeilen-VK zählen nicht.
    // EK, Zeiten und Zeilenwerte bleiben unverändert. Rabatt und Menge laufen danach wie gewohnt.
    const cm = Number(s.custom_material_price);
    const cw = Number(s.custom_wage_price);
    if (!Number.isFinite(cm) || !Number.isFinite(cw) || cm < 0 || cw < 0) throw new Error(`Leistung ${s.uid}: eigener Preis ohne gültige custom_material_price/custom_wage_price`);
    t.materialVk = round2(cm);
    t.wageVk = round2(cw);
    t.vk = round2(cm + cw);
  }
  s.net_price_per_unit = t.vk;
  const sales = Number(s.sales) || 0;
  const f = 1 - sales / 100;
  const grossUnit = t.vk; // VK je Einheit vor Rabatt
  const vkNet = round2(t.vk * f);
  const wageUnitNet = round2(t.wageVk * f);
  t.discount = round2(t.vk - vkNet);
  t.wageVk = wageUnitNet;
  t.materialVk = round2(t.materialVk * f);
  t.vk = vkNet;
  s.base_price = t.ek;
  s.marge = pct(t.vk, t.ek);
  s.time_minutes = t.minutes;
  s.wage_costs = t.wageVk;
  s.wage_base = t.wageEk;
  if (q === 1) return t;
  const scaled = { ...t };
  if (sales > 0) {
    // Live belegt (HERO-Dialog, Aufkleber qty 2, 10 %): Rabatt gilt auf die GESAMTSUMME, nicht je Einheit.
    // brutto = round2(VK_Einheit * q); Rabatt = round2(brutto * %); netto = brutto - Rabatt; Lohn = round2(Lohn_Einheit_netto * q); Material = Rest.
    const gross = round2(grossUnit * q);
    const discount = round2(gross * sales / 100);
    const net = round2(gross - discount);
    const wage = round2(wageUnitNet * q);
    scaled.vk = net;
    scaled.discount = discount;
    scaled.wageVk = wage;
    scaled.materialVk = round2(net - wage);
    scaled.ek = round4(t.ek * q);
    scaled.minutes = t.minutes * q;
    scaled.wageEk = round2(t.wageEk * q);
    scaled.materialEk = round4(t.materialEk * q);
    return scaled;
  }
  for (const k of Object.keys(scaled) as (keyof Totals)[]) scaled[k] = roundTotal(k, t[k] * q);
  return scaled;
}

const vatOf = (s: any): number => Number(s.vat_percent ?? 19);

type VatMap = Map<number, { net: number; base: number; wage: number }>;
type Sum = Pick<Totals, "vk" | "ek" | "minutes" | "wageVk" | "wageEk" | "materialVk" | "materialEk" | "discount">;
const emptySum = (): Sum => ({ vk: 0, ek: 0, minutes: 0, wageVk: 0, wageEk: 0, materialVk: 0, materialEk: 0, discount: 0 });

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
      if (s.type === 'title' || s.type === 'text') continue; // Titel/Textbausteine haben keine Summen
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
    table.totals = { ...(table.totals ?? {}), ...mkTotals(tSum, tVat) };
  }

  const totals = mkTotals(docSum, docVat);
  data.totals = { ...(data.totals ?? {}), ...totals };
  data.total_price = totals.net;
  data.total_vat = round2(totals.vat);
  if ("value" in draft) draft.value = totals.net;

  return summarize(draft);
}

export function summarize(draft: any) {
  const t = draft.data.totals;
  return {
    ek: t.base, vk: t.net, aufschlag_pct: pct(t.net, t.base),
    netto: t.net, mwst: draft.data.total_vat, brutto: round2(t.net + draft.data.total_vat),
  };
}
