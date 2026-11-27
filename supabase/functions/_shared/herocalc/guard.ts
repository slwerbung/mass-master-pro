// Strukturprüfung und Konfliktschutz vor dem Schreiben (Spec Abschnitt 3, Regeln).

const isLayoutItem = (s: any): boolean => s?.type === "title" || s?.type === "text";

export function assertWritableDraft(draft: any): void {
  if (!draft || typeof draft !== "object") throw new Error("Draft fehlt oder ist kein Objekt");
  if (draft.status_code !== 0) throw new Error(`Kein Entwurf (status_code ${draft.status_code}) – Schreiben verweigert`);
  for (const k of ["id", "customer_document_id", "modified"]) {
    if (draft[k] === undefined || draft[k] === null) throw new Error(`Draft ohne Pflichtfeld ${k}`);
  }
  const data = draft.data;
  if (!data || typeof data !== "object") throw new Error("draft.data fehlt");
  if (data.version === undefined || data.version === null) throw new Error("draft.data.version fehlt");
  if (!Array.isArray(data.items)) throw new Error("draft.data.items ist kein Array");
  if (!data.totals || typeof data.totals !== "object") throw new Error("draft.data.totals fehlt");
  for (const t of data.items) {
    if (t.type !== "table") continue;
    if (!Array.isArray(t.items)) throw new Error("Tabelle ohne items");
    for (const s of t.items) {
      if (isLayoutItem(s)) continue; // Titel/Textbausteine
      if (typeof s.uid !== "string" && typeof s.uid !== "number") throw new Error("Leistung ohne uid");
      if (!Array.isArray(s.positions)) throw new Error(`Leistung ${s.uid} ohne positions`);
    }
  }
}

export async function draftHash(draft: any): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(draft.data)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function assertUnchanged(read: any, fresh: any): Promise<void> {
  const changed = String(read.modified) !== String(fresh.modified) ||
    String(read.data?.version) !== String(fresh.data?.version) ||
    (await draftHash(read)) !== (await draftHash(fresh));
  if (changed) throw new Error("Draft wurde seit dem Lesen geändert – abgebrochen");
}

/**
 * Mehrere Leistungen: live belegt (WER-1984). Eigener Preis (is_custom_price + custom_material_price/custom_wage_price): live belegt 27.11., wird gerechnet.
 * Festpreis (is_fixed_net_price): Bedeutung/Rechenweg nicht belegt -> gesperrt.
 */
export const SUPPORT = { multipleServices: true, customPrice: true, fixedPrice: false } as const;

export function assertSupportedStructure(draft: any): void {
  const tables = (draft.data?.items ?? []).filter((t: any) => t.type === "table");
  const services = tables.flatMap((t: any) => t.items ?? []).filter((s: any) => !isLayoutItem(s));
  if (!SUPPORT.multipleServices && (tables.length > 1 || services.length > 1)) {
    throw new Error("Mehrere Leistungen/Tabellen im Entwurf sind noch nicht unterstützt – Schreiben verweigert");
  }
  if (!SUPPORT.fixedPrice && services.some((s: any) => s.is_fixed_net_price)) {
    throw new Error("Festpreis (is_fixed_net_price) ist noch nicht unterstützt – Schreiben verweigert");
  }
  if (!SUPPORT.customPrice && services.some((s: any) => s.is_custom_price)) {
    throw new Error("Eigener Preis (is_custom_price) ist nicht freigegeben – Schreiben verweigert");
  }
}
