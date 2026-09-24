// Fahrzeit-Anbieter (§8.3). v1: Heuristik auf Luftlinie. Austauschbar gegen
// Google Distance Matrix o.ä., ohne die Engine-Signatur zu ändern.

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
 * Distanz-Heuristik: Luftlinie × Umwegfaktor / Durchschnittsgeschwindigkeit.
 * Deterministisch und offline — als sicherer Default für v1.
 */
export class HaversineHeuristicProvider implements TravelTimeProvider {
  constructor(private avgKmh = 45, private detourFactor = 1.3) {}

  minutesBetween(from: Geo | null | undefined, to: Geo | null | undefined): number {
    if (!from || !to) return 0;
    const km = haversineKm(from, to) * this.detourFactor;
    return Math.round((km / this.avgKmh) * 60);
  }
}

export { haversineKm };
