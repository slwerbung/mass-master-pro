// Der Routing-Anbieter darf die Terminsuche nie zum Absturz bringen. Eine
// kaputte, langsame oder nicht konfigurierte Routing-API muss still auf die
// Schaetzung zurueckfallen — sonst sieht der Kunde eine leere Kalenderseite,
// obwohl Termine frei sind. Genau das pruefen diese Tests.

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  HaversineHeuristicProvider,
  RoutingProvider,
  createTravelProvider,
  type TravelCache,
} from "./travel.ts";

const WAIBLINGEN = { lat: 48.8303, lng: 9.3170 };
const WINNENDEN = { lat: 48.8757, lng: 9.3963 };

const heuristic = new HaversineHeuristicProvider(50, 1.4);

afterEach(() => { vi.unstubAllGlobals(); });

describe("HaversineHeuristicProvider", () => {
  it("liefert 0, wenn ein Punkt fehlt", () => {
    expect(heuristic.minutesBetween(null, WINNENDEN)).toBe(0);
    expect(heuristic.minutesBetween(WAIBLINGEN, undefined)).toBe(0);
  });

  it("schaetzt eine plausible Fahrzeit fuer ~8 km", () => {
    const min = heuristic.minutesBetween(WAIBLINGEN, WINNENDEN);
    expect(min).toBeGreaterThan(5);
    expect(min).toBeLessThan(25);
  });
});

describe("RoutingProvider", () => {
  it("nutzt die echte Fahrzeit und rechnet den Aufschlag dazu", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ durations: [[0, 1320], [1320, 0]] }),  // 22 Min.
      { status: 200 },
    )));
    const p = new RoutingProvider({ apiKey: "k", fallback: heuristic, overheadMin: 5 });
    expect(await p.minutesBetween(WAIBLINGEN, WINNENDEN)).toBe(27);
  });

  it("faellt bei HTTP-Fehler auf die Schaetzung zurueck, ohne zu werfen", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const p = new RoutingProvider({ apiKey: "k", fallback: heuristic });
    const min = await p.minutesBetween(WAIBLINGEN, WINNENDEN);
    expect(min).toBe(heuristic.minutesBetween(WAIBLINGEN, WINNENDEN));
  });

  it("faellt zurueck, wenn fetch selbst wirft", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ENOTFOUND"); }));
    const p = new RoutingProvider({ apiKey: "k", fallback: heuristic });
    await expect(p.minutesBetween(WAIBLINGEN, WINNENDEN)).resolves.toBeTypeOf("number");
  });

  it("faellt zurueck, wenn die Antwort keine Dauer enthaelt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "x" }), { status: 200 })));
    const p = new RoutingProvider({ apiKey: "k", fallback: heuristic });
    expect(await p.minutesBetween(WAIBLINGEN, WINNENDEN))
      .toBe(heuristic.minutesBetween(WAIBLINGEN, WINNENDEN));
  });

  it("fragt dasselbe Punktpaar nur einmal ab", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ durations: [[0, 600], [600, 0]] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const p = new RoutingProvider({ apiKey: "k", fallback: heuristic });
    await p.minutesBetween(WAIBLINGEN, WINNENDEN);
    await p.minutesBetween(WAIBLINGEN, WINNENDEN);
    // Rundung auf 4 Dezimalstellen (~11 m): eine Verschiebung unterhalb dieser
    // Genauigkeit muss denselben Cache-Schluessel ergeben.
    await p.minutesBetween({ lat: 48.830301, lng: 9.317002 }, WINNENDEN);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("liest aus dem persistenten Cache statt zu routen", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const cache: TravelCache = { get: () => 17, set: () => {} };
    const p = new RoutingProvider({ apiKey: "k", fallback: heuristic, cache });
    expect(await p.minutesBetween(WAIBLINGEN, WINNENDEN)).toBe(17);
    expect(f).not.toHaveBeenCalled();
  });

  it("schreibt Routing-Ergebnisse in den Cache, Schaetzungen nicht", async () => {
    const written: Record<string, number> = {};
    const cache: TravelCache = { get: () => null, set: (k, m) => { written[k] = m; } };

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ durations: [[0, 900], [900, 0]] }), { status: 200 })));
    await new RoutingProvider({ apiKey: "k", fallback: heuristic, cache }).minutesBetween(WAIBLINGEN, WINNENDEN);
    expect(Object.keys(written)).toHaveLength(1);

    for (const k of Object.keys(written)) delete written[k];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    await new RoutingProvider({ apiKey: "k", fallback: heuristic, cache }).minutesBetween(WAIBLINGEN, WINNENDEN);
    expect(Object.keys(written)).toHaveLength(0);
  });

  it("ueberlebt einen kaputten Cache", async () => {
    const cache: TravelCache = {
      get: () => { throw new Error("db weg"); },
      set: () => { throw new Error("db weg"); },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ durations: [[0, 600], [600, 0]] }), { status: 200 })));
    const p = new RoutingProvider({ apiKey: "k", fallback: heuristic, cache });
    expect(await p.minutesBetween(WAIBLINGEN, WINNENDEN)).toBe(10);
  });
});

describe("createTravelProvider", () => {
  const base = { avgKmh: 50, detourFactor: 1.4, overheadMin: 5 };

  it("nimmt die Schaetzung, solange kein Schluessel hinterlegt ist", () => {
    const p = createTravelProvider({ ...base, mode: "routing", apiKey: null });
    expect(p).toBeInstanceOf(HaversineHeuristicProvider);
  });

  it("nimmt die Schaetzung, wenn der Modus nicht routing ist", () => {
    const p = createTravelProvider({ ...base, mode: "heuristic", apiKey: "k" });
    expect(p).toBeInstanceOf(HaversineHeuristicProvider);
  });

  it("nimmt Routing, wenn Modus und Schluessel passen", () => {
    const p = createTravelProvider({ ...base, mode: "routing", apiKey: "k" });
    expect(p).toBeInstanceOf(RoutingProvider);
  });
});
