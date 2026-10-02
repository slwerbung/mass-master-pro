// HERO-Anbindung und Geocoding fuer die Terminbuchung.
//
// Feldnamen sind NICHT geraten: jede Abfrage hier benutzt nur Felder, die in
// diesem Repo bereits produktiv gegen HERO laufen —
//   * project_matches / customer / project.address
//     aus submit-vehicle-request (heroCreateProjectGraphQL + _debug "existing")
//   * contacts mit address { street city zipcode }
//     aus submit-vehicle-request (heroSearchContactByEmail)
//   * create_calendar_event aus _shared/automations.ts
// Ein unbekanntes Feld laesst eine GraphQL-Abfrage komplett scheitern, deshalb
// wird hier nichts "auf Verdacht" mitabgefragt.
//
// Zu create_calendar_event: die Mutation ist in HERO als deprecated markiert
// und taucht deshalb in der Introspection nur mit
// `fields(includeDeprecated: true)` auf. Sie funktioniert weiterhin (unsere
// Automationen legen so seit Monaten Termine an); der in der Deprecation
// genannte Nachfolger Calendar_CreateCalendarEvent existiert in der externen
// API NICHT. Also nicht "modernisieren".

import type { Geo } from "./types.ts";

const HERO_V7 = "https://login.hero-software.de/api/external/v7/graphql";
const HERO_V9 = "https://login.hero-software.de/api/external/v9/graphql";
const ORS_GEOCODE = "https://api.openrouteservice.org/geocode/search";
const TZ = "Europe/Berlin";

/**
 * Zeitpunkt -> HERO-Zeit.
 *
 * HERO rechnet NICHT mit Zeitzonen. Die API haengt an jede Zeit "+00:00",
 * gemeint ist aber die Uhrzeit, die in HERO auf dem Bildschirm steht — also
 * Ortszeit. Wer einen echten UTC-Zeitpunkt schickt, bekommt einen Termin, der
 * im Sommer zwei Stunden zu frueh steht: im Test wurde 14:00 gebucht und HERO
 * zeigte 12:00 (Event 6440204, Rueckfrage des Nutzers).
 *
 * Deshalb wird hier die BERLINER WANDUHRZEIT geschickt und mit "+00:00"
 * beschriftet — dann steht in HERO genau das, was der Kunde gewaehlt hat.
 * Kein luxon: `hero.ts` haengt auch in Functions ohne Import-Map (booking-admin).
 */
export function toHeroTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+00:00`;
}

/**
 * HERO-Zeit -> die Uhrzeit, die dort steht (ohne Zonenangabe).
 *
 * Gegenstueck zu `toHeroTime`: der Offset in der Antwort ist bedeutungslos,
 * entscheidend sind die ersten 19 Zeichen. Wer sie als UTC liest, legt jeden
 * HERO-Termin zwei Stunden zu spaet ab — dann blockiert ein Termin um 14 Uhr
 * die Zeit um 16 Uhr, und 14 Uhr sieht frei aus (genau so passiert).
 */
export function heroWallClock(value: string): string {
  return String(value || "").slice(0, 19);
}

export interface HeroAddress {
  street?: string | null;
  zipcode?: string | null;
  city?: string | null;
}
export interface HeroContext {
  heroProjectId: number;
  projectNumber: string;
  projectName: string | null;
  customerName: string;
  contact: { name: string; email: string | null; phone: string | null };
  address: HeroAddress | null;
  /** Woher die Adresse stammt — steht so auch in der Buchung und der Mail. */
  addressSource: "project" | "customer" | null;
}

async function heroPost(apiKey: string, url: string, query: string, variables?: Record<string, unknown>) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HERO HTTP ${resp.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  if (data.errors?.length) throw new Error(data.errors[0]?.message || "HERO GraphQL-Fehler");
  return data.data;
}

function addressComplete(a: HeroAddress | null | undefined): boolean {
  // Ohne PLZ ist eine Adresse fuer Geocoding und Fahrzeit praktisch wertlos.
  return !!(a && a.zipcode && String(a.zipcode).trim());
}

export function formatAddress(a: HeroAddress | null | undefined): string {
  if (!a) return "";
  const line2 = [a.zipcode, a.city].filter(Boolean).join(" ").trim();
  return [a.street, line2].filter(Boolean).join(", ").trim();
}

/**
 * Laedt alles, was die Buchungsseite ueber ein Projekt wissen muss.
 *
 * Adress-Reihenfolge wie abgestimmt: Objektadresse des Projekts, sonst die
 * Adresse des Kunden. Findet sich beides nicht, bleibt address null — dann
 * muss der Kunde sie auf der Seite selbst eintragen.
 *
 * Die OBJEKTADRESSE haengt am `project_match` selbst. `project.address` ist
 * etwas anderes: dort steht in der Praxis die Adresse des Kunden. Wir haben
 * zuerst nur die gelesen — im Test stand deshalb die Kundenadresse im
 * Kalender statt der Baustelle (WER-1760: Objekt „Torstraße 10", gezeigt
 * wurde „Otto-Hahn-Straße 3").
 */
export async function loadHeroContext(apiKey: string, heroProjectId: number): Promise<HeroContext | null> {
  const query = `
    query Ctx($ids: [Int]) {
      project_matches(ids: $ids) {
        id
        project_nr
        name
        address { street city zipcode }
        customer { id first_name last_name company_name email }
        project { id address { street city zipcode } }
      }
    }
  `;
  const data = await heroPost(apiKey, HERO_V7, query, { ids: [heroProjectId] });
  const pm = data?.project_matches?.[0];
  if (!pm) return null;

  const cust = pm.customer ?? {};
  const customerName = String(
    cust.company_name || [cust.first_name, cust.last_name].filter(Boolean).join(" ") || "",
  ).trim();

  const alsAdresse = (a: any): HeroAddress | null =>
    a ? { street: a.street, zipcode: a.zipcode, city: a.city } : null;
  // Objektadresse zuerst, dann die Adresse am Projektdatensatz.
  const objektAddress = alsAdresse(pm.address);
  const projectAddress = addressComplete(objektAddress) ? objektAddress : alsAdresse(pm.project?.address);

  let address = addressComplete(projectAddress) ? projectAddress : null;
  let addressSource: HeroContext["addressSource"] = address ? "project" : null;
  let phone: string | null = null;

  // Kundendatensatz nur laden, wenn er gebraucht wird — fuer die Telefonnummer
  // immer, fuer die Adresse nur als Rueckfallebene.
  if (cust.id) {
    try {
      const cq = `
        query C($ids: [Int]) {
          contacts(ids: $ids) {
            id phone_home phone_mobile
            address { street city zipcode }
          }
        }
      `;
      const cd = await heroPost(apiKey, HERO_V7, cq, { ids: [Number(cust.id)] });
      const c = cd?.contacts?.[0];
      if (c) {
        phone = c.phone_mobile || c.phone_home || null;
        if (!address && addressComplete(c.address)) {
          address = { street: c.address.street, zipcode: c.address.zipcode, city: c.address.city };
          addressSource = "customer";
        }
      }
    } catch (e) {
      // Kein Grund, die ganze Buchungsseite scheitern zu lassen.
      console.warn("[hero] Kontaktdetails nicht ladbar:", (e as Error)?.message);
    }
  }

  return {
    heroProjectId,
    projectNumber: String(pm.project_nr || ""),
    projectName: pm.name ?? null,
    customerName,
    contact: {
      name: [cust.first_name, cust.last_name].filter(Boolean).join(" ").trim() || customerName,
      email: cust.email ?? null,
      phone,
    },
    address,
    addressSource,
  };
}

/**
 * Projekt in HERO anhand der NUMMER finden.
 *
 * Gebraucht fuer Links aus HERO-Mailvorlagen: dort gibt es nur
 * `{{ProjectMatch.display_id}}` (die reine Zahl, z.B. "1744") — eine
 * Projekt-ID als Platzhalter existiert nicht. `relative_id` ist genau diese
 * Zahl und trifft exakt; `search` waere unscharf.
 *
 * Wichtig fuer den Anwendungsfall: eine Terminmail geht oft raus, BEVOR das
 * Projekt in Captfix existiert (das entsteht erst beim Aufmass). Ohne diesen
 * Weg waere der Link in genau diesen Faellen wertlos.
 */
export async function heroProjectByNumber(
  apiKey: string, nummer: string,
): Promise<{ id: number; projectNumber: string; name: string | null } | null> {
  const zahl = String(nummer || "").replace(/\D/g, "");
  if (!zahl) return null;
  const query = `query ByNr($nr: String) {
    project_matches(relative_id: $nr) { id project_nr name }
  }`;
  try {
    const data = await heroPost(apiKey, HERO_V7, query, { nr: zahl });
    const pm = data?.project_matches?.[0];
    if (!pm?.id) return null;
    return { id: Number(pm.id), projectNumber: String(pm.project_nr || ""), name: pm.name ?? null };
  } catch (e) {
    console.warn("[hero] Projekt zur Nummer nicht ladbar:", (e as Error)?.message);
    return null;
  }
}

/**
 * Legt den Termin in HERO am Projekt an. Gibt die Event-ID zurueck oder null —
 * eine Buchung darf NICHT scheitern, nur weil HERO gerade nicht mag. Der
 * Termin steht dann bei uns und die interne Mail weist darauf hin.
 */
export async function heroCreateAppointment(
  apiKey: string,
  opts: {
    /** null = Termin ohne Projektbezug (Dauerlink eines Mitarbeiters). */
    heroProjectId: number | null;
    title: string;
    /** Echter Zeitpunkt (mit Offset oder Z). Die Umrechnung auf HERO-Zeit
     *  passiert hier, nicht beim Aufrufer — siehe `toHeroTime`. */
    startIso: string;
    endIso: string;
    description?: string;
    categoryId?: number | null;
    partnerId?: number | null;
  },
): Promise<{ id: number | null; error?: string }> {
  // `category_id` ist in HERO PFLICHT. Ohne sie antwortet die API mit
  // "Bitte waehlen Sie eine Kategorie aus" und der Termin entsteht nicht —
  // gegen die echte API geprueft. `project_match_id` ist dagegen optional.
  if (!opts.categoryId) {
    return { id: null, error: "HERO verlangt eine Kategorie (Einstellung „HERO-Kategorie“ ist leer)" };
  }
  const input: Record<string, unknown> = {
    title: opts.title,
    // HERO-Zeit, nicht UTC: sonst steht der Termin zwei Stunden zu frueh.
    start: toHeroTime(opts.startIso),
    end: toHeroTime(opts.endIso),
    category_id: opts.categoryId,
  };
  if (opts.heroProjectId) input.project_match_id = opts.heroProjectId;
  if (opts.description) input.description = opts.description;
  if (opts.partnerId) input.partner_ids = [opts.partnerId];

  const mutation = `mutation Create($calendar_event: CalendarEventInput!) {
    calendar_event: create_calendar_event(calendar_event: $calendar_event) { id }
  }`;
  try {
    const data = await heroPost(apiKey, HERO_V9, mutation, { calendar_event: input });
    const id = data?.calendar_event?.id;
    return { id: id ? Number(id) : null };
  } catch (e) {
    const error = (e as Error)?.message || String(e);
    console.warn("[hero] Termin konnte nicht angelegt werden:", error);
    return { id: null, error };
  }
}

/**
 * Storniert den HERO-Termin. Best effort, wie beim Anlegen.
 *
 * Die Feldauswahl `{ id deleted }` ist Pflicht: `delete_calendar_event` gibt
 * ein CalendarEvent zurueck, und GraphQL lehnt eine Objektrueckgabe ohne
 * Unterauswahl ab ("must have a sub selection"). Ohne sie schlug das Loeschen
 * still fehl — der Termin blieb in HERO stehen, obwohl er bei uns abgesagt war.
 */
export async function heroDeleteAppointment(apiKey: string, eventId: number): Promise<{ ok: boolean; error?: string }> {
  const mutation = `mutation Del($id: Int!) { delete_calendar_event(id: $id) { id deleted } }`;
  try {
    await heroPost(apiKey, HERO_V9, mutation, { id: eventId });
    return { ok: true };
  } catch (e) {
    const error = (e as Error)?.message || String(e);
    console.warn("[hero] Termin konnte nicht entfernt werden:", error);
    return { ok: false, error };
  }
}

// ── Geocoding ──

export interface GeocodeCache {
  get(q: string): Promise<{ lat: number | null; lng: number | null } | null> | { lat: number | null; lng: number | null } | null;
  set(q: string, geo: { lat: number | null; lng: number | null }): Promise<void> | void;
}

const normalizeQuery = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Adresstext -> Koordinaten (OpenRouteService / Pelias, gleicher Schluessel wie
 * das Routing). Gibt null zurueck, wenn nichts gefunden wurde oder kein
 * Schluessel hinterlegt ist; die Engine rechnet dann ohne Fahrzeit weiter.
 *
 * Auch ein Misserfolg wird gecacht, sonst wird bei jeder Kalenderansicht
 * erneut vergeblich gefragt.
 */
export async function geocode(
  text: string,
  apiKey: string | null | undefined,
  cache?: GeocodeCache,
): Promise<Geo | null> {
  const q = normalizeQuery(text || "");
  if (!q) return null;

  if (cache) {
    try {
      const hit = await cache.get(q);
      if (hit) return (hit.lat != null && hit.lng != null) ? { lat: hit.lat, lng: hit.lng } : null;
    } catch { /* Cache ist Beschleunigung */ }
  }
  if (!apiKey) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const url = `${ORS_GEOCODE}?api_key=${encodeURIComponent(apiKey)}&size=1&boundary.country=DE&text=${encodeURIComponent(text)}`;
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) {
      console.warn(`[geocode] HTTP ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    // GeoJSON: coordinates sind [lng, lat] — nicht [lat, lng].
    const c = data?.features?.[0]?.geometry?.coordinates;
    const geo = (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      ? { lat: c[1] as number, lng: c[0] as number }
      : null;
    if (cache) {
      try { await cache.set(q, { lat: geo?.lat ?? null, lng: geo?.lng ?? null }); } catch { /* egal */ }
    }
    return geo;
  } catch (e) {
    console.warn("[geocode] fehlgeschlagen:", (e as Error)?.message || e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
