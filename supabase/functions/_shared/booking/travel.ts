// Fahrzeit-Anbieter (§8.3).
//
// Zwei Umsetzungen hinter derselben Schnittstelle:
//   * HaversineHeuristicProvider — Luftlinie x Umwegfaktor / Geschwindigkeit.
//     Offline, deterministisch, kostenlos. Liegt im Ort oft zu hoch und auf
//     der Autobahn zu niedrig.
//   * RoutingProvider — echte Fahrzeit ueber OpenRouteService. Braucht einen
//     API-Schluessel und faellt bei fehlendem Schluessel, Zeitueberschreitung
//     oder Fehler auf die Heuristik zurueck. Eine Slot-Berechnung fragt
//     dieselben Punktpaare sehr oft ab, deshalb wird zweistufig gecacht:
//     im Speicher pro Aufruf und optional persistent (DB).
//
// Die Engine kennt nur `minutesBetween` und aendert sich dadurch nicht.

import type { Geo, TravelTimeProvider } from "./types.ts";

function haversineKm(a: Geo, b: Geo): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distanz-Heuristik: Luftlinie x Umwegfaktor / Durchschnittsgeschwindigkeit.
 * Deterministisch und offline — sicherer Default und Rueckfallebene.
 */
export class HaversineHeuristicProvider implements TravelTimeProvider {
  constructor(private avgKmh = 45, private detourFactor = 1.3) {}

  minutesBetween(from: Geo | null | undefined, to: Geo | null | undefined): number {
    if (!from || !to) return 0;
    const km = haversineKm(from, to) * this.detourFactor;
    return Math.round((km / this.avgKmh) * 60);
  }
}

/** Persistenter Cache. Absichtlich minimal, damit travel.ts DB-frei bleibt. */
export interface TravelCache {
  get(key: string): Promise<number | null> | number | null;
  set(key: string, minutes: number): Promise<void> | void;
}

/** Auf ~11 m runden: feiner braucht es fuer Fahrzeiten nicht, und so greift der Cache. */
function coordKey(g: Geo): string {
  return `${g.lat.toFixed(4)},${g.lng.toFixed(4)}`;
}
function pairKey(from: Geo, to: Geo): string {
  return `${coordKey(from)}>${coordKey(to)}`;
}

const ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-car";

export interface RoutingProviderOptions {
  apiKey: string;
  /** Wird benutzt, wenn Routing nicht antwortet oder fehlschlaegt. */
  fallback: TravelTimeProvider;
  cache?: TravelCache;
  /** Nach dieser Zeit gilt der Routing-Aufruf als gescheitert (ms). */
  timeoutMs?: number;
  /** Aufschlag auf die reine Fahrzeit (Parken, Suchen). */
  overheadMin?: number;
  onDiagnostic?: (msg: string) => void;
}

/**
 * Echte Fahrzeit ueber OpenRouteService (Matrix-Endpunkt, ein Punktpaar).
 *
 * Wichtig: Diese Klasse wirft nie. Eine kaputte oder langsame Routing-API darf
 * die Terminsuche nicht lahmlegen — sie fuehrt hier nur dazu, dass wieder
 * geschaetzt wird. Fehler werden einmal pro Instanz gemeldet, nicht pro Aufruf.
 */
export class RoutingProvider implements TravelTimeProvider {
  private memo = new Map<string, number>();
  private warned = false;

  constructor(private opts: RoutingProviderOptions) {}

  async minutesBetween(from: Geo | null | undefined, to: Geo | null | undefined): Promise<number> {
    if (!from || !to) return 0;
    const key = pairKey(from, to);

    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;

    if (this.opts.cache) {
      try {
        const cached = await this.opts.cache.get(key);
        if (cached !== null && cached !== undefined && Number.isFinite(cached)) {
          this.memo.set(key, cached);
          return cached;
        }
      } catch { /* Cache ist Beschleunigung, kein Muss */ }
    }

    const routed = await this.route(from, to);
    const minutes = routed ?? await Promise.resolve(this.opts.fallback.minutesBetween(from, to));

    this.memo.set(key, minutes);
    // Nur echte Routing-Ergebnisse persistieren — Schaetzungen brauchen keinen
    // Cache und wuerden ihn mit Werten fuellen, die spaeter falsch aussehen.
    if (routed !== null && this.opts.cache) {
      try { await this.opts.cache.set(key, minutes); } catch { /* egal */ }
    }
    return minutes;
  }

  /** null = kein Routing-Ergebnis (Aufrufer nimmt dann die Heuristik). */
  private async route(from: Geo, to: Geo): Promise<number | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 4000);
    try {
      const resp = await fetch(ORS_MATRIX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": this.opts.apiKey,
        },
        // ORS erwartet [lng, lat] — nicht [lat, lng].
        body: JSON.stringify({
          locations: [[from.lng, from.lat], [to.lng, to.lat]],
          metrics: ["duration"],
          units: "m",
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok) { this.warn(`Routing HTTP ${resp.status}`); return null; }
      const data = await resp.json();
      const seconds = data?.durations?.[0]?.[1];
      if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
        this.warn("Routing ohne verwertbare Dauer");
        return null;
      }
      return Math.round(seconds / 60) + (this.opts.overheadMin ?? 0);
    } catch (e) {
      this.warn(`Routing fehlgeschlagen: ${(e as Error)?.message || e}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private warn(msg: string) {
    if (this.warned) return;
    this.warned = true;
    this.opts.onDiagnostic?.(msg);
    console.warn("[travel]", msg);
  }
}

export interface TravelSettings {
  mode: "heuristic" | "routing";
  avgKmh: number;
  detourFactor: number;
  overheadMin: number;
  apiKey?: string | null;
}

/**
 * Baut den passenden Anbieter. Ohne Schluessel gibt es immer die Heuristik —
 * so laeuft die Terminsuche auch, bevor ein Routing-Zugang eingerichtet ist.
 */
export function createTravelProvider(
  settings: TravelSettings,
  cache?: TravelCache,
  onDiagnostic?: (msg: string) => void,
): TravelTimeProvider {
  const heuristic = new HaversineHeuristicProvider(settings.avgKmh, settings.detourFactor);
  if (settings.mode !== "routing" || !settings.apiKey) return heuristic;
  return new RoutingProvider({
    apiKey: settings.apiKey,
    fallback: heuristic,
    cache,
    overheadMin: settings.overheadMin,
    onDiagnostic,
  });
}

export { haversineKm, coordKey, pairKey };
