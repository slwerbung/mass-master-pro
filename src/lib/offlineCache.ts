/**
 * Kleine Einstellungslisten (Feldkonfiguration o. ae.) fuer die Arbeit ohne
 * Netz: Online wird frisch geladen und gemerkt, offline gilt der zuletzt
 * gemerkte Stand. Nur fuer kleine, unkritische Daten (localStorage).
 */
const PREFIX = "mmp_offline_cache_v1:";

export async function cachedQuery<T = any>(
  key: string,
  load: () => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<T | null> {
  const read = (): T | null => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch { return null; }
  };
  if (typeof navigator !== "undefined" && !navigator.onLine) return read();
  try {
    const { data, error } = await load();
    if (error || data == null) return read() ?? data;
    try { localStorage.setItem(PREFIX + key, JSON.stringify(data)); } catch { /* voll – egal */ }
    return data;
  } catch {
    return read();
  }
}
