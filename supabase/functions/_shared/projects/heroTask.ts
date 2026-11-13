// HERO-Arbeitsmodus (Phase 4): "In HERO erledigen" sperrt die Karte 30 Minuten, merkt den Vorher-Stand des Projekts,
// und beim Zurueckkehren wird das Projekt in HERO neu gelesen und mit dem Vorher-Stand verglichen. Passt es nicht, bleibt die
// Karte offen mit Hinweis. HERO wird hier nur GELESEN (Logbuch schreibt der Aufrufer ueber `deps.logbook`, nie im Schattenmodus).

import { confirmations, normalizeDocuments, sentOffers } from "./docs.ts";
import { stepKey } from "./steps.ts";

export type TaskKind = "create_offer" | "finish_offer" | "create_confirmation" | "complaint" | "generic";
export const LOCK_MINUTES = 30;
/** Regel -> Aufgabe. Alles andere ist eine allgemeine Aufgabe ("In HERO erledigen"). */
export const TASK_BY_RULE: Record<string, TaskKind> = {
  anfrage_ohne_angebot: "create_offer", angebot_entwurf: "finish_offer", ab_fehlt: "create_confirmation", reklamation: "complaint",
};
export interface Checklist { label: string; items: string[] }
export const DEFAULT_CHECKLISTS: Record<TaskKind, Checklist> = {
  create_offer: { label: "Angebot erstellen", items: ["Positionen anlegen", "Preise prüfen", "Angebot versenden"] },
  finish_offer: { label: "Angebot fertigstellen", items: ["Entwurf prüfen", "Angebot versenden"] },
  create_confirmation: { label: "AB erstellen", items: ["AB aus dem Angebot erzeugen", "Mengen prüfen", "AB versenden"] },
  complaint: { label: "Reklamation", items: ["Ursache klären", "Lösung mit dem Kunden vereinbaren", "Status in HERO weitersetzen"] },
  generic: { label: "In HERO erledigen", items: ["Aufgabe in HERO erledigen"] },
};

/** app_config.projects_checklists: {"<kind>": {"label": "...", "items": ["..."]}}; fehlende/kaputte Eintraege fallen auf die Standardwerte zurueck. */
export function parseChecklists(raw: unknown): Record<TaskKind, Checklist> {
  let j: any = raw;
  if (typeof raw === "string") { try { j = JSON.parse(raw); } catch { j = null; } }
  const out = { ...DEFAULT_CHECKLISTS };
  for (const k of Object.keys(DEFAULT_CHECKLISTS) as TaskKind[]) {
    const e = j?.[k];
    const items = Array.isArray(e?.items) ? e.items.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 20) : null;
    if (items?.length) out[k] = { label: String(e?.label || DEFAULT_CHECKLISTS[k].label).slice(0, 80), items };
  }
  return out;
}

export interface DocSnap { type: string; status: string; nr: string }
export interface TaskSnapshot { stepId: number | null; stepKey: string; stepName: string; docs: DocSnap[]; at: string }

/** HERO-Projekt (project_matches) -> Momentaufnahme. Geloeschte/stornierte Dokumente zaehlen nicht. */
export function snapshotOf(pm: any, now = new Date()): TaskSnapshot {
  const st = pm?.current_project_match_status;
  const stepName = String(st?.step?.name ?? "");
  const sid = st?.step_id ?? st?.step?.id;
  return {
    stepId: sid != null ? Number(sid) : null, stepKey: stepKey(stepName), stepName,
    docs: normalizeDocuments(pm?.customer_documents).map((d) => ({ type: d.type, status: d.status, nr: d.nr })), at: now.toISOString(),
  };
}

const STATE_QUERY = `query($ids: [Int]) { project_matches(ids: $ids) {
  id current_project_match_status { step_id step { id name } } customer_documents { nr type created status_name }
} }`;

/** Projekt frisch aus HERO lesen (nur Lesen). null = Projekt nicht gefunden. */
export async function readProjectState(
  heroGraphql: (apiKey: string, q: string, v: Record<string, unknown>) => Promise<any>, apiKey: string, heroId: number, now = new Date(),
): Promise<TaskSnapshot | null> {
  const data = await heroGraphql(apiKey, STATE_QUERY, { ids: [heroId] });
  const pm = data?.project_matches?.[0];
  return pm?.id && Number(pm.id) === heroId ? snapshotOf(pm, now) : null;
}

const count = (docs: DocSnap[], type: string) => docs.filter((d) => d.type === type).length;
const sentCount = (docs: DocSnap[]) => sentOffers(docs.map((d) => ({ nr: d.nr, type: d.type, created: null, status: d.status }))).length;
const abCount = (docs: DocSnap[]) => confirmations(docs.map((d) => ({ nr: d.nr, type: d.type, created: null, status: d.status }))).length;

export interface TaskCheck { passed: boolean; message: string; changes: string[] }

/** Was hat sich in HERO seit dem Vorher-Stand geaendert? Pur, ohne Netz. */
export function checkTask(kind: TaskKind, before: TaskSnapshot, after: TaskSnapshot): TaskCheck {
  const changes: string[] = [];
  if (before.stepId !== after.stepId) changes.push(`Status: „${before.stepName.replace(/^[^\p{L}\p{N}]+/u, "")}“ → „${after.stepName.replace(/^[^\p{L}\p{N}]+/u, "")}“`);
  for (const t of [...new Set([...before.docs, ...after.docs].map((d) => d.type))]) {
    const d = count(after.docs, t) - count(before.docs, t);
    if (d > 0) changes.push(`${d} neue(s) Dokument(e) vom Typ ${t}`);
  }
  const sentDelta = sentCount(after.docs) - sentCount(before.docs);
  if (sentDelta > 0) changes.push(`${sentDelta} Angebot(e) versendet`);

  const ok = (message: string): TaskCheck => ({ passed: true, message, changes });
  const no = (message: string): TaskCheck => ({ passed: false, message, changes });
  switch (kind) {
    case "create_offer":
      return count(after.docs, "offer") > count(before.docs, "offer") ? ok("Neues Angebot in HERO gefunden.") : no("In HERO ist noch kein neues Angebot zu sehen.");
    case "finish_offer":
      return sentDelta > 0 || (before.stepKey !== after.stepKey && after.stepKey === "warten_auftrag")
        ? ok("Angebot ist versendet.") : no("In HERO ist noch kein Angebot als „Versendet“ markiert.");
    case "create_confirmation":
      return abCount(after.docs) > abCount(before.docs) ? ok("Neue Auftragsbestätigung in HERO gefunden.") : no("In HERO ist noch keine neue Auftragsbestätigung zu sehen.");
    case "complaint":
      return before.stepKey === "reklamation" && after.stepKey !== "reklamation" ? ok("Das Projekt ist nicht mehr in „Reklamation“.") : no("Das Projekt steht in HERO noch auf „Reklamation“.");
    default:
      return changes.length ? ok("In HERO hat sich etwas geändert.") : no("In HERO hat sich seit dem Start nichts geändert.");
  }
}

// ---------------------------------------------------------------------------------------------- Datenbank

export interface TaskDeps {
  readState: (heroId: number) => Promise<TaskSnapshot | null>;
  /** Logbuch-Eintrag nach HERO (nur aufrufen, wenn nicht im Schattenmodus). */
  logbook?: (heroId: number, text: string) => Promise<void>;
  shadow?: boolean;
  checklists?: Record<TaskKind, Checklist>;
  now?: Date;
}
export interface TaskActor { id: string | null; name: string; isAdmin?: boolean }
export class TaskError extends Error {}

export interface LockResult { taskId: string; kind: TaskKind; label: string; checklist: string[]; lockedUntil: string; reused: boolean }

/** „In HERO erledigen“: Karte 30 Min sperren, Vorher-Stand merken. */
export async function lockForHero(sb: any, deps: TaskDeps, a: { heroId: number; actor: TaskActor }): Promise<LockResult> {
  const now = deps.now ?? new Date();
  const lists = deps.checklists ?? DEFAULT_CHECKLISTS;
  const { data: card } = await sb.from("project_cards").select("id, hero_id, rule_key, state, locked_until, locked_by").eq("hero_id", a.heroId).in("state", ["open", "in_hero"]).maybeSingle();
  if (!card) throw new TaskError("Für dieses Projekt gibt es keine offene Karte.");
  const lockedByOther = card.state === "in_hero" && card.locked_until && Date.parse(card.locked_until) > now.getTime() && card.locked_by && card.locked_by !== a.actor.id;
  if (lockedByOther) {
    const { data: t } = await sb.from("hero_tasks").select("created_by_name").eq("card_id", card.id).is("finished_at", null).maybeSingle();
    throw new TaskError(`Gerade von ${t?.created_by_name || "jemand anderem"} in HERO bearbeitet.`);
  }
  const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
  const kind = TASK_BY_RULE[card.rule_key] ?? "generic";
  const cl = lists[kind];

  const { data: open } = await sb.from("hero_tasks").select("id, task").eq("card_id", card.id).is("finished_at", null).maybeSingle();
  if (open) { // eigene, noch offene Aufgabe: Sperre verlaengern
    await sb.from("project_cards").update({ state: "in_hero", locked_until: lockedUntil, locked_by: a.actor.id }).eq("id", card.id);
    const k = (open.task as TaskKind) in DEFAULT_CHECKLISTS ? (open.task as TaskKind) : kind;
    return { taskId: open.id, kind: k, label: lists[k].label, checklist: lists[k].items, lockedUntil, reused: true };
  }

  const before = await deps.readState(a.heroId);
  if (!before) throw new TaskError("Projekt in HERO nicht gefunden.");
  const ins = await sb.from("hero_tasks").insert({
    card_id: card.id, hero_id: a.heroId, task: kind, checklist: cl.items, before, created_by: a.actor.id, created_by_name: a.actor.name,
  }).select("id").maybeSingle();
  if (ins.error || !ins.data) throw new TaskError(`Aufgabe nicht angelegt: ${ins.error?.message ?? "unbekannt"}`);
  const up = await sb.from("project_cards").update({ state: "in_hero", locked_until: lockedUntil, locked_by: a.actor.id }).eq("id", card.id);
  if (up.error) throw new TaskError(up.error.message);
  return { taskId: ins.data.id, kind, label: cl.label, checklist: cl.items, lockedUntil, reused: false };
}

export type TaskResult = "done" | "partial" | "problem";
export interface FinishResult { passed: boolean; closed: boolean; message: string; changes: string[]; warnings?: string[] }

/** Rueckkehr aus HERO: Ergebnis speichern, bei „Erledigt“ in HERO nachpruefen. */
export async function finishTask(sb: any, deps: TaskDeps, a: { taskId: string; result: TaskResult; note?: string; actor: TaskActor }): Promise<FinishResult> {
  const now = deps.now ?? new Date();
  if (!["done", "partial", "problem"].includes(a.result)) throw new TaskError("Ergebnis: done, partial oder problem.");
  const { data: t } = await sb.from("hero_tasks").select("*").eq("id", a.taskId).maybeSingle();
  if (!t) throw new TaskError("Aufgabe nicht gefunden.");
  if (t.finished_at) throw new TaskError("Diese Aufgabe ist schon abgeschlossen.");
  if (t.created_by && a.actor.id && t.created_by !== a.actor.id && !a.actor.isAdmin) throw new TaskError("Diese Aufgabe gehört jemand anderem.");
  const kind = (t.task as TaskKind) in DEFAULT_CHECKLISTS ? (t.task as TaskKind) : "generic";
  const label = (deps.checklists ?? DEFAULT_CHECKLISTS)[kind].label;
  const note = String(a.note ?? "").trim().slice(0, 500);
  const heroId = Number(t.hero_id);

  const release = async (patch: Record<string, unknown>) => {
    const r = await sb.from("hero_tasks").update({ result: a.result, finished_at: now.toISOString(), ...patch }).eq("id", t.id).is("finished_at", null);
    if (r.error) throw new TaskError(r.error.message);
    if (t.card_id) await sb.from("project_cards").update({ state: "open", locked_until: null, locked_by: null }).eq("id", t.card_id).eq("state", "in_hero");
  };

  if (a.result !== "done") {
    const message = a.result === "partial" ? `Teilweise erledigt${note ? `: ${note}` : "."} Die Karte bleibt offen.` : `Problem${note ? `: ${note}` : "."} Die Karte bleibt offen.`;
    await release({ check_result: { passed: false, message, note, changes: [] } });
    return { passed: false, closed: false, message, changes: [] };
  }

  const after = await deps.readState(heroId);
  if (!after) throw new TaskError("Projekt in HERO nicht gefunden.");
  const check = checkTask(kind, t.before as TaskSnapshot, after);
  if (!check.passed) {
    const message = `${check.message} Die Karte bleibt offen – in HERO weitermachen oder „Problem“ melden.`;
    await release({ check_result: { passed: false, message, note, changes: check.changes } });
    return { passed: false, closed: false, message, changes: check.changes };
  }

  const warnings: string[] = [];
  await release({ check_result: { passed: true, message: check.message, note, changes: check.changes } });
  if (t.card_id) await sb.from("project_cards").update({ state: "done", closed_at: now.toISOString(), close_reason: "In HERO erledigt" }).eq("id", t.card_id).eq("state", "open");
  if (deps.logbook && !deps.shadow) {
    try { await deps.logbook(heroId, `${label} in HERO erledigt (Projekte-Ansicht, ${a.actor.name}).${note ? ` ${note}` : ""}`); }
    catch (e) { warnings.push(`Logbuch-Eintrag fehlgeschlagen: ${(e as Error).message}`); }
  }
  await sb.from("project_actions_log").insert({ user: a.actor.name, action: "hero_task_done", hero_id: heroId, payload: { task: kind, changes: check.changes, note }, shadow: !!deps.shadow, hero_response: { warnings } });
  return { passed: true, closed: true, message: check.message, changes: check.changes, ...(warnings.length ? { warnings } : {}) };
}
