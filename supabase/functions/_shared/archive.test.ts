import { describe, expect, it } from "vitest";
import {
  compactionDue, daysUntilArchive, DEFAULT_ARCHIVE_SETTINGS as D, estimateResizedBytes, imageDims, isCompressibleImage,
  mergeArchiveSettings, needsResize, printPurgeDue, protectedPaths, targetSize, validateArchiveSettings,
} from "./archive.ts";

const DAY = 86400000;
const now = Date.parse("2026-11-12T12:00:00Z");
const ago = (d: number) => new Date(now - d * DAY).toISOString();

describe("Archiv-Einstellungen (Spec E)", () => {
  it("Standardwerte, wenn nichts oder Unsinn gespeichert ist", () => {
    expect(mergeArchiveSettings(null)).toEqual(D);
    expect(mergeArchiveSettings("kaputt")).toEqual(D);
    expect(mergeArchiveSettings('{"autoArchiveDays":60}').autoArchiveDays).toBe(60);
    expect(mergeArchiveSettings({ imageMaxPx: 99999 })).toEqual(D); // ungültig → Standard
  });
  it("Validierung: ganze Zahlen und Grenzen", () => {
    expect(validateArchiveSettings({ autoArchiveDays: 0 }).ok).toBe(true);
    expect(validateArchiveSettings({ autoArchiveDays: 10 }).ok).toBe(false);
    expect(validateArchiveSettings({ autoArchiveDays: 14.5 }).ok).toBe(false);
    expect(validateArchiveSettings({ compactAfterDays: 29 }).ok).toBe(false);
    expect(validateArchiveSettings({ imageMaxPx: 1199 }).ok).toBe(false);
    expect(validateArchiveSettings({ imageQuality: 91 }).ok).toBe(false);
    expect(validateArchiveSettings({ customerAccessArchived: "alles" }).ok).toBe(false);
    const r = validateArchiveSettings({ autoArchiveDays: "60", keepOriginalPhotos: false });
    expect(r.ok && r.settings.autoArchiveDays).toBe(60);
    expect(r.ok && r.settings.keepOriginalPhotos).toBe(false);
  });
});

describe("Fälligkeit", () => {
  it("Komprimieren nach Y Tagen im Archiv, nur einmal, 0 = nie", () => {
    expect(compactionDue({ archived_at: ago(181), compacted_at: null }, D, now)).toBe(true);
    expect(compactionDue({ archived_at: ago(10), compacted_at: null }, D, now)).toBe(false);
    expect(compactionDue({ archived_at: ago(400), compacted_at: ago(1) }, D, now)).toBe(false);
    expect(compactionDue({ archived_at: null, compacted_at: null }, D, now)).toBe(false);
    expect(compactionDue({ archived_at: ago(400), compacted_at: null }, { ...D, compactAfterDays: 0 }, now)).toBe(false);
  });
  it("Druckdateien entfernen: Standard aus", () => {
    expect(printPurgeDue({ archived_at: ago(999), print_files_purged_at: null }, D, now)).toBe(false);
    expect(printPurgeDue({ archived_at: ago(400), print_files_purged_at: null }, { ...D, deletePrintFilesAfterDays: 365 }, now)).toBe(true);
  });
  it("Warnung „wird in n Tagen archiviert“", () => {
    expect(daysUntilArchive(ago(85), D, false, now)).toBe(5);
    expect(daysUntilArchive(ago(85), D, true, now)).toBeNull();
    expect(daysUntilArchive(ago(85), { autoArchiveDays: 0 }, false, now)).toBeNull();
  });
});

describe("Freigegebene Pfade nie löschen", () => {
  it("aus Ereignissen (approve) und gültigen Freigaben", () => {
    const k = protectedPaths(
      [{ action: "approve", storage_paths: ["a.pdf"] }, { action: "reset_new_version", storage_paths: ["b.pdf"] }, { action: "revoke", storage_paths: null }],
      [{ approved_paths: ["c.pdf"] }, { approved_paths: null }],
    );
    expect([...k].sort()).toEqual(["a.pdf", "c.pdf"]);
  });
});

describe("Fotos", () => {
  it("nur Fotos, nie PDFs/Druckdaten/Audio", () => {
    expect(isCompressibleImage("images/x/annotated", "image/jpeg")).toBe(true);
    expect(isCompressibleImage("vehicle-images/p/a.png")).toBe(true);
    expect(isCompressibleImage("pdfs/x/a.pdf", "image/jpeg")).toBe(false);
    expect(isCompressibleImage("meeting-audio/p/a.webm")).toBe(false);
  });
  it("Verkleinern lohnt bei zu großer Kante oder > 400 KB; nie vergrößern", () => {
    expect(needsResize(100_000, { w: 4000, h: 3000 }, 2000)).toBe(true);
    expect(needsResize(500_000, { w: 1000, h: 800 }, 2000)).toBe(true);
    expect(needsResize(300_000, { w: 1800, h: 1200 }, 2000)).toBe(false);
    expect(targetSize({ w: 4000, h: 3000 }, 2000)).toEqual({ w: 2000, h: 1500 });
    expect(targetSize({ w: 800, h: 600 }, 2000)).toEqual({ w: 800, h: 600 });
  });
  it("Ersparnis-Schätzung (Testlauf)", () => {
    expect(estimateResizedBytes(1_000_000, { w: 4000, h: 3000 }, 2000)).toBe(200_000); // ¼ der Pixel × 0,8
    expect(estimateResizedBytes(1_000_000, { w: 1000, h: 800 }, 2000)).toBe(600_000);
    expect(estimateResizedBytes(1_000_000, null, 2000)).toBe(600_000);
  });
  it("Bildmaße aus dem Dateikopf (PNG, JPEG)", () => {
    const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 1234); new DataView(png.buffer).setUint32(20, 567);
    expect(imageDims(png)).toEqual({ w: 1234, h: 567 });
    // JPEG: SOI, APP0 (Länge 4), SOF0 mit Höhe 300, Breite 400
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0, 0, 0, 0]);
    expect(imageDims(jpg)).toEqual({ w: 400, h: 300 });
    expect(imageDims(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
