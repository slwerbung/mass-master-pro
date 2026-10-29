import { describe, expect, it } from "vitest";
import { dropboxApiArg, findProjectFolder, matchProjectFolder, saveToProjectFolder, subfolderPath, type DropboxApi } from "./dropboxSave.ts";

const settings = {
  enabled: true, basePath: "/Geschäftliches/Kunden", customerPattern: "{kunde}", projectPattern: "{projektnr} {projektname}",
  subfolders: ["01 Gelieferte Daten", "02 Produktion/Druckdaten"], alphaBuckets: true,
};
const project = { id: 77, nr: "WER-753", name: "Beschilderung Bikepark", customerId: 9, customerName: "Stadt Winnenden" };

/** Mini-Supabase: dropbox_synced mit gemerkten Pfaden, merkt sich upserts. */
function fakeSb(rows: { kind: string; hero_id: number; dropbox_path: string | null }[]) {
  const upserts: any[] = [];
  const sb = {
    upserts,
    from: () => {
      const f: Record<string, unknown> = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { f[k] = v; return q; },
        maybeSingle: async () => ({ data: rows.find((r) => r.kind === f.kind && r.hero_id === f.hero_id) ?? null }),
        upsert: async (row: any) => { upserts.push(row); return { error: null }; },
      };
      return q;
    },
  };
  return sb;
}

function fakeApi(folders: Record<string, { name: string; path: string }[]> = {}) {
  const log = { trees: [] as [string, string[]][], uploads: [] as string[] };
  const api: DropboxApi = {
    listFolders: async (p) => folders[p] ?? [],
    ensureTree: async (p, s) => (log.trees.push([p, s]), { ok: true }),
    upload: async (p) => (log.uploads.push(p), { path: p }),
  };
  return { api, log };
}

describe("Projektordner finden", () => {
  it("Ordner mit der Projektnummer am Anfang, nicht WER-7530", () => {
    const fs = [{ name: "WER-7530 Anderes", path: "/a" }, { name: "WER-753 Bikepark", path: "/b" }];
    expect(matchProjectFolder(fs, "WER-753")?.path).toBe("/b");
    expect(matchProjectFolder([{ name: "wer-753_Bikepark", path: "/c" }], "WER-753")?.path).toBe("/c");
    expect(matchProjectFolder(fs, "")).toBeNull();
  });

  it("gemerkter Pfad zuerst", async () => {
    const sb = fakeSb([{ kind: "project", hero_id: 77, dropbox_path: "/K/S/Stadt/WER-753 x" }]);
    expect(await findProjectFolder(sb, "t", settings, project, fakeApi().api)).toEqual({ path: "/K/S/Stadt/WER-753 x", source: "gemerkt" });
  });

  it("im bekannten Kundenordner gefunden, sonst nach Muster neu", async () => {
    const cust = "/Geschäftliches/Kunden/S/Stadt Winnenden";
    const sb = fakeSb([{ kind: "customer", hero_id: 9, dropbox_path: cust }]);
    const hit = fakeApi({ [cust]: [{ name: "WER-753 Bikepark alt", path: `${cust}/WER-753 Bikepark alt` }] });
    expect(await findProjectFolder(sb, "t", settings, project, hit.api)).toEqual({ path: `${cust}/WER-753 Bikepark alt`, source: "gefunden" });
    expect(await findProjectFolder(sb, "t", settings, project, fakeApi().api)).toEqual({ path: `${cust}/WER-753 Beschilderung Bikepark`, source: "neu" });
  });
});

describe("Ablegen", () => {
  it("nur Unterordner aus der Vorlage; leer = Projektordner", () => {
    expect(subfolderPath("/P", "", settings.subfolders)).toBe("/P");
    expect(subfolderPath("/P", "02 Produktion/Druckdaten", settings.subfolders)).toBe("/P/02 Produktion/Druckdaten");
    expect(() => subfolderPath("/P", "../../Privat", settings.subfolders)).toThrow(/Unbekannter Unterordner/);
  });

  it("neuer Projektordner wird mit Vorlage angelegt, Dateien hinzugefuegt, Pfad gemerkt", async () => {
    const sb = fakeSb([]);
    const t = fakeApi();
    const r = await saveToProjectFolder(sb, settings, project, { path: "/P", source: "neu" }, "01 Gelieferte Daten",
      [{ name: "Logo:final?.pdf", bytes: new Uint8Array([1]) }], t.api);
    expect(t.log.trees).toEqual([["/P", settings.subfolders], ["/P/01 Gelieferte Daten", []]]);
    expect(t.log.uploads).toEqual(["/P/01 Gelieferte Daten/Logo-final-.pdf"]);
    expect(r.folder).toBe("/P/01 Gelieferte Daten");
    expect(sb.upserts).toEqual([{ kind: "project", hero_id: 77, dropbox_path: "/P" }]);
  });

  it("vorhandener Ordner: nur Zielordner sicherstellen, gemerkter Pfad nicht neu schreiben", async () => {
    const sb = fakeSb([]);
    const t = fakeApi();
    await saveToProjectFolder(sb, settings, project, { path: "/P", source: "gemerkt" }, "", [{ name: "a.jpg", bytes: new Uint8Array() }], t.api);
    expect(t.log.trees).toEqual([["/P", []]]);
    expect(sb.upserts).toEqual([]);
  });

  it("Umlaute im Header als \\u-Folge", () => {
    expect(dropboxApiArg({ path: "/Geschäftliches/ü" })).toBe('{"path":"/Gesch\\u00e4ftliches/\\u00fc"}');
  });
});
