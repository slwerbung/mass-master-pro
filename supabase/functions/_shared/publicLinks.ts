// Kundenseitige Links mit Firmennamen im Pfad (Spec B): https://captfix.app/sl-werbung/freigabe/<id>, optional mit eigener
// Domain. Konfiguration in app_config: public_link_slug (leer = aus legal_info.companyName) und public_base_url
// (leer = https://captfix.app). Mitarbeiterlinks (/projects/...), .ics-UIDs und die Absenderadresse bleiben unveraendert.

export const DEFAULT_BASE_URL = "https://captfix.app";

/** Diese ersten Pfadsegmente sind Routen der App und duerfen kein Firmen-Slug sein. */
export const RESERVED_SLUGS = [
  "projects", "admin", "kunde", "customer", "guest", "freigabe", "termin", "api", "assets", "neukunde", "fahrzeug-anfrage",
  "wohnmobil-reparatur", "layout-upload", "gestaltung", "hero-aktion", "datenschutz", "etiketten", "protokoll", "probo-katalog",
  "mister-x-live",
];

export interface PublicLinkConfig { slug: string; baseUrl: string }

/** „SL WERBUNG“ → „sl-werbung“: klein, Umlaute ausgeschrieben, alles andere zu „-“. */
export function slugify(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/g, "");
}

/** Fehlertext oder null. */
export function validateSlug(slug: string): string | null {
  if (slug.length < 2 || slug.length > 40) return "Der Firmenname im Link muss 2 bis 40 Zeichen lang sein.";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return "Nur Kleinbuchstaben, Ziffern und einzelne Bindestriche (z. B. „sl-werbung“).";
  if (RESERVED_SLUGS.includes(slug)) return `„${slug}“ ist reserviert – bitte einen anderen Namen wählen.`;
  return null;
}

/** Fehlertext oder null. Erwartet https://host ohne Pfad und ohne abschliessenden „/“. */
export function validateBaseUrl(url: string): string | null {
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) return "Die Domain muss mit https:// beginnen, ohne Pfad und ohne „/“ am Ende (z. B. https://freigabe.slwerbung.de).";
  return null;
}

/** Konfiguration mit Standardwerten aufloesen (reine Logik). */
export function resolvePublicLinkConfig(raw: { slug?: string | null; baseUrl?: string | null; companyName?: string | null }): PublicLinkConfig {
  const slug = (raw.slug || "").trim() || slugify(raw.companyName || "") || "firma";
  const baseUrl = ((raw.baseUrl || "").trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { slug, baseUrl };
}

/** Konfiguration aus app_config lesen. */
export async function getPublicLinkConfig(supabase: any): Promise<PublicLinkConfig> {
  const { data } = await supabase.from("app_config").select("key, value").in("key", ["public_link_slug", "public_base_url", "legal_info"]);
  const m = new Map<string, string | null>((data || []).map((r: any) => [r.key, r.value]));
  let companyName: string | null = null;
  try { companyName = JSON.parse(m.get("legal_info") || "null")?.companyName ?? null; } catch { companyName = null; }
  return resolvePublicLinkConfig({ slug: m.get("public_link_slug"), baseUrl: m.get("public_base_url"), companyName });
}

/** `${baseUrl}/${slug}${path}` – path beginnt mit „/“; keine doppelten Schraegstriche. */
export function publicUrl(cfg: PublicLinkConfig, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${cfg.baseUrl.replace(/\/+$/, "")}/${cfg.slug.replace(/^\/+|\/+$/g, "")}${p}`;
}
