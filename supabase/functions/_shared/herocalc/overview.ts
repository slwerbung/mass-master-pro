// Kompakte Übersicht eines Drafts für `get` (der volle Draft nur mit include_draft: true).
import { summarize } from "./calc.ts";

export function overview(draft: any) {
  return {
    document_id: draft.customer_document_id,
    draft_id: draft.id,
    status_code: draft.status_code,
    modified: draft.modified,
    summary: summarize(draft),
    tables: (draft.data?.items ?? []).filter((t: any) => t.type === "table").map((t: any) => ({
      uid: t.uid,
      total_sum: t.total_sum,
      services: (t.items ?? []).map((s: any) => ({
        uid: s.uid, name: s.name, quantity: s.quantity, sales: s.sales ?? 0, vat_percent: s.vat_percent,
        net_price_per_unit: s.net_price_per_unit, base_price: s.base_price, marge: s.marge, time_minutes: s.time_minutes,
        is_fixed_net_price: s.is_fixed_net_price ?? null,
        positions: (s.positions ?? []).map((p: any) => ({
          atType: p.atType, id: p.id, name: p.name, quantity: p.quantity, unit_type: p.unit_type,
          net_price_per_unit: p.net_price_per_unit, base_price: p.base_price, marge: p.marge,
        })),
      })),
    })),
  };
}
