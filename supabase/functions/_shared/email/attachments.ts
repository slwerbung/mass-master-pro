// Anhaenge ans HERO-Projekt (Konzept „Anhaenge"): Rolle -> HERO-Dokumenttyp.
//
// Logo und Skizze -> Layouts/Plaene, Fotos und Masse -> Aufmasse, Druckdaten -> Druckdaten,
// Fahrzeugbilder -> Fahrzeugdaten, Sonstiges -> Allgemein. Signaturbilder, Tracking-Pixel und
// Dateien unter 10 KB sind schon beim Abholen als „ignoriert" markiert. Rechnungen gehoeren
// nicht ans Projekt (sie wandern ueber „Belege").

export type DocKey = "layouts" | "aufmasse" | "druckdaten" | "fahrzeugdaten" | "allgemein";
export type DocTypes = Partial<Record<DocKey, number>>;

export const ROLE_TO_DOC: Record<string, DocKey | null> = {
  logo: "layouts",
  skizze: "layouts",
  foto: "aufmasse",
  fahrzeugbild: "fahrzeugdaten",
  druckdaten: "druckdaten",
  sonstiges: "allgemein",
  rechnung: null,
};

export const DOC_LABELS: Record<DocKey, string> = {
  layouts: "Layouts / Pläne", aufmasse: "Aufmaße", druckdaten: "Druckdaten", fahrzeugdaten: "Fahrzeugdaten", allgemein: "Allgemein",
};

export interface AttachmentRow {
  id: string;
  filename: string;
  mime: string;
  size: number;
  role: string | null;
  storage_path: string | null;
  is_ignored: boolean;
  hero_uploaded_at?: string | null;
}

export interface UploadItem {
  attachmentId: string;
  filename: string;
  mime: string;
  size: number;
  role: string;
  docKey: DocKey;
  documentTypeId: number;
  /** In der Mail-App abwaehlbar. */
  selected: boolean;
}

export function buildUploadItems(atts: AttachmentRow[], docTypes: DocTypes): UploadItem[] {
  const out: UploadItem[] = [];
  for (const a of atts) {
    if (a.is_ignored || !a.storage_path || a.hero_uploaded_at) continue;
    const role = a.role && a.role in ROLE_TO_DOC ? a.role : "sonstiges";
    const docKey = ROLE_TO_DOC[role];
    if (!docKey) continue;
    const documentTypeId = docTypes[docKey];
    if (!documentTypeId) continue; // ohne konfigurierten Dokumenttyp nichts vorschlagen
    out.push({ attachmentId: a.id, filename: a.filename, mime: a.mime, size: a.size, role, docKey, documentTypeId, selected: true });
  }
  return out;
}
