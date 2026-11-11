// Laden der Online-Fassung darf lokale, noch nicht hochgeladene Arbeit nie
// verwerfen (WER-1937: Detailbilder nach dem Speichern weg, nachtraeglich
// eingetragene Masse weg).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetailImage, Location, Project } from "@/types/project";

const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};

let localProject: Project | null = null;
let flags = { locations: new Map<string, boolean | undefined>(), details: new Map<string, { locationId: string; synced: boolean | undefined }>() };

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("./storageUrl", () => ({ signedFileUrl: vi.fn() }));
vi.mock("./quietTime", () => ({ waitForQuiet: vi.fn() }));
vi.mock("./imageCompression", () => ({ compressImage: vi.fn() }));
vi.mock("./session", () => ({ getSession: () => null }));
vi.mock("./syncStatus", () => ({ startSync: vi.fn(), finishSyncError: vi.fn(), finishSyncSuccess: vi.fn() }));
vi.mock("./indexedDBStorage", () => ({
  indexedDBStorage: {
    getProject: async () => localProject,
    getSyncFlags: async () => flags,
  },
}));

const { mergeWithLocal, markLocationDeleted } = await import("./supabaseSync");

const T0 = new Date("2026-11-11T09:00:00Z");
const later = (s: number) => new Date(T0.getTime() + s * 1000);

const detail = (id: string): DetailImage => ({ id, imageData: "", originalImageData: "", createdAt: T0 });
const loc = (id: string, over: Partial<Location> = {}): Location => ({
  id, locationNumber: id, imageData: "", originalImageData: "", detailImages: [], createdAt: T0, updatedAt: T0, ...over,
});
const project = (locations: Location[]): Project => ({
  id: "p", projectNumber: "WER-1937", locations, floorPlans: [], createdAt: T0, updatedAt: T0,
} as Project);

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  localProject = null;
  flags = { locations: new Map(), details: new Map() };
});

describe("mergeWithLocal", () => {
  it("keeps a new detail image that was never uploaded, even if the location stamp is old", async () => {
    // saveDetailImage hat den Standort frueher nicht gestempelt
    localProject = project([loc("L1", { detailImages: [detail("old"), detail("new")] })]);
    flags.locations.set("L1", true);
    flags.details.set("old", { locationId: "L1", synced: true });
    flags.details.set("new", { locationId: "L1", synced: undefined });

    const remote = [loc("L1", { updatedAt: later(60), detailImages: [detail("old")] })];
    const { locations, kept } = await mergeWithLocal("p", remote);

    expect(locations[0].detailImages!.map((d) => d.id)).toEqual(["old", "new"]);
    expect(kept).toBe(1);
  });

  it("drops a detail image that was on the server and is gone there (deleted elsewhere)", async () => {
    localProject = project([loc("L1", { detailImages: [detail("gone")] })]);
    flags.locations.set("L1", true);
    flags.details.set("gone", { locationId: "L1", synced: true });

    const { locations, kept } = await mergeWithLocal("p", [loc("L1", { updatedAt: later(60) })]);
    expect(locations[0].detailImages).toEqual([]);
    expect(kept).toBe(0);
  });

  it("keeps locally newer measurements and image of a re-measured location", async () => {
    const measured = [{ index: 1, widthMm: 1200, heightMm: 800 }];
    localProject = project([loc("L1", { updatedAt: later(300), areaMeasurements: measured as any })]);
    flags.locations.set("L1", true);

    const { locations, kept } = await mergeWithLocal("p", [loc("L1", { updatedAt: later(60) })]);
    expect(locations[0].areaMeasurements).toEqual(measured);
    // leere Bilddaten = lokaler Blob bleibt unangetastet
    expect(locations[0].imageData).toBe("");
    expect(kept).toBe(1);
  });

  it("takes the remote version when it is newer", async () => {
    localProject = project([loc("L1", { comment: "alt" })]);
    flags.locations.set("L1", true);
    const { locations, kept } = await mergeWithLocal("p", [loc("L1", { updatedAt: later(60), comment: "neu" })]);
    expect(locations[0].comment).toBe("neu");
    expect(kept).toBe(0);
  });

  it("keeps a location that exists only locally and was never uploaded", async () => {
    localProject = project([loc("L1"), loc("L2", { createdAt: later(10) })]);
    flags.locations.set("L1", true);
    const { locations, kept } = await mergeWithLocal("p", [loc("L1")]);
    expect(locations.map((l) => l.id)).toEqual(["L1", "L2"]);
    expect(kept).toBe(1);
  });

  it("drops a location that was on the server and is gone there", async () => {
    localProject = project([loc("L1"), loc("L2")]);
    flags.locations.set("L1", true);
    flags.locations.set("L2", true);
    const { locations } = await mergeWithLocal("p", [loc("L1")]);
    expect(locations.map((l) => l.id)).toEqual(["L1"]);
  });

  it("does not bring back a location deleted here while offline", async () => {
    localProject = project([loc("L1")]);
    flags.locations.set("L1", true);
    markLocationDeleted("L2");
    const { locations } = await mergeWithLocal("p", [loc("L1"), loc("L2")]);
    expect(locations.map((l) => l.id)).toEqual(["L1"]);
  });
});
