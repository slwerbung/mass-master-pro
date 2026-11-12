// Spec D1: Dateiversionen fuer Druckdateien (je Standort) und Fahrzeuglayouts (je Projekt).
//
// Regeln:
// - Hochladen loescht NIE die alte Datei. Neue Datei(en) unter neuem Pfad hochladen, dann EINE Datenbankfunktion
//   (`add_file_version`): Vorversion abloesen, neue Zeilen, ggf. Freigabe zuruecksetzen (+ Ereignis) – alles oder nichts.
//   Schlaegt sie fehl, werden die gerade hochgeladenen Dateien wieder entfernt.
// - „Datei löschen“ loescht nur die aktuelle Version (`delete_current_version`); die vorige wird wieder aktuell.
// - Aktuell = `superseded_at IS NULL`.
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";

type Client = typeof supabase;
export type VersionKind = "location" | "vehicle";

export interface VersionedRow {
  storage_path: string;
  file_name: string;
  version: number;
  superseded_at: string | null;
  uploaded_at?: string | null;
  uploaded_by?: string | null;
  version_note?: string | null;
}

export interface VersionGroup<T> { version: number; current: boolean; files: T[] }

/** Zeilen zu Versionen gruppieren, neueste zuerst. Die aktuelle Version ist die ohne `superseded_at`. */
export function groupVersions<T extends { version: number; superseded_at: string | null }>(rows: T[]): VersionGroup<T>[] {
  const map = new Map<number, T[]>();
  for (const r of rows) (map.get(r.version) ?? map.set(r.version, []).get(r.version)!).push(r);
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([version, files]) => ({ version, current: files.some((f) => !f.superseded_at), files }));
}

/** Nur die Zeilen der aktuellen Version. */
export const currentRows = <T extends { superseded_at: string | null }>(rows: T[]) => rows.filter((r) => !r.superseded_at);

/** Dateiname fuer Storage: der Bucket lehnt Umlaute, Leerzeichen und Klammern ab. */
export function safeStorageName(name: string): string {
  return (name || "datei")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "datei";
}

export interface UploadOpts {
  resetApproval: boolean;
  note?: string;
  /** Offene Markierungen der Vorversion als umgesetzt markieren */
  resolveOpen?: boolean;
}
export interface UploadResult { version: number; previousVersion: number | null; reset: number; assignments: string[] }

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

async function uploadVersion(
  kind: VersionKind, ownerId: string, files: { blob: Blob; name: string }[], opts: UploadOpts, sb: Client,
): Promise<UploadResult> {
  if (!files.length) throw new Error("Keine Datei ausgewählt.");
  const prefix = kind === "location" ? `pdfs/${ownerId}` : `vehicle-layouts/${ownerId}`;
  const uploaded: { storage_path: string; file_name: string }[] = [];
  try {
    // 1. Neue Datei(en) hochladen – eindeutiger Pfad, nie ueberschreiben.
    for (const f of files) {
      const path = `${prefix}/${Date.now()}_${uid().slice(0, 8)}_${safeStorageName(f.name)}`;
      const { error } = await sb.storage.from("project-files").upload(path, f.blob, { contentType: f.blob.type || undefined });
      if (error) throw new Error("Upload fehlgeschlagen: " + error.message);
      uploaded.push({ storage_path: path, file_name: f.name });
    }
    // 2.–5. in einer Transaktion
    const { data, error } = await (sb as any).rpc("add_file_version", {
      p_kind: kind, p_owner: ownerId, p_files: uploaded, p_reset: opts.resetApproval,
      p_note: opts.note?.trim() || null, p_actor: getSession()?.name || null, p_resolve_open: !!opts.resolveOpen,
    });
    if (error) throw new Error(error.message);
    const r = (data || {}) as any;
    const result: UploadResult = {
      version: Number(r.version) || 1, previousVersion: r.previous_version ?? null, reset: Number(r.reset) || 0,
      assignments: Array.isArray(r.assignments) ? r.assignments.map(String) : [],
    };
    // Freigabe zurueckgesetzt: wie beim Zuruecknehmen durch den Kunden den Abschluss-Status neu rechnen lassen.
    if (result.reset > 0) {
      await Promise.all(result.assignments.map((assignmentId) =>
        sb.functions.invoke("send-notification", { body: { assignmentId, event: "completion", customerName: "", projectNumber: "" } }).catch(() => null)));
    }
    return result;
  } catch (e) {
    // 6. Abbruch: gerade hochgeladene Dateien wieder entfernen – die Vorversion bleibt unangetastet.
    if (uploaded.length) await sb.storage.from("project-files").remove(uploaded.map((u) => u.storage_path)).catch(() => null);
    throw e;
  }
}

export function uploadLocationPrintVersion(locationId: string, files: { blob: Blob; name: string }[], opts: UploadOpts, sb: Client = supabase) {
  return uploadVersion("location", locationId, files, opts, sb);
}

export function uploadVehicleLayoutVersion(projectId: string, file: File, opts: UploadOpts, sb: Client = supabase) {
  return uploadVersion("vehicle", projectId, [{ blob: file, name: file.name }], opts, sb);
}

/** Loescht die aktuelle Version (Zeilen + Dateien). Gibt zurueck, welche Version wieder aktuell ist (oder null). */
export async function deleteCurrentVersion(kind: VersionKind, ownerId: string, sb: Client = supabase): Promise<{ deleted: number | null; restored: number | null }> {
  const { data, error } = await (sb as any).rpc("delete_current_version", { p_kind: kind, p_owner: ownerId });
  if (error) throw new Error(error.message);
  const paths: string[] = Array.isArray(data?.paths) ? data.paths : [];
  if (paths.length) await sb.storage.from("project-files").remove(paths).catch(() => null);
  return { deleted: data?.deleted_version ?? null, restored: data?.restored_version ?? null };
}

/** Text fuer die Rueckfrage vor dem Loeschen. */
export function deleteConfirmText(currentVersion: number | null | undefined, versionCount: number): string {
  if (!currentVersion || versionCount <= 1) return "Datei löschen?";
  return `Version v${currentVersion} löschen? Die vorige Version wird wieder aktuell.`;
}

/** Kunde per Mail über eine neue Version informieren (eine Mail, auch für mehrere Standorte). */
export async function notifyNewVersion(o: {
  projectId: string; kind: VersionKind; email: string; locationIds?: string[]; note?: string; resetApproval: boolean; sb?: Client;
}): Promise<void> {
  const sb = o.sb ?? supabase;
  const { data, error } = await sb.functions.invoke("project-invite", {
    body: {
      action: "notify_new_version", token: getSession()?.authToken, projectId: o.projectId, kind: o.kind,
      locationIds: o.locationIds, note: o.note?.trim() || undefined, email: o.email.trim(), resetApproval: o.resetApproval,
    },
  });
  if (error) {
    const msg = await (error as any)?.context?.json?.().then((b: any) => b?.error).catch(() => null);
    throw new Error(msg || data?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
}

/**
 * „Neu“ beim Kunden: die aktuelle Version ist neuer als die zuletzt freigegebene oder als die beim letzten Besuch
 * gesehene (localStorage je Standort/Layout; ohne Speicher zaehlt nur die Freigabe).
 */
export function isNewForViewer(key: string, currentVersion: number | null | undefined, approvedVersion?: number | null): boolean {
  if (!currentVersion || currentVersion <= 1) return false;
  if (approvedVersion && currentVersion > approvedVersion) return true;
  try {
    const seen = Number(localStorage.getItem(`captfix-seen-version:${key}`) || 0);
    return seen > 0 && currentVersion > seen;
  } catch {
    return false;
  }
}

export function markVersionSeen(key: string, version: number | null | undefined): void {
  if (!version) return;
  try { localStorage.setItem(`captfix-seen-version:${key}`, String(version)); } catch { /* ohne Speicher egal */ }
}
