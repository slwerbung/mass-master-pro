// Liest den Draft aus dem HTML der HERO-Edit-Seite (/partner/Documents/edit/<id>).
// Live belegt (WER-1984): die Seite enthält `"DocumentStore":{"draft":{...}}` als JSON.
// Nur ohne Header `X-Requested-With` kommt die volle Seite; mit ihm nur eine leere Hülle.

/** Schneidet ab `start` (Position einer `{`) das vollständige JSON-Objekt aus; Klammern in Strings zählen nicht. */
export function extractJsonObject(src: string, start: number): string {
  if (src[start] !== "{") throw new Error("JSON-Objekt beginnt nicht mit {");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("JSON-Objekt in der Edit-Seite nicht abgeschlossen");
}

/** Gibt Draft und document (z. B. project_match_id) zurück oder wirft eine klare Fehlermeldung. */
export function parseEditPage(html: string, expectedDocumentId?: number): { draft: any; document: any } {
  const marker = '"DocumentStore":';
  const idx = html.indexOf(marker);
  if (idx < 0) throw new Error("Edit-Seite enthält keinen DocumentStore (Login/Header/Format geändert?)");
  if (html.indexOf(marker, idx + 1) >= 0) throw new Error("Edit-Seite enthält mehrere DocumentStore – nicht eindeutig");
  let store: any;
  try {
    store = JSON.parse(extractJsonObject(html, html.indexOf("{", idx + marker.length)));
  } catch (e) {
    throw new Error(`DocumentStore nicht lesbar: ${e instanceof Error ? e.message : "?"}`);
  }
  const draft = store?.draft;
  if (!draft || typeof draft !== "object") throw new Error("DocumentStore ohne draft");
  if (expectedDocumentId !== undefined && Number(draft.customer_document_id) !== expectedDocumentId) {
    throw new Error(`Draft gehört zu Dokument ${draft.customer_document_id}, erwartet ${expectedDocumentId}`);
  }
  return { draft, document: store.document ?? null };
}

/** Wie parseEditPage, aber nur der Draft. `expectedDocumentId` schützt vor falscher Seite. */
export function parseDraftFromEditHtml(html: string, expectedDocumentId?: number): any {
  return parseEditPage(html, expectedDocumentId).draft;
}
