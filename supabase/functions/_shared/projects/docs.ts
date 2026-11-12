// Dokumente eines HERO-Projekts (customer_documents). Geloeschte und stornierte werden ignoriert.

export interface HeroDoc { nr: string; type: string; created: string | null; status: string; value?: number | null }

const IGNORED = ["gelöscht", "geloescht", "storniert"];
const SENT = ["versendet", "erneut versendet"];

export function normalizeDocuments(raw: unknown): HeroDoc[] {
  if (!Array.isArray(raw)) return [];
  const out: HeroDoc[] = [];
  for (const d of raw as any[]) {
    const status = String(d?.status_name ?? d?.status ?? "");
    if (IGNORED.includes(status.trim().toLowerCase())) continue;
    out.push({
      nr: String(d?.nr ?? ""),
      type: String(d?.type ?? ""),
      created: d?.created ? String(d.created) : null,
      status,
      value: d?.value != null && !Number.isNaN(Number(d.value)) ? Number(d.value) : null,
    });
  }
  return out;
}

const isSent = (d: HeroDoc) => SENT.includes(d.status.trim().toLowerCase());
const ts = (d: HeroDoc) => (d.created ? Date.parse(d.created) || 0 : 0);

export const sentOffers = (docs: HeroDoc[]) => docs.filter((d) => d.type === "offer" && isSent(d));
/** Angebot, das noch nicht versendet wurde (Entwurf, Erstellt, Erstellt (Hochgeladen)). */
export const unsentOffers = (docs: HeroDoc[]) => docs.filter((d) => d.type === "offer" && !isSent(d));
export const confirmations = (docs: HeroDoc[]) => docs.filter((d) => d.type === "confirmation");

/** Neuestes Dokument der Liste (nach `created`); null bei leerer Liste. */
export function latest(docs: HeroDoc[]): HeroDoc | null {
  return docs.length ? docs.reduce((a, b) => (ts(b) >= ts(a) ? b : a)) : null;
}
