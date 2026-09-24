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
 */
export async function loadHeroContext(apiKey: string, heroProjectId: number): Promise<HeroContext | null> {
  const query = `
    query Ctx($ids: [Int]) {
      project_matches(ids: $ids) {
        id
        project_nr
        name
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

  const projectAddress: HeroAddress | null = pm.project?.address
    ? { street: pm.project.address.street, zipcode: pm.project.address.zipcode, city: pm.project.address.city }
    : null;

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
 * Legt den Termin in HERO am Projekt an. Gibt die Event-ID zurueck oder null —
 * eine Buchung darf NICHT scheitern, nur weil HERO gerade nicht mag. Der
 * Termin steht dann bei uns und die interne Mail weist darauf hin.
 */
export async function heroCreateAppointment(
  apiKey: string,
  opts: {
    heroProjectId: number;
    title: string;
    startIso: string;      // mit Offset, z.B. 2026-09-10T09:45:00+02:00
    endIso: string;
    description?: string;
    categoryId?: number | null;
    partnerId?: number | null;
  },
): Promise<{ id: number | null; error?: string }> {
  const input: Record<string, unknown> = {
    title: opts.title,
    start: opts.startIso,
    end: opts.endIso,
    project_match_id: opts.heroProjectId,
  };
  if (opts.description) input.description = opts.description;
  if (opts.categoryId) input.category_id = opts.categoryId;
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
