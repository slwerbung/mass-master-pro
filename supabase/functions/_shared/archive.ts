// Spec E: Archiv & Speicher – reine Regeln (getestet in archive.test.ts), genutzt von admin-manage und archive-compact.

export type CustomerAccess = "readonly" | "full" | "none";

export interface ArchiveSettings {
  autoArchiveDays: number;          // 0 = automatisches Archivieren aus
  archiveWhenHeroDone: boolean;
  warnDaysBefore: number;
  customerAccessArchived: CustomerAccess;
  compactAfterDays: number;         // 0 = nie komprimieren
  imageMaxPx: number;
  imageQuality: number;
  keepOriginalPhotos: boolean;
  purgeSupersededVersions: boolean;
  deleteMeetingAudio: boolean;
  deletePrintFilesAfterDays: number; // 0 = nie
}

export const DEFAULT_ARCHIVE_SETTINGS: ArchiveSettings = {
  autoArchiveDays: 90, archiveWhenHeroDone: false, warnDaysBefore: 7, customerAccessArchived: "readonly",
  compactAfterDays: 180, imageMaxPx: 2000, imageQuality: 75, keepOriginalPhotos: true,
  purgeSupersededVersions: true, deleteMeetingAudio: true, deletePrintFilesAfterDays: 0,
};

/** Gespeicherten Wert (JSON-Text oder Objekt) mit den Standardwerten zusammenführen – kaputte Werte fallen zurück. */
export function mergeArchiveSettings(raw: unknown): ArchiveSettings {
  let v: any = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = {}; } }
  if (!v || typeof v !== "object") v = {};
  const r = validateArchiveSettings({ ...DEFAULT_ARCHIVE_SETTINGS, ...v });
  return r.ok ? r.settings : DEFAULT_ARCHIVE_SETTINGS;
}

const int = (x: unknown) => (typeof x === "number" && Number.isInteger(x) ? x : typeof x === "string" && /^-?\d+$/.test(x.trim()) ? Number(x) : NaN);
const zeroOr = (n: number, min: number, max: number) => n === 0 || (n >= min && n <= max);

/** Prüfung vor dem Speichern (nur diese Schlüssel, ganze Zahlen, Grenzen laut Spec). */
export function validateArchiveSettings(raw: any): { ok: true; settings: ArchiveSettings } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Einstellungen fehlen." };
  const s = { ...DEFAULT_ARCHIVE_SETTINGS, ...raw };
  const out: ArchiveSettings = {
    autoArchiveDays: int(s.autoArchiveDays), archiveWhenHeroDone: s.archiveWhenHeroDone === true,
    warnDaysBefore: int(s.warnDaysBefore), customerAccessArchived: s.customerAccessArchived,
    compactAfterDays: int(s.compactAfterDays), imageMaxPx: int(s.imageMaxPx), imageQuality: int(s.imageQuality),
    keepOriginalPhotos: s.keepOriginalPhotos !== false, purgeSupersededVersions: s.purgeSupersededVersions !== false,
    deleteMeetingAudio: s.deleteMeetingAudio !== false, deletePrintFilesAfterDays: int(s.deletePrintFilesAfterDays),
  };
  if (!zeroOr(out.autoArchiveDays, 14, 3650)) return { ok: false, error: "Automatisch archivieren: 0 (aus) oder 14 bis 3650 Tage." };
  if (!(out.warnDaysBefore >= 0 && out.warnDaysBefore <= 60)) return { ok: false, error: "Vorwarnung: 0 bis 60 Tage." };
  if (!["readonly", "full", "none"].includes(out.customerAccessArchived)) return { ok: false, error: "Ungültiger Kundenzugriff." };
  if (!zeroOr(out.compactAfterDays, 30, 3650)) return { ok: false, error: "Komprimieren: 0 (nie) oder 30 bis 3650 Tage." };
  if (!(out.imageMaxPx >= 1200 && out.imageMaxPx <= 4000)) return { ok: false, error: "Fotogröße: 1200 bis 4000 px." };
  if (!(out.imageQuality >= 50 && out.imageQuality <= 90)) return { ok: false, error: "Bildqualität: 50 bis 90." };
  if (!zeroOr(out.deletePrintFilesAfterDays, 30, 3650)) return { ok: false, error: "Druckdateien entfernen: 0 (nie) oder 30 bis 3650 Tage." };
  return { ok: true, settings: out };
}

const DAY = 86400000;

/** Komprimieren fällig? (archiviert seit ≥ compactAfterDays, noch nicht komprimiert) */
export function compactionDue(p: { archived_at: string | null; compacted_at: string | null }, s: ArchiveSettings, now = Date.now()): boolean {
  if (!p.archived_at || p.compacted_at || s.compactAfterDays <= 0) return false;
  return now - Date.parse(p.archived_at) >= s.compactAfterDays * DAY;
}

/** Druckdateien entfernen fällig? (eigener Zeitpunkt archived_at + Z) */
export function printPurgeDue(p: { archived_at: string | null; print_files_purged_at: string | null }, s: ArchiveSettings, now = Date.now()): boolean {
  if (!p.archived_at || p.print_files_purged_at || s.deletePrintFilesAfterDays <= 0) return false;
  return now - Date.parse(p.archived_at) >= s.deletePrintFilesAfterDays * DAY;
}

/** Tage bis zum automatischen Archivieren (negativ = überfällig); null = wird nicht automatisch archiviert. */
export function daysUntilArchive(lastActivityIso: string | null, s: Pick<ArchiveSettings, "autoArchiveDays">, pinned: boolean, now = Date.now()): number | null {
  if (pinned || s.autoArchiveDays <= 0 || !lastActivityIso) return null;
  return Math.ceil((Date.parse(lastActivityIso) + s.autoArchiveDays * DAY - now) / DAY);
}

/**
 * Pfade, die NIE gelöscht werden dürfen: alles, was jemals freigegeben wurde (approval_events „approve“) und die
 * Pfade der aktuell gültigen Freigaben (approved_paths).
 */
export function protectedPaths(events: { action: string; storage_paths: string[] | null }[], approvals: { approved_paths: string[] | null }[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if (e.action === "approve") for (const p of e.storage_paths || []) out.add(p);
  for (const a of approvals) for (const p of a.approved_paths || []) out.add(p);
  return out;
}

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const NOT_IMAGE_EXT = /\.(pdf|ai|eps|svg|webm|ogg|mp3|m4a|wav|mp4|zip|docx?|xlsx?)$/i;

/** Komprimierbares Foto? PDFs/Druckdaten nie. Pfade ohne Endung (images/…/annotated) gelten als Foto, wenn mime passt. */
export function isCompressibleImage(path: string, mime?: string | null): boolean {
  if (NOT_IMAGE_EXT.test(path)) return false;
  if (mime) return /^image\/(jpeg|png|webp)$/i.test(mime);
  return IMAGE_EXT.test(path);
}

/** Lohnt Verkleinern? längere Kante > maxPx oder Datei > 400 KB. */
export function needsResize(bytes: number, dims: { w: number; h: number } | null, maxPx: number): boolean {
  if (dims && Math.max(dims.w, dims.h) > maxPx) return true;
  return bytes > 400 * 1024;
}

/** Zielmaße: längere Kante höchstens maxPx, nie vergrößern. */
export function targetSize(dims: { w: number; h: number }, maxPx: number): { w: number; h: number } {
  const k = Math.min(1, maxPx / Math.max(dims.w, dims.h));
  return { w: Math.max(1, Math.round(dims.w * k)), h: Math.max(1, Math.round(dims.h * k)) };
}

/** Geschätzte Größe nach dem Verkleinern (Testlauf): Pixelverhältnis × Größe (× 0,8 fürs Neukodieren), ohne Verkleinerung ~60 %. */
export function estimateResizedBytes(bytes: number, dims: { w: number; h: number } | null, maxPx: number): number {
  if (!dims) return Math.round(bytes * 0.6);
  const t = targetSize(dims, maxPx);
  const ratio = (t.w * t.h) / (dims.w * dims.h);
  return Math.round(bytes * (ratio < 1 ? ratio * 0.8 : 0.6));
}

/** Bildmaße aus dem Dateikopf (JPEG SOFn / PNG IHDR / WebP VP8X) – ohne das ganze Bild zu dekodieren. */
export function imageDims(b: Uint8Array): { w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" && String.fromCharCode(b[12], b[13], b[14], b[15]) === "VP8X") {
    return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  return null;
}
