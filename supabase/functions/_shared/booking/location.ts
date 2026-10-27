// Wo findet der Termin statt — und was folgt daraus?
//
// Vier Arten, die sich in drei Dingen unterscheiden: wessen Adresse zaehlt, ob
// wir fahren, und was als Treffpunkt in Mail, Kalendereintrag und HERO steht.
//
//   vor_ort  beim Kunden      Kundenadresse   Anfahrt JA
//   buero    bei uns im Buero unsere Adresse  Anfahrt nein
//   telefon  am Telefon       keine Adresse   Anfahrt nein, Rufnummer PFLICHT
//   online   per Video        keine Adresse   Anfahrt nein, Jitsi-Link je Termin
//
// Dass die Anfahrt entfaellt, braucht keinen Sonderfall in der Engine: die
// rechnet Fahrzeit und Einsatzradius nur, wenn sie eine Adresse bekommt
// (`engine.ts`: `if (input.address && …)`). Fuer alles ausser `vor_ort` wird
// deshalb schlicht keine Adresse uebergeben. Ein Umbau der Engine waere der
// umstaendlichere und riskantere Weg zum selben Ergebnis.

export type LocationMode = "vor_ort" | "buero" | "telefon" | "online";

export const LOCATION_MODES: LocationMode[] = ["vor_ort", "buero", "telefon", "online"];

/** Wie die Art im Adminmenue und in Mails heisst. */
export const LOCATION_LABEL: Record<LocationMode, string> = {
  vor_ort: "Beim Kunden vor Ort",
  buero: "Bei uns im Büro",
  telefon: "Telefontermin",
  online: "Onlinetermin",
};

/** Eingabe aus Datenbank oder Formular auf eine bekannte Art bringen. */
export function asLocationMode(v: unknown): LocationMode {
  const s = String(v ?? "").trim();
  return (LOCATION_MODES as string[]).includes(s) ? (s as LocationMode) : "vor_ort";
}

/**
 * Fahren wir zum Kunden? Nur dann spielen Adresse, Fahrzeit-Puffer und
 * Einsatzradius eine Rolle.
 */
export const brauchtAnfahrt = (mode: unknown): boolean => asLocationMode(mode) === "vor_ort";

/** Muss der Kunde eine Adresse angeben? Gleiche Antwort, eigener Name. */
export const brauchtAdresse = (mode: unknown): boolean => asLocationMode(mode) === "vor_ort";

/**
 * Ohne Rufnummer ist ein Telefontermin wertlos — niemand weiss, wen er anrufen
 * soll. Deshalb ist sie dort Pflicht, sonst freiwillig.
 */
export const brauchtTelefon = (mode: unknown): boolean => asLocationMode(mode) === "telefon";

/** Braucht dieser Termin einen Videoraum? */
export const brauchtVideoLink = (mode: unknown): boolean => asLocationMode(mode) === "online";

export interface OfficeAddress {
  street?: string | null;
  zip?: string | null;
  city?: string | null;
}

/** „Otto-Hahn-Straße 3, 71364 Winnenden" — aus `legal_info`. */
export function formatOffice(a: OfficeAddress | null | undefined): string {
  if (!a) return "";
  const zeile2 = [a.zip, a.city].filter(Boolean).join(" ").trim();
  return [a.street, zeile2].filter(Boolean).join(", ").trim();
}

/** Der Standard-Dienst. Ueberschreibbar ueber `booking_jitsi_base`. */
export const JITSI_DEFAULT = "https://meet.jit.si";

/**
 * Ein Videoraum fuer GENAU diesen Termin.
 *
 * Der Raumname muss unerratbar sein: bei Jitsi Meet kommt jeder in einen Raum,
 * der den Namen kennt. „montage-09-10" waere in zwei Versuchen geraten. Deshalb
 * ein Zufallsanteil aus `crypto`, und der Terminname nur als lesbares Praefix.
 */
export function jitsiUrl(basis: string | null | undefined, label: string): string {
  const base = String(basis || "").trim().replace(/\/+$/, "") || JITSI_DEFAULT;
  const kurz = String(label || "termin")
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" }[c] ?? c))
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "termin";
  const zufall = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${base}/${kurz}-${zufall}`;
}

export interface TreffpunktArgs {
  mode: unknown;
  /** Adresse des Kunden (nur bei `vor_ort` von Bedeutung). */
  customerAddress?: string | null;
  /** Unsere Adresse aus `legal_info` (nur bei `buero`). */
  office?: string | null;
  /** Videolink dieser Buchung (nur bei `online`). */
  meetingUrl?: string | null;
  /** Rufnummer des Kunden (nur bei `telefon`). */
  phone?: string | null;
}

/**
 * Der Treffpunkt in einem Satz — dieselbe Formulierung in Bestaetigungsmail,
 * Kalendereintrag (.ics LOCATION) und HERO-Beschreibung. Eine Quelle, damit in
 * der Mail nicht „Büro" und im Kalender die Kundenadresse steht.
 */
export function treffpunktText(a: TreffpunktArgs): string {
  switch (asLocationMode(a.mode)) {
    case "buero": {
      const adresse = String(a.office || "").trim();
      return adresse ? `Bei uns im Büro, ${adresse}` : "Bei uns im Büro";
    }
    case "telefon": {
      const nr = String(a.phone || "").trim();
      return nr ? `Telefontermin, wir rufen an unter ${nr}` : "Telefontermin, wir rufen Sie an";
    }
    case "online": {
      const url = String(a.meetingUrl || "").trim();
      return url ? `Onlinetermin: ${url}` : "Onlinetermin, den Link schicken wir per E-Mail";
    }
    default:
      return String(a.customerAddress || "").trim();
  }
}
