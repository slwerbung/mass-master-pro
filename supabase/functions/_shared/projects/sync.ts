// hero-sync: alle project_matches seitenweise holen und in hero_projects spiegeln.
// Nur LESEN gegen HERO. GraphQL-Fehler stehen im Body (heroGraphql wirft sie).

import { heroGraphql } from "../email/hero.ts";
import { normalizeDocuments } from "./docs.ts";
import { defaultCloseness, defaultExcluded, displayStepName, isClosedKey, stepKey } from "./steps.ts";

type F = typeof fetch;
const PAGE = 50;

export const PROJECTS_QUERY = `query($offset: Int) { project_matches(offset: $offset) {
  id is_deleted project_nr name created
  customer { first_name last_name company_name }
  address { city }
  current_project_match_status { created step_id step { id name } }
  project_match_assignments { user { email } }
  customer_documents { nr type created status_name value }
} }`;

/** Nummernpraefix -> Gewerk (Spec: WER- Werbetechnik, TEX- Textildruck). */
export function gewerkOf(nr: string): string {
  const p = String(nr || "").toUpperCase();
  if (p.startsWith("WER-")) return "Werbetechnik";
  if (p.startsWith("TEX-")) return "Textildruck";
  return "";
}

export interface ProjectUpsert {
  hero_id: number; project_nr: string; name: string; kunde: string; ort: string; gewerk: string;
  step_id: number | null; step_name: string; step_key: string; step_since: string | null;
  assignee_emails: string[]; documents: unknown[]; hero_created: string | null; synced_at: string;
}

/** HERO-Projekt -> Zeile; null bei geloeschten oder nicht mehr offenen (Abgeschlossen/Archiviert) Projekten. */
export function mapProject(pm: any, ignoredEmails: string[], now = new Date()): ProjectUpsert | null {
  if (!pm || pm.is_deleted) return null;
  const st = pm.current_project_match_status;
  const stepName = String(st?.step?.name ?? "");
  const key = stepKey(stepName);
  if (isClosedKey(key)) return null;
  const c = pm.customer;
  const kunde = String(c?.company_name || [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "").trim();
  const ignored = new Set(ignoredEmails.map((e) => e.toLowerCase()));
  const emails = [...new Set((pm.project_match_assignments || [])
    .map((a: any) => String(a?.user?.email || "").trim().toLowerCase())
    .filter((e: string) => e && !ignored.has(e)))] as string[];
  const stepId = st?.step_id ?? st?.step?.id;
  return {
    hero_id: Number(pm.id),
    project_nr: String(pm.project_nr || ""),
    name: String(pm.name || ""),
    kunde,
    ort: String(pm.address?.city || ""),
    gewerk: gewerkOf(pm.project_nr),
    step_id: stepId != null ? Number(stepId) : null,
    step_name: stepName,
    step_key: key,
    step_since: st?.created ? String(st.created) : null,
    assignee_emails: emails,
    documents: normalizeDocuments(pm.customer_documents),
    hero_created: pm.created ? String(pm.created) : null,
    synced_at: now.toISOString(),
  };
}

/** Alle Projekte holen (50 je Seite, drei Seiten parallel; Abbruch bei einer Seite mit weniger als 50). */
export async function fetchAllProjectMatches(apiKey: string, fetchImpl: F = fetch, maxPages = 120): Promise<any[]> {
  const all: any[] = [];
  const seen = new Set<string>();
  let page = 0;
  while (page < maxPages) {
    const batch = [0, 1, 2].map((i) => (page + i) * PAGE);
    const results = await Promise.all(batch.map((offset) => heroGraphql(apiKey, PROJECTS_QUERY, { offset }, fetchImpl)));
    let done = false;
    for (const r of results) {
      const rows: any[] = r?.project_matches || [];
      for (const pm of rows) {
        const id = String(pm?.id);
        if (!seen.has(id)) { seen.add(id); all.push(pm); }
      }
      if (rows.length < PAGE) done = true;
    }
    if (done) return all;
    page += 3;
  }
  throw new Error(`Mehr als ${maxPages * PAGE} Projekte – Abbruch (HERO-Paging prüfen).`);
}

export interface SyncStats { fetched: number; kept: number; removed: number; newSteps: number }

/** Spiegel abgleichen. Geloescht wird nur nach einem VOLLSTAENDIGEN Abruf (Fehler wirft vorher). */
export async function syncProjects(sb: any, apiKey: string, fetchImpl: F = fetch): Promise<SyncStats> {
  const { data: cfg } = await sb.from("app_config").select("value").eq("key", "projects_ignored_assignees").maybeSingle();
  let ignored: string[] = [];
  try { ignored = JSON.parse(cfg?.value || "[]").map(String); } catch { /* leer */ }

  const matches = await fetchAllProjectMatches(apiKey, fetchImpl);
  const rows = matches.map((pm) => mapProject(pm, ignored)).filter((r): r is ProjectUpsert => !!r);

  // Neue Status mit Standardwerten anlegen (bestehende Einstellungen bleiben unberuehrt).
  const { data: known } = await sb.from("project_step_settings").select("step_id");
  const knownIds = new Set((known || []).map((r: any) => Number(r.step_id)));
  const fresh = new Map<number, { step_id: number; name: string; key: string; excluded: boolean; closeness: number }>();
  for (const r of rows) {
    if (r.step_id == null || knownIds.has(r.step_id) || fresh.has(r.step_id)) continue;
    fresh.set(r.step_id, { step_id: r.step_id, name: displayStepName(r.step_name), key: r.step_key, excluded: defaultExcluded(r.step_key), closeness: defaultCloseness(r.step_key) });
  }
  if (fresh.size) {
    const { error } = await sb.from("project_step_settings").upsert([...fresh.values()], { onConflict: "step_id", ignoreDuplicates: true });
    if (error) throw new Error(`project_step_settings: ${error.message}`);
  }

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from("hero_projects").upsert(rows.slice(i, i + 200), { onConflict: "hero_id" });
    if (error) throw new Error(`hero_projects: ${error.message}`);
  }

  const keep = new Set(rows.map((r) => r.hero_id));
  const { data: existing } = await sb.from("hero_projects").select("hero_id");
  const stale = (existing || []).map((r: any) => Number(r.hero_id)).filter((id: number) => !keep.has(id));
  for (let i = 0; i < stale.length; i += 100) {
    const { error } = await sb.from("hero_projects").delete().in("hero_id", stale.slice(i, i + 100));
    if (error) throw new Error(`hero_projects löschen: ${error.message}`);
  }
  return { fetched: matches.length, kept: rows.length, removed: stale.length, newSteps: fresh.size };
}
