/**
 * Integrationstest Sync v2: zwei (drei) simulierte Geraete gegen eine echte
 * Postgres-Datenbank mit der Migration sync_v2 (RPCs, Trigger).
 *
 * Laeuft nur mit SYNC_PG_URL (siehe scripts/test-sync-integration.sh), sonst
 * uebersprungen. Jedes Geraet hat eigene IndexedDB (fake-indexeddb), eigenes
 * localStorage und eigene Modul-Instanzen der Engine.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import path from "node:path";

const PG_URL = process.env.SYNC_PG_URL;

// ── Gemeinsamer "Server" ────────────────────────────────────────────────────
let pg: any;
const storage = new Map<string, Blob>();
let online = true;

const ARG_TYPES: Record<string, string> = {
  p_kind: "text", p_id: "uuid", p_changes: "jsonb", p_create: "jsonb", p_force: "text[]",
  p_slot: "text", p_path: "text", p_base: "text",
};

function offlineError() { return { data: null, error: { message: "Failed to fetch" } }; }

function query(table: string) {
  const where: string[] = [];
  const params: any[] = [];
  let cols = "*";
  let single = false;
  const b: any = {
    select(c: string) { cols = c; return b; },
    eq(c: string, v: any) { params.push(v); where.push(`${c} = $${params.length}`); return b; },
    in(c: string, v: any[]) { params.push(v); where.push(`${c} = any($${params.length})`); return b; },
    order() { return b; },
    maybeSingle() { single = true; return b; },
    then(res: any, rej: any) {
      if (!online) return Promise.resolve(offlineError()).then(res, rej);
      const sql = `select ${cols} from public.${table}${where.length ? " where " + where.join(" and ") : ""}`;
      return pg.query(sql, params).then(
        (r: any) => ({ data: single ? r.rows[0] ?? null : r.rows, error: null }),
        (e: any) => ({ data: null, error: { message: e.message } }),
      ).then(res, rej);
    },
  };
  return b;
}

const fakeSupabase = {
  from: (t: string) => query(t),
  async rpc(fn: string, args: Record<string, any>) {
    if (!online) return offlineError();
    const names = Object.keys(args);
    const type = (n: string) => (n === "p_force" && fn === "sync_set_image" ? "boolean" : ARG_TYPES[n] || "text");
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}::${type(n)}`).join(", ")}) as r`;
    const vals = names.map((n) => (ARG_TYPES[n] === "jsonb" && args[n] != null ? JSON.stringify(args[n]) : args[n]));
    try { const r = await pg.query(sql, vals); return { data: r.rows[0].r, error: null }; }
    catch (e: any) { return { data: null, error: { message: e.message } }; }
  },
  storage: {
    from: () => ({
      async upload(p: string, blob: Blob) {
        if (!online) throw new TypeError("Failed to fetch");
        if (storage.has(p)) return { error: { message: "The resource already exists" } };
        storage.set(p, blob); return { error: null };
      },
      async remove(paths: string[]) { for (const p of paths) storage.delete(p); return { error: null }; },
    }),
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel() {},
};

vi.mock("@/integrations/supabase/client", () => ({ supabase: fakeSupabase }));
vi.mock("@/lib/storageUrl", () => ({ signedFileUrl: async (p: string) => (p ? `mem://${p}` : null) }));
vi.mock("@/lib/quietTime", () => ({ waitForQuiet: async () => {}, isQuiet: () => true, setInAppCameraOpen: () => {} }));
vi.mock("@/lib/session", () => ({ getSession: () => ({ role: "employee", id: EMPLOYEE, name: "Test" }) }));

const EMPLOYEE = "99999999-9999-9999-9999-999999999999";

// ── Geraete ─────────────────────────────────────────────────────────────────
class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

interface Device {
  name: string;
  idb: IDBFactory;
  ls: MemStorage;
  engine: typeof import("./engine");
  store: typeof import("@/lib/indexedDBStorage");
}

let current: Device | null = null;
function use(d: Device) {
  current = d;
  (globalThis as any).indexedDB = d.idb;
  (globalThis as any).localStorage = d.ls;
}

async function makeDevice(name: string): Promise<Device> {
  const idb = new IDBFactory();
  const ls = new MemStorage();
  (globalThis as any).indexedDB = idb;
  (globalThis as any).localStorage = ls;
  vi.resetModules();
  const engine = await import("./engine");
  const store = await import("@/lib/indexedDBStorage");
  const d = { name, idb, ls, engine, store };
  use(d);
  return d;
}

async function on<T>(d: Device, fn: () => Promise<T>): Promise<T> {
  use(d);
  const r = await fn();
  await d.engine.downloadsIdle();
  return r;
}

const jpeg = (label: string) => new Blob([`JPEG:${label}:`.padEnd(64 + label.length, "x")], { type: "image/jpeg" });
const dataUrl = async (b: Blob) => `data:image/jpeg;base64,${Buffer.from(await b.arrayBuffer()).toString("base64")}`;

async function sync(d: Device, projectId: string) {
  await on(d, async () => {
    d.engine.requestPush(projectId, 0);
    await d.engine.flushNow();
    await d.engine.pullProject(projectId);
  });
}

async function localLocation(d: Device, id: string) {
  return on(d, async () => (await d.store.indexedDBStorage.getLocationsByProject(PROJECT, true, true)).find((l) => l.id === id));
}

const PROJECT = "11111111-0000-0000-0000-000000000001";
const LOC1 = "22222222-0000-0000-0000-000000000001";
const LOC2 = "22222222-0000-0000-0000-000000000002";
const DETAIL1 = "33333333-0000-0000-0000-000000000001";

describe.skipIf(!PG_URL)("Sync v2 – zwei Geraete gegen echte DB", () => {
  let A: Device;
  let B: Device;

  beforeAll(async () => {
    // Node kennt kein FileReader (indexedDBStorage liest Blobs als data-URL).
    (globalThis as any).FileReader = class {
      result: string | null = null; error: unknown = null;
      onloadend: (() => void) | null = null; onerror: ((e: unknown) => void) | null = null;
      readAsDataURL(b: Blob) {
        b.arrayBuffer().then((buf) => {
          this.result = `data:${b.type || "application/octet-stream"};base64,${Buffer.from(buf).toString("base64")}`;
          this.onloadend?.();
        }, (e) => { this.error = e; this.onerror?.(e); });
      }
    };
    Object.defineProperty(globalThis, "navigator", { value: { get onLine() { return online; } }, configurable: true });
    (globalThis as any).fetch = async (url: string) => {
      const p = String(url).replace("mem://", "");
      const blob = storage.get(p);
      return blob ? { ok: true, blob: async () => blob } : { ok: false };
    };
    const { Client } = await import("pg");
    pg = new Client({ connectionString: PG_URL });
    await pg.connect();
    const root = path.resolve(__dirname, "../../..");
    await pg.query("drop schema if exists public cascade; create schema public; drop schema if exists storage cascade; drop publication if exists supabase_realtime;");
    await pg.query(readFileSync(path.join(root, "supabase/tests/sync_v2_stub_schema.sql"), "utf8"));
    await pg.query(readFileSync(path.join(root, "supabase/migrations/20261124120000_sync_v2.sql"), "utf8"));
    A = await makeDevice("A");
    B = await makeDevice("B");
  });

  afterAll(async () => { await pg?.end(); });

  it("Geraet A legt offline Projekt + Standort mit Foto an und laedt spaeter hoch", async () => {
    online = false;
    await on(A, async () => {
      const s = A.store.indexedDBStorage;
      await s.saveProject({ id: PROJECT, projectNumber: "WER-1", projectType: "aufmass", customFields: { a: "1" }, employeeId: EMPLOYEE, accessEmployeeIds: [EMPLOYEE], locations: [], createdAt: new Date(), updatedAt: new Date() } as any);
      await s.addLocation(PROJECT, { id: LOC1, locationNumber: "1", comment: "Eingang", imageData: await dataUrl(jpeg("A1")), originalImageData: await dataUrl(jpeg("A1-orig")), createdAt: new Date() } as any);
      A.engine.requestPush(PROJECT, 0);
      await A.engine.flushNow();
    });
    expect((await pg.query("select count(*)::int n from projects")).rows[0].n).toBe(0);

    online = true;
    await sync(A, PROJECT);
    const loc = (await pg.query("select * from locations where id=$1", [LOC1])).rows[0];
    expect(loc.comment).toBe("Eingang");
    const imgs = (await pg.query("select image_type, storage_path from location_images where location_id=$1 order by image_type", [LOC1])).rows;
    expect(imgs.map((r: any) => r.image_type)).toEqual(["annotated", "original"]);
    expect(await storage.get(imgs[0].storage_path)!.text()).toContain("JPEG:A1:");
    expect(await on(A, () => A.engine.hasLocalChanges(PROJECT))).toBe(false);
  });

  it("Geraet B laedt das Projekt samt Foto", async () => {
    await sync(B, PROJECT);
    const loc = await localLocation(B, LOC1);
    expect(loc?.comment).toBe("Eingang");
    expect(Buffer.from(loc!.imageData.split(",")[1], "base64").toString()).toContain("JPEG:A1:");
    expect(await on(B, () => B.engine.hasLocalChanges(PROJECT))).toBe(false);
  });

  it("Verschiedene Felder gleichzeitig: nichts wird ueberschrieben (der alte Fehler)", async () => {
    await on(A, () => A.store.indexedDBStorage.updateLocationMetadata(PROJECT, LOC1, { comment: "Eingang links" }));
    await on(B, () => B.store.indexedDBStorage.updateLocationMetadata(PROJECT, LOC1, { label: "Tür 1" }));
    await sync(A, PROJECT);
    await sync(B, PROJECT); // B hatte das Projekt offen, mit altem Kommentar
    await sync(A, PROJECT);
    const row = (await pg.query("select comment, label from locations where id=$1", [LOC1])).rows[0];
    expect(row).toEqual({ comment: "Eingang links", label: "Tür 1" });
    expect((await localLocation(A, LOC1))?.label).toBe("Tür 1");
    expect((await localLocation(B, LOC1))?.comment).toBe("Eingang links");
  });

  it("Neues Foto auf A kommt auf B an (und alter Pfad wird aufgeraeumt)", async () => {
    const before = (await pg.query("select storage_path from location_images where location_id=$1 and image_type='annotated'", [LOC1])).rows[0].storage_path;
    await on(A, async () => A.store.indexedDBStorage.updateLocationImage(PROJECT, LOC1, await dataUrl(jpeg("A2"))));
    await sync(A, PROJECT);
    const after = (await pg.query("select storage_path from location_images where location_id=$1 and image_type='annotated'", [LOC1])).rows[0].storage_path;
    expect(after).not.toBe(before);
    expect(storage.has(before)).toBe(false);
    await sync(B, PROJECT);
    const loc = await localLocation(B, LOC1);
    expect(Buffer.from(loc!.imageData.split(",")[1], "base64").toString()).toContain("JPEG:A2:");
  });

  it("Gleiches Feld gleichzeitig → Konflikt, nichts ueberschrieben; Entscheidung 'andere'", async () => {
    await on(A, () => A.store.indexedDBStorage.updateLocationMetadata(PROJECT, LOC1, { comment: "von A" }));
    await on(B, () => B.store.indexedDBStorage.updateLocationMetadata(PROJECT, LOC1, { comment: "von B" }));
    await sync(A, PROJECT);
    await sync(B, PROJECT);
    expect((await pg.query("select comment from locations where id=$1", [LOC1])).rows[0].comment).toBe("von A");
    const conflicts = await on(B, () => B.engine.listConflicts(PROJECT));
    expect(conflicts.map((c) => [c.field, c.mine, c.theirs])).toEqual([["comment", "von B", "von A"]]);
    await on(B, () => B.engine.resolveConflict(conflicts[0], "theirs"));
    await sync(B, PROJECT);
    expect((await localLocation(B, LOC1))?.comment).toBe("von A");
    expect(await on(B, () => B.engine.listConflicts(PROJECT))).toHaveLength(0);
    expect((await pg.query("select comment from locations where id=$1", [LOC1])).rows[0].comment).toBe("von A");
  });

  it("Konflikt mit Entscheidung 'meine' setzt die eigene Fassung online", async () => {
    await on(A, () => A.store.indexedDBStorage.updateLocationMetadata(PROJECT, LOC1, { system: "A-System" }));
    await on(B, () => B.store.indexedDBStorage.updateLocationMetadata(PROJECT, LOC1, { system: "B-System" }));
    await sync(A, PROJECT);
    await sync(B, PROJECT);
    const [c] = await on(B, () => B.engine.listConflicts(PROJECT));
    await on(B, () => B.engine.resolveConflict(c, "mine"));
    await sync(B, PROJECT);
    expect((await pg.query("select system from locations where id=$1", [LOC1])).rows[0].system).toBe("B-System");
    await sync(A, PROJECT);
    expect((await localLocation(A, LOC1))?.system).toBe("B-System");
  });

  it("Foto gleichzeitig auf beiden Geraeten geaendert → Bildkonflikt", async () => {
    await on(A, async () => A.store.indexedDBStorage.updateLocationImage(PROJECT, LOC1, await dataUrl(jpeg("A3"))));
    await on(B, async () => B.store.indexedDBStorage.updateLocationImage(PROJECT, LOC1, await dataUrl(jpeg("B3-longer"))));
    await sync(A, PROJECT);
    await sync(B, PROJECT);
    const path = (await pg.query("select storage_path from location_images where location_id=$1 and image_type='annotated'", [LOC1])).rows[0].storage_path;
    expect(await storage.get(path)!.text()).toContain("JPEG:A3:");
    const conflicts = await on(B, () => B.engine.listConflicts(PROJECT));
    expect(conflicts.map((c) => c.field)).toEqual(["image.annotated"]);
    await on(B, () => B.engine.resolveConflict(conflicts[0], "mine"));
    await sync(B, PROJECT);
    const path2 = (await pg.query("select storage_path from location_images where location_id=$1 and image_type='annotated'", [LOC1])).rows[0].storage_path;
    expect(await storage.get(path2)!.text()).toContain("JPEG:B3-longer:");
    await sync(A, PROJECT);
    const locA = await localLocation(A, LOC1);
    expect(Buffer.from(locA!.imageData.split(",")[1], "base64").toString()).toContain("JPEG:B3-longer:");
  });

  it("Offline auf B: Detailbild + neuer Standort; nach Netz-Rueckkehr online, A sieht beides", async () => {
    online = false;
    await on(B, async () => {
      const s = B.store.indexedDBStorage;
      await s.saveDetailImage(LOC1, { id: DETAIL1, imageData: await dataUrl(jpeg("D1")), originalImageData: await dataUrl(jpeg("D1o")), caption: "Detail", createdAt: new Date() });
      await s.addLocation(PROJECT, { id: LOC2, locationNumber: "2", imageData: await dataUrl(jpeg("L2")), originalImageData: "", createdAt: new Date(), customFields: { custom_x: "7" }, areaMeasurements: [{ index: 1, widthMm: 100, heightMm: 50 }] } as any);
      B.engine.requestPush(PROJECT, 0);
      await B.engine.flushNow();
    });
    expect((await pg.query("select count(*)::int n from locations where id=$1", [LOC2])).rows[0].n).toBe(0);
    expect(await on(B, () => B.engine.hasLocalChanges(PROJECT))).toBe(true);
    online = true;
    await sync(B, PROJECT);
    const l2 = (await pg.query("select custom_fields from locations where id=$1", [LOC2])).rows[0];
    expect(l2.custom_fields).toEqual({ custom_x: "7", __areaMeasurements: [{ index: 1, widthMm: 100, heightMm: 50 }] });
    expect((await pg.query("select caption from detail_images where id=$1", [DETAIL1])).rows[0].caption).toBe("Detail");
    await sync(A, PROJECT);
    const a2 = await localLocation(A, LOC2);
    expect(a2?.customFields).toEqual({ custom_x: "7" });
    expect(a2?.areaMeasurements).toEqual([{ index: 1, widthMm: 100, heightMm: 50 }]);
    const a1 = await localLocation(A, LOC1);
    expect(a1?.detailImages?.map((d) => d.caption)).toEqual(["Detail"]);
    expect(Buffer.from(a1!.detailImages![0].imageData.split(",")[1], "base64").toString()).toContain("JPEG:D1:");
  });

  it("Loeschen auf A entfernt den Standort auch auf B", async () => {
    await on(A, () => A.store.indexedDBStorage.deleteLocation(LOC2));
    await sync(A, PROJECT);
    expect((await pg.query("select count(*)::int n from locations where id=$1", [LOC2])).rows[0].n).toBe(0);
    await sync(B, PROJECT);
    expect(await localLocation(B, LOC2)).toBeUndefined();
  });

  it("Altbestand (vor Sync v2) wird eingeordnet, ohne alles neu hochzuladen", async () => {
    const C = await makeDevice("C");
    // Simuliert alten Stand: Daten wie frueher gespeichert, keine Basis, Blobs ohne Pfad.
    await on(C, async () => {
      const s = C.store.indexedDBStorage;
      await s.saveProject({ id: PROJECT, projectNumber: "WER-1", projectType: "aufmass", employeeId: EMPLOYEE, accessEmployeeIds: [EMPLOYEE], locations: [
        { id: LOC1, locationNumber: "1", comment: "alter Stand", imageData: await dataUrl(jpeg("old")), originalImageData: "", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") },
      ], createdAt: new Date("2026-01-01"), updatedAt: new Date() } as any);
      await s.markLocationsSynced([LOC1]);
    });
    const uploadsBefore = storage.size;
    await sync(C, PROJECT);
    expect(storage.size).toBe(uploadsBefore); // nichts neu hochgeladen
    const loc = await localLocation(C, LOC1);
    expect(loc?.comment).toBe("von A"); // Online-Fassung uebernommen
    expect(Buffer.from(loc!.imageData.split(",")[1], "base64").toString()).toContain("JPEG:B3-longer:");
    expect((await pg.query("select comment from locations where id=$1", [LOC1])).rows[0].comment).toBe("von A");
    expect(await on(C, () => C.engine.hasLocalChanges(PROJECT))).toBe(false);
  });
});
