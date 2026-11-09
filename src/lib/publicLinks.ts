// Kundenseitige Links mit Firmennamen im Pfad (Spec B). Server-Gegenstück: supabase/functions/_shared/publicLinks.ts.
// Kundenlinks NIE aus window.location.origin bauen – immer publicUrl(), damit eigene Domain und Slug stimmen.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PublicLinkConfig { slug: string; baseUrl: string; storedSlug?: string; storedBaseUrl?: string }

const CACHE_KEY = "public_link_config_v1";
let cached: PublicLinkConfig | null = null;
let pending: Promise<PublicLinkConfig | null> | null = null;

function readStored(): PublicLinkConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.slug === "string" && typeof v.baseUrl === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Konfiguration (einmal pro Sitzung vom Server, sonst aus dem Gerätespeicher). null = nicht ladbar. */
export function getPublicLinkConfig(force = false): Promise<PublicLinkConfig | null> {
  if (cached && !force) return Promise.resolve(cached);
  if (pending && !force) return pending;
  pending = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("admin-manage", { body: { action: "get_public_link_config" } });
      if (error || !data?.slug) throw error ?? new Error("leer");
      cached = data as PublicLinkConfig;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ slug: cached.slug, baseUrl: cached.baseUrl })); } catch { /* egal */ }
      return cached;
    } catch {
      cached = cached ?? readStored();
      return cached;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** Nach dem Speichern im Adminmenü: neu laden. */
export function resetPublicLinkConfig() {
  cached = null;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* egal */ }
}

/** Link aus Konfiguration + Pfad (beginnt mit „/“). Ohne Konfiguration: aktuelle Domain ohne Slug (funktioniert trotzdem). */
export function buildPublicUrl(cfg: PublicLinkConfig | null, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!cfg) return `${window.location.origin}${p}`;
  return `${cfg.baseUrl.replace(/\/+$/, "")}/${cfg.slug}${p}`;
}

/** Fertiger Kundenlink (lädt die Konfiguration bei Bedarf). */
export async function publicUrl(path: string): Promise<string> {
  return buildPublicUrl(await getPublicLinkConfig(), path);
}

export function usePublicLinkConfig(): { config: PublicLinkConfig | null; loading: boolean } {
  const [config, setConfig] = useState<PublicLinkConfig | null>(cached);
  const [loading, setLoading] = useState(!cached);
  useEffect(() => {
    let alive = true;
    if (cached) return;
    getPublicLinkConfig().then((c) => { if (alive) { setConfig(c); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  return { config, loading };
}

/** „SL WERBUNG“ → „sl-werbung“ (wie der Server). */
export function slugify(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/g, "");
}
