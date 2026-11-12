// Firmenname des Betriebs – nie fest im Code. Quelle ist `app_config.legal_info.companyName`
// (Adminmenue → Rechtliches), dieselbe wie Impressum und Kundenmails.

/** Platzhalter in KI-Anweisungen; `runTask`/`runShadow` setzen den Namen ein. */
export const FIRMA = "{{FIRMA}}";

/** Ohne hinterlegten Namen steht in den Anweisungen ein neutraler Hinweis statt eines erfundenen Namens. */
export const FIRMA_FALLBACK = "(Firmenname siehe Firmenwissen)";

export function parseCompanyName(value: unknown): string {
  let v: any = value;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return ""; }
  }
  return v && typeof v === "object" ? String(v.companyName ?? "").trim() : "";
}

export async function loadCompanyName(sb: any): Promise<string> {
  try {
    const { data } = await sb.from("app_config").select("value").eq("key", "legal_info").maybeSingle();
    return parseCompanyName(data?.value);
  } catch {
    return "";
  }
}

export function fillCompany(text: string, name: string | null | undefined): string {
  return text.includes(FIRMA) ? text.split(FIRMA).join(String(name ?? "").trim() || FIRMA_FALLBACK) : text;
}

/** Anzeigename beim Senden/Entwurf: Firmenname, sonst Bezeichnung des Postfachs, sonst leer (nur Adresse). */
export function senderName(companyName: string, acc: { label?: string | null }): string {
  return companyName.trim() || String(acc?.label ?? "").trim();
}
