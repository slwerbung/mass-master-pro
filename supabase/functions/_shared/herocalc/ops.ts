// Reine Änderungsoperationen auf einem HERO-Draft (Spec Abschnitt 3). Keine I/O.
import { recalcDraft, summarize } from "./calc.ts";

export type Command =
  | { cmd: "set_wage_minutes"; position_uid: string; wage_group_id: string | number; minutes: number }
  | { cmd: "set_material"; position_uid: string; product_id: string | number; quantity: number; vk_per_unit?: number }
  | { cmd: "add_position"; position_uid: string; position: Record<string, unknown> }
  | { cmd: "remove_position"; position_uid: string; atType: "SupplyProduct" | "WageGroup"; id: string | number };

const same = (a: unknown, b: unknown) => String(a) === String(b);
const num = (v: unknown, name: string, min = 0) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) throw new Error(`${name} muss eine Zahl >= ${min} sein`);
  return v;
};

export function findService(draft: any, uid: string): any {
  for (const t of draft.data?.items ?? []) {
    if (t.type !== "table") continue;
    for (const s of t.items ?? []) if (same(s.uid, uid)) return s;
  }
  throw new Error(`Leistung mit uid ${uid} nicht gefunden`);
}

function findPosition(service: any, atType: string, id: unknown): any {
  const matches = (service.positions ?? []).filter((p: any) => p.atType === atType && same(p.id, id));
  if (matches.length === 0) throw new Error(`${atType} ${id} in Leistung ${service.uid} nicht gefunden`);
  if (matches.length > 1) throw new Error(`${atType} ${id} kommt in Leistung ${service.uid} mehrfach vor – nicht eindeutig`);
  return matches[0];
}

const REQUIRED_MATERIAL = ["id", "quantity", "base_price", "net_price_per_unit", "unit_type", "name"];
const REQUIRED_WAGE = ["id", "quantity", "wage_cost_price", "wage_per_hour", "name"];

/** Wendet einen Befehl auf eine Kopie an. Vorher = gespeicherte Summen, Nachher = neu gerechnet. */
export function applyCommand(original: any, c: Command) {
  const draft = structuredClone(original);
  const before = summarize(original);
  const service = findService(draft, c.position_uid);

  switch (c.cmd) {
    case "set_wage_minutes": {
      findPosition(service, "WageGroup", c.wage_group_id).quantity = num(c.minutes, "minutes");
      break;
    }
    case "set_material": {
      const p = findPosition(service, "SupplyProduct", c.product_id);
      p.quantity = num(c.quantity, "quantity");
      if (c.vk_per_unit !== undefined) p.net_price_per_unit = num(c.vk_per_unit, "vk_per_unit");
      break;
    }
    case "add_position": {
      const p = c.position as any;
      const req = p?.atType === "WageGroup" ? REQUIRED_WAGE : p?.atType === "SupplyProduct" ? REQUIRED_MATERIAL : null;
      if (!req) throw new Error("position.atType muss SupplyProduct oder WageGroup sein");
      const missing = req.filter((k) => p[k] === undefined || p[k] === null);
      if (missing.length) throw new Error(`position unvollständig, fehlt: ${missing.join(", ")}`);
      if ((service.positions ?? []).some((x: any) => x.atType === p.atType && same(x.id, p.id))) {
        throw new Error(`${p.atType} ${p.id} existiert in Leistung ${service.uid} bereits`);
      }
      num(p.quantity, "position.quantity");
      service.positions = [...(service.positions ?? []), structuredClone(p)];
      break;
    }
    case "remove_position": {
      const p = findPosition(service, c.atType, c.id);
      service.positions = service.positions.filter((x: any) => x !== p);
      break;
    }
    default:
      throw new Error(`Unbekannter Befehl ${(c as any).cmd}`);
  }

  const after = recalcDraft(draft);
  return { draft, before, after };
}
