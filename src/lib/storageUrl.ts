// Signierte Links auf den Storage-Bucket `project-files`.
//
// Der Bucket ist nicht mehr oeffentlich. Jede Datei wird nur noch ueber einen
// zeitlich begrenzten, signierten Link ausgeliefert, den Supabase anhand der
// Session ausstellt. Wer keinen Zugriff auf den Datensatz hat, bekommt auch
// keinen Link — und ein alter Link laeuft ab.
//
// Warum ein Cache: Listenansichten fragen denselben Pfad oft mehrfach ab
// (Karte, Vorschaubild, Dialog). Ohne Cache waere das pro Bild ein
// zusaetzlicher Netzwerkaufruf.

import { supabase } from "@/integrations/supabase/client";

const BUCKET = "project-files";
export const DEFAULT_TTL_SECONDS = 3600;

type CacheEntry = { url: string; reuseUntil: number };
const cache = new Map<string, CacheEntry>();

/**
 * Wie lange ein gecachter Link wiederverwendet wird. Bewusst kuerzer als seine
 * Gueltigkeit, damit ein Link nicht ablaeuft, waehrend jemand ihn gerade
 * benutzt (grosses PDF, langsame Verbindung).
 */
function reuseWindowMs(expiresIn: number) {
  return Math.max(expiresIn - 300, Math.floor(expiresIn / 2)) * 1000;
}

function fromCache(path: string): string | null {
  const hit = cache.get(path);
  if (hit && hit.reuseUntil > Date.now()) return hit.url;
  if (hit) cache.delete(path);
  return null;
}

/** Einzelner signierter Link. Gibt null zurueck, wenn kein Zugriff besteht. */
export async function signedFileUrl(
  path?: string | null,
  expiresIn = DEFAULT_TTL_SECONDS,
): Promise<string | null> {
  if (!path) return null;
  const cached = fromCache(path);
  if (cached) return cached;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, reuseUntil: Date.now() + reuseWindowMs(expiresIn) });
  return data.signedUrl;
}

/**
 * Mehrere Pfade auf einmal — ein Aufruf statt n. Das Ergebnis enthaelt nur
 * Pfade, die tatsaechlich signiert werden konnten.
 */
export async function signedFileUrls(
  paths: (string | null | undefined)[],
  expiresIn = DEFAULT_TTL_SECONDS,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];

  for (const p of new Set(paths.filter(Boolean) as string[])) {
    const cached = fromCache(p);
    if (cached) out[p] = cached;
    else missing.push(p);
  }
  if (missing.length === 0) return out;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(missing, expiresIn);
  if (error || !data) return out;

  for (const row of data) {
    // createSignedUrls liefert pro Pfad einen eigenen Fehler statt abzubrechen.
    if (!row?.signedUrl || !row.path) continue;
    out[row.path] = row.signedUrl;
    cache.set(row.path, { url: row.signedUrl, reuseUntil: Date.now() + reuseWindowMs(expiresIn) });
  }
  return out;
}

/** Beim Abmelden bzw. Nutzerwechsel: fremde Links duerfen nicht liegenbleiben. */
export function clearSignedUrlCache() {
  cache.clear();
}
