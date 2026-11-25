// Strukturprüfung und Konfliktschutz vor dem Schreiben (Spec Abschnitt 3, Regeln).

/** Nur Entwürfe (status_code 0) mit der erwarteten Struktur sind schreibbar. */
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
      if (typeof s.uid !== "string" && typeof s.uid !== "number") throw new Error("Leistung ohne uid");
      if (!Array.isArray(s.positions)) throw new Error(`Leistung ${s.uid} ohne positions`);
    }
  }
}

/** Abbruch, wenn sich der Draft seit dem Lesen geändert hat (paralleles Bearbeiten). */
export function assertUnchanged(read: any, fresh: any): void {
  if (String(read.modified) !== String(fresh.modified) || String(read.data?.version) !== String(fresh.data?.version)) {
    throw new Error("Draft wurde seit dem Lesen geändert (data.version/modified) – abgebrochen");
  }
}
