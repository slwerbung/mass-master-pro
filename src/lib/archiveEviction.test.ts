import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/indexedDBStorage", () => ({ indexedDBStorage: {} }));
vi.mock("@/lib/supabaseSync", () => ({ hasPendingSync: () => false }));
vi.mock("@/lib/session", () => ({ getSession: () => null }));

import { shouldEvict } from "./archiveEviction";
import { daysUntilArchive } from "./projectArchive";
import { fitWithin, worthReplacing } from "./browserImageResize";

const d = (iso: string) => new Date(iso);

describe("Lokale Kopien archivierter Projekte (Spec E)", () => {
  it("archiviert + synchron → löschen; ungesynct oder Sync offen → behalten; aktiv → behalten", () => {
    expect(shouldEvict({ archived: true, pending: false, localUpdatedAt: d("2026-11-01T10:00:00Z"), serverUpdatedAt: d("2026-11-01T10:00:00Z") })).toBe(true);
    expect(shouldEvict({ archived: true, pending: false, localUpdatedAt: d("2026-11-02T10:00:00Z"), serverUpdatedAt: d("2026-11-01T10:00:00Z") })).toBe(false);
    expect(shouldEvict({ archived: true, pending: true, localUpdatedAt: null, serverUpdatedAt: null })).toBe(false);
    expect(shouldEvict({ archived: false, pending: false, localUpdatedAt: null, serverUpdatedAt: null })).toBe(false);
    // 1 s Toleranz (Server-Stempel nach dem Sync)
    expect(shouldEvict({ archived: true, pending: false, localUpdatedAt: d("2026-11-01T10:00:00.800Z"), serverUpdatedAt: d("2026-11-01T10:00:00Z") })).toBe(true);
  });
  it("Vorwarnung: Tage bis zum Archivieren", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    expect(daysUntilArchive("2026-08-19T12:00:00Z", 90, false, now)).toBe(5);
    expect(daysUntilArchive("2026-08-19T12:00:00Z", 90, true, now)).toBeNull();
    expect(daysUntilArchive("2026-08-19T12:00:00Z", 0, false, now)).toBeNull();
  });
  it("Fotos im Browser: nie vergrößern, nur ersetzen, wenn deutlich kleiner", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ w: 2000, h: 1500 });
    expect(fitWithin(1000, 800, 2000)).toEqual({ w: 1000, h: 800 });
    expect(worthReplacing(1000, 900)).toBe(true);
    expect(worthReplacing(1000, 960)).toBe(false);
  });
});
