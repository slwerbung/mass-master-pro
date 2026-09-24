// Feiertage kommen aus zwei fremden APIs. Deren Antwortformen sind der Teil,
// den wir nicht kontrollieren — und ein falsch gelesener Feiertag heisst
// entweder "Kunde bucht am 1. Mai" oder "ein Arbeitstag fehlt still".
// Deshalb hier die Formate beider Quellen, inklusive der haesslichen Faelle.

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  fetchHolidays,
  isGermanState,
  isIsoDate,
  parseFeiertageApi,
  parseNager,
} from "./holidays.ts";

afterEach(() => { vi.unstubAllGlobals(); });

// Echte Antwortform von feiertage-api.de mit ?nur_land=BW
const FEIERTAGE_FLAT = {
  Neujahrstag: { datum: "2026-01-01", hinweis: "" },
  "Heilige Drei Koenige": { datum: "2026-01-06", hinweis: "" },
  Karfreitag: { datum: "2026-04-03", hinweis: "" },
  "Tag der Arbeit": { datum: "2026-05-01", hinweis: "" },
};

// Dieselbe API ohne nur_land: eine Ebene Bundeslaender davor.
const FEIERTAGE_NESTED = {
  BW: {
    Neujahrstag: { datum: "2026-01-01", hinweis: "" },
    Fronleichnam: { datum: "2026-06-04", hinweis: "" },
  },
  BY: {
    Neujahrstag: { datum: "2026-01-01", hinweis: "" },
    Augsburger: { datum: "2026-08-08", hinweis: "nur Augsburg" },
  },
};

const NAGER = [
  { date: "2026-01-01", localName: "Neujahr", name: "New Year's Day", global: true, counties: null },
  { date: "2026-01-06", localName: "Heilige Drei Koenige", name: "Epiphany", global: false, counties: ["DE-BW", "DE-BY", "DE-ST"] },
  { date: "2026-08-15", localName: "Mariae Himmelfahrt", name: "Assumption Day", global: false, counties: ["DE-BY", "DE-SL"] },
  { date: "2026-10-31", localName: "Reformationstag", name: "Reformation Day", global: false, counties: ["DE-BB", "DE-MV"] },
];

describe("isIsoDate", () => {
  it("nimmt nur JJJJ-MM-TT", () => {
    expect(isIsoDate("2026-01-01")).toBe(true);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate("01.01.2026")).toBe(false);
    expect(isIsoDate(20260101)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});

describe("parseFeiertageApi", () => {
  it("liest die flache Form", () => {
    const list = parseFeiertageApi(FEIERTAGE_FLAT, "BW");
    expect(list).toHaveLength(4);
    expect(list[0]).toEqual({ date: "2026-01-01", name: "Neujahrstag" });
    expect(list.map((h) => h.date)).toEqual([
      "2026-01-01", "2026-01-06", "2026-04-03", "2026-05-01",
    ]);
  });

  it("liest die verschachtelte Form und nimmt nur das eigene Bundesland", () => {
    const list = parseFeiertageApi(FEIERTAGE_NESTED, "BW");
    expect(list.map((h) => h.name)).toEqual(["Neujahrstag", "Fronleichnam"]);
    // Der bayerische Tag darf nicht mitkommen.
    expect(list.some((h) => h.date === "2026-08-08")).toBe(false);
  });

  it("gibt bei einem unbekannten Bundesland in der verschachtelten Form nichts zurueck", () => {
    // Fallback auf die oberste Ebene findet dort keine `datum`-Felder — also
    // eine leere Liste statt Muell. Der Aufrufer faellt dann auf Quelle 2.
    expect(parseFeiertageApi(FEIERTAGE_NESTED, "HH")).toEqual([]);
  });

  it("ueberspringt Eintraege ohne gueltiges Datum", () => {
    const list = parseFeiertageApi({
      Gut: { datum: "2026-05-01" },
      KaputtesDatum: { datum: "01.05.2026" },
      KeinObjekt: "2026-05-01",
      Leer: null,
    }, "BW");
    expect(list).toEqual([{ date: "2026-05-01", name: "Gut" }]);
  });

  it("haelt Unsinn aus", () => {
    expect(parseFeiertageApi(null, "BW")).toEqual([]);
    expect(parseFeiertageApi("kaputt", "BW")).toEqual([]);
    expect(parseFeiertageApi([], "BW")).toEqual([]);
  });

  it("laesst pro Datum nur einen Eintrag stehen", () => {
    // Sonst kollidiert der Upsert auf (date, state_code).
    const list = parseFeiertageApi({
      "Tag der Arbeit": { datum: "2026-05-01" },
      "1. Mai": { datum: "2026-05-01" },
    }, "BW");
    expect(list).toHaveLength(1);
  });
});

describe("parseNager", () => {
  it("nimmt bundesweite Tage und die des eigenen Bundeslands", () => {
    const list = parseNager(NAGER, "BW");
    expect(list.map((h) => h.date)).toEqual(["2026-01-01", "2026-01-06"]);
    expect(list[0].name).toBe("Neujahr");
  });

  it("filtert nach Bundesland", () => {
    expect(parseNager(NAGER, "BY").map((h) => h.date))
      .toEqual(["2026-01-01", "2026-01-06", "2026-08-15"]);
    expect(parseNager(NAGER, "HH").map((h) => h.date)).toEqual(["2026-01-01"]);
  });

  it("behandelt counties: null als bundesweit", () => {
    const list = parseNager([{ date: "2026-12-25", localName: "Weihnachten", counties: null }], "BW");
    expect(list).toHaveLength(1);
  });

  it("faellt auf den englischen Namen zurueck", () => {
    const list = parseNager([{ date: "2026-12-25", name: "Christmas Day", global: true }], "BW");
    expect(list[0].name).toBe("Christmas Day");
  });

  it("haelt Unsinn aus", () => {
    expect(parseNager(null, "BW")).toEqual([]);
    expect(parseNager({ nope: true }, "BW")).toEqual([]);
    expect(parseNager([null, { date: "kaputt" }], "BW")).toEqual([]);
  });

  it("sortiert nach Datum", () => {
    const list = parseNager([
      { date: "2026-12-25", localName: "Weihnachten", global: true },
      { date: "2026-01-01", localName: "Neujahr", global: true },
    ], "BW");
    expect(list.map((h) => h.date)).toEqual(["2026-01-01", "2026-12-25"]);
  });
});

describe("isGermanState", () => {
  it("kennt die 16 Bundeslaender", () => {
    expect(isGermanState("BW")).toBe(true);
    expect(isGermanState("TH")).toBe(true);
    expect(isGermanState("bw")).toBe(false); // Aufrufer normalisiert vorher
    expect(isGermanState("XX")).toBe(false);
    expect(isGermanState("")).toBe(false);
  });
});

describe("fetchHolidays", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  it("nimmt Quelle 1, wenn sie liefert", async () => {
    const fetchMock = vi.fn(async () => ok(FEIERTAGE_FLAT) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { list, source } = await fetchHolidays("BW", 2026);
    expect(source).toBe("feiertage-api.de");
    expect(list).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("nur_land=BW");
  });

  it("faellt auf Quelle 2 zurueck, wenn Quelle 1 ausfaellt", async () => {
    const fetchMock = vi.fn(async (url: unknown) =>
      (String(url).includes("feiertage-api.de")
        ? { ok: false, status: 503, json: async () => ({}) }
        : ok(NAGER)) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { list, source } = await fetchHolidays("BW", 2026);
    expect(source).toBe("date.nager.at");
    expect(list.map((h) => h.date)).toEqual(["2026-01-01", "2026-01-06"]);
  });

  it("faellt auch zurueck, wenn Quelle 1 nur Muell liefert", async () => {
    // HTTP 200, aber ein Format, das wir nicht lesen koennen — praktisch
    // derselbe Ausfall, nur leiser.
    const fetchMock = vi.fn(async (url: unknown) =>
      (String(url).includes("feiertage-api.de")
        ? ok({ irgendwas: "anders" })
        : ok(NAGER)) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { source } = await fetchHolidays("BW", 2026);
    expect(source).toBe("date.nager.at");
  });

  it("wirft, wenn beide Quellen ausfallen — nicht still leer speichern", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(fetchHolidays("BW", 2026)).rejects.toThrow(/feiertage-api\.de.*date\.nager\.at/s);
  });
});
