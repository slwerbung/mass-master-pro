// Reine Änderungsoperationen auf einem HERO-Draft (Spec Abschnitt 3). Keine I/O.
// Lohnzeilen haben KEINE eigene uid (uid ist leer). Sie werden über die HERO-Id der Lohngruppe (`wage_group_id`, bei remove_position `id`)
// gefunden. Kommt dieselbe Lohngruppe mehrfach vor, zusätzlich `activity` (Text der Zeile) oder `index` (0-basiert unter den Zeilen mit dieser Id) angeben.
// replace_material tauscht ein Material gegen einen anderen Artikel (Menge bleibt, VK-Aufschlag der alten Zeile bleibt, sonst vk_per_unit).
// Materialzeilen brauchen eine uid (HERO lehnt den Entwurf sonst mit 422 "uid is empty" ab): add_position vergibt sie automatisch, am Ende wird geprüft.
// Bereinigung (27.11.): Materialzeilen mit attributes null/fehlend oder file_upload_uuid "" (kommt vor, wenn eine Zeile aus einem anderen Entwurf kopiert wird)
// lösen im HERO-Editor beim Speichern "Document schema validation failed" aus; sie werden bei jedem Schreiben auf die Standardform gesetzt.
import { recalcDraft, recalcService, round2, round4, summarize } from "./calc.ts";
import { assertSupportedStructure } from "./guard.ts";

export interface NewProduct {
  id: string; nr: string; name: string; unit_type?: string; base_price: number;
  quantity_min?: number; quantity_interval?: number; price_quantity?: number;
}

export type Command =
  | { cmd: "set_wage_minutes"; position_uid: string; wage_group_id?: string | number; id?: string | number; activity?: string; index?: number; minutes: number }
  | { cmd: "set_material"; position_uid: string; product_id: string | number; quantity: number; vk_per_unit?: number; index?: number }
  | { cmd: "replace_material"; position_uid: string; product_id: string | number; with: NewProduct; vk_per_unit?: number; index?: number }
  | { cmd: "set_quantity"; position_uid: string; quantity: number }
  | { cmd: "set_discount"; position_uid: string; percent?: number; amount?: number }
  | { cmd: "add_position"; position_uid: string; position: Record<string, unknown> }
  | { cmd: "remove_position"; position_uid: string; atType: "SupplyProduct" | "WageGroup"; id: string | number; activity?: string; index?: number }
  | { cmd: "recalc" };

const same = (a: unknown, b: unknown) => String(a) === String(b);
const num = (v: unknown, name: string, min = 0) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) throw new Error(`${name} muss eine Zahl >= ${min} sein`);
  return v;
};
const newUid = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");

export function findService(draft: any, uid: string): any {
  for (const t of draft.data?.items ?? []) {
    if (t.type !== "table") continue;
    for (const s of t.items ?? []) if (same(s.uid, uid)) return s;
  }
  throw new Error(`Leistung mit uid ${uid} nicht gefunden`);
}

const lineLabel = (p: any) => `${p.atType === "WageGroup" ? "Lohn" : "Material"} id ${p.id} "${p.name ?? ""}"${p.activity ? ` activity "${p.activity}"` : ""} Menge ${p.quantity}`;

function findPosition(service: any, atType: string, id: unknown, sel: { activity?: unknown; index?: unknown } = {}): any {
  const idName = atType === "WageGroup" ? "wage_group_id" : "product_id";
  const same_type = (service.positions ?? []).filter((p: any) => p.atType === atType);
  if (id === undefined || id === null || id === "") {
    throw new Error(`${idName} fehlt (HERO-Id der Zeile, nicht die uid). Vorhanden in Leistung ${service.uid}: ${same_type.map(lineLabel).join(" | ") || "keine"}`);
  }
  let matches = same_type.filter((p: any) => same(p.id, id));
  if (matches.length === 0) {
    throw new Error(`${atType} ${id} in Leistung ${service.uid} nicht gefunden. Vorhanden: ${same_type.map(lineLabel).join(" | ") || "keine"}`);
  }
  if (sel.activity !== undefined && sel.activity !== null) {
    matches = matches.filter((p: any) => String(p.activity ?? "") === String(sel.activity));
    if (matches.length === 0) throw new Error(`${atType} ${id} mit activity "${sel.activity}" in Leistung ${service.uid} nicht gefunden`);
  }
  if (sel.index !== undefined && sel.index !== null) {
    const i = Number(sel.index);
    if (!Number.isInteger(i) || i < 0 || i >= matches.length) throw new Error(`index ${sel.index} ungültig (${matches.length} Zeile(n) mit ${atType} ${id})`);
    return matches[i];
  }
  if (matches.length > 1) {
    throw new Error(`${atType} ${id} kommt in Leistung ${service.uid} ${matches.length}x vor – zusätzlich activity oder index angeben. Zeilen: ${matches.map((p: any, i: number) => `index ${i}: ${lineLabel(p)}`).join(" | ")}`);
  }
  return matches[0];
}

const REQUIRED_MATERIAL = ["id", "quantity", "base_price", "net_price_per_unit", "unit_type", "name"];
const REQUIRED_WAGE = ["id", "quantity", "wage_cost_price", "wage_per_hour", "name"];

const defaultAttributes = () => ({
  stock: { count: null, status: null, description: null },
  measurement: { width: null, amount: null, height: null, length: null },
});

/** Materialzeilen auf die Form bringen, die der HERO-Editor beim Speichern akzeptiert. */
export function sanitizePositions(draft: any): number {
  let n = 0;
  for (const t of draft.data?.items ?? []) {
    if (t.type !== "table") continue;
    for (const s of t.items ?? []) {
      if (s.type === "title" || s.type === "text") continue;
      for (const p of s.positions ?? []) {
        if (p.atType !== "SupplyProduct") continue;
        if (p.attributes === null || p.attributes === undefined || typeof p.attributes !== "object") { p.attributes = defaultAttributes(); n++; }
        if (p.file_upload_uuid === "") { p.file_upload_uuid = null; n++; }
      }
    }
  }
  return n;
}

export function applyCommand(original: any, c: Command) {
  assertSupportedStructure(original);
  const draft = structuredClone(original);
  const before = summarize(original);
  const service: any = c.cmd === "recalc" ? null : findService(draft, c.position_uid);

  switch (c.cmd) {
    case "recalc": {
      break;
    }
    case "set_wage_minutes": {
      const gid = c.wage_group_id ?? c.id;
      findPosition(service, "WageGroup", gid, { activity: c.activity, index: c.index }).quantity = num(c.minutes, "minutes");
      break;
    }
    case "set_material": {
      const p = findPosition(service, "SupplyProduct", c.product_id, { index: c.index });
      p.quantity = num(c.quantity, "quantity");
      if (c.vk_per_unit !== undefined) p.net_price_per_unit = num(c.vk_per_unit, "vk_per_unit");
      break;
    }
    case "replace_material": {
      const w = c.with;
      if (!w || !w.id || !w.nr || !w.name) throw new Error("replace_material: neues Material unvollständig");
      num(w.base_price, "new base_price", 0);
      const old = findPosition(service, "SupplyProduct", c.product_id, { index: c.index });
      if ((service.positions ?? []).some((x: any) => x !== old && x.atType === "SupplyProduct" && same(x.id, w.id))) {
        throw new Error(`Material ${w.nr} ist in Leistung ${service.uid} schon vorhanden`);
      }
      // VK: Aufschlag der alten Zeile bleibt (z. B. Folien zur Verarbeitung +300 %), außer vk_per_unit ist angegeben.
      const markup = Number(old.base_price) > 0 ? Number(old.net_price_per_unit) / Number(old.base_price) : 1;
      const vk = c.vk_per_unit !== undefined ? num(c.vk_per_unit, "vk_per_unit") : round2(w.base_price * markup);
      const next: any = { ...structuredClone(old), id: w.id, nr: w.nr, name: w.name, base_price: w.base_price, net_price_per_unit: vk };
      if (w.unit_type) next.unit_type = w.unit_type;
      if (w.quantity_min !== undefined) next.quantity_min = w.quantity_min;
      if (w.quantity_interval !== undefined) next.quantity_interval = w.quantity_interval;
      if (w.price_quantity !== undefined) next.price_quantity = w.price_quantity;
      next.description = "";
      next.image_url = "";
      delete next.hash;
      if (!next.uid) next.uid = newUid();
      service.positions = service.positions.map((x: any) => (x === old ? next : x));
      break;
    }
    case "set_quantity": {
      const q = num(c.quantity, "quantity");
      if (q <= 0) throw new Error("quantity muss größer als 0 sein");
      service.quantity = q;
      break;
    }
    case "set_discount": {
      if ((c.percent === undefined) === (c.amount === undefined)) throw new Error("set_discount: genau eines von percent oder amount angeben");
      let pct: number;
      if (c.percent !== undefined) {
        pct = num(c.percent, "percent");
      } else {
        const amount = num(c.amount, "amount");
        service.sales = 0;
        const gross = recalcService(service).vk; // VK vor Rabatt
        if (gross <= 0) throw new Error("Leistung hat keinen VK – Betrag nicht umrechenbar");
        if (amount >= gross) throw new Error(`amount ${amount} muss kleiner als der VK ${gross} sein`);
        pct = round4((amount / gross) * 100);
      }
      if (pct >= 100) throw new Error("Rabatt muss unter 100 % liegen");
      service.sales = pct;
      break;
    }
    case "add_position": {
      const p = c.position as any;
      const req = p?.atType === "WageGroup" ? REQUIRED_WAGE : p?.atType === "SupplyProduct" ? REQUIRED_MATERIAL : null;
      if (!req) throw new Error("position.atType muss SupplyProduct oder WageGroup sein");
      const missing = req.filter((k) => p[k] === undefined || p[k] === null);
      if (missing.length) throw new Error(`position unvollständig, fehlt: ${missing.join(", ")}`);
      if ((service.positions ?? []).some((x: any) => x.atType === p.atType && same(x.id, p.id) && same(x.activity ?? "", p.activity ?? ""))) {
        throw new Error(`${p.atType} ${p.id} existiert in Leistung ${service.uid} bereits`);
      }
      num(p.quantity, "position.quantity");
      const np = structuredClone(p);
      if (np.atType === "SupplyProduct" && (np.uid === undefined || np.uid === null || np.uid === "")) np.uid = newUid();
      service.positions = [...(service.positions ?? []), np];
      break;
    }
    case "remove_position": {
      if (c.atType !== "SupplyProduct" && c.atType !== "WageGroup") throw new Error("atType muss SupplyProduct oder WageGroup sein");
      const p = findPosition(service, c.atType, c.id, { activity: c.activity, index: c.index });
      service.positions = service.positions.filter((x: any) => x !== p);
      break;
    }
    default:
      throw new Error(`Unbekannter Befehl ${(c as any).cmd}`);
  }

  // Vorabprüfung: HERO lehnt Entwürfe mit Materialzeilen ohne uid ab (422) – gar nicht erst schreiben.
  for (const t of draft.data?.items ?? []) {
    if (t.type !== "table") continue;
    for (const s of t.items ?? []) {
      if (s.type === "title" || s.type === "text") continue;
      for (const p of s.positions ?? []) {
        if (p.atType === "SupplyProduct" && (p.uid === undefined || p.uid === null || p.uid === "")) {
          throw new Error(`Materialzeile ${p.nr ?? p.id} in Leistung ${s.uid} hat keine uid – Schreiben verweigert`);
        }
      }
    }
  }

  sanitizePositions(draft);
  const after = recalcDraft(draft);
  return { draft, before, after };
}
