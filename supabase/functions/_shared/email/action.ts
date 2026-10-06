// Vorschlaege ausfuehren (email-action): der Klick in der Mail-App.
//
// Jede Ausfuehrung beansprucht den Vorschlag zuerst (offen/fehlgeschlagen -> angenommen),
// damit ein Doppelklick nichts doppelt in HERO anlegt. Scheitert sie, steht der Vorschlag
// auf „fehlgeschlagen" (mit Fehlertext) und laesst sich erneut versuchen.

import { logbookText } from "./act.ts";
import type { HeroContact, HeroProject, NewContact, NewProject } from "./hero.ts";
import type { Gewerk } from "./gewerke.ts";
import type { MatchInfo } from "./matchStage.ts";
import { stepLabel } from "./steps.ts";

export interface SuggestionRow {
  id: string;
  message_id: string;
  type: string;
  payload: any;
  status: "offen" | "angenommen" | "abgelehnt" | "fehlgeschlagen";
  message: {
    id: string; account_id: string; thread_id: string | null; direction: "in" | "out"; from_addr: string; from_name: string;
    to_addrs: string[]; subject: string; summary: string | null; has_attachments: boolean; hero_project_match_id: number | null;
    hero_logged_at: string | null; match_info: MatchInfo; account_label: string;
  };
}

export interface ActionStore {
  getSuggestion(id: string): Promise<SuggestionRow | null>;
  /** offen/fehlgeschlagen -> angenommen. false, wenn schon jemand anderes dran war. */
  claim(id: string): Promise<boolean>;
  finish(id: string, status: "angenommen" | "abgelehnt" | "fehlgeschlagen", result: Record<string, unknown>): Promise<void>;
  assignProject(messageId: string, threadId: string | null, projectId: number, info: Partial<MatchInfo>): Promise<void>;
  markLogged(messageId: string): Promise<void>;
  openCount(messageId: string): Promise<number>;
  setMessageStatus(messageId: string, status: "erledigt" | "wartet"): Promise<void>;
  addFeedback(messageId: string, field: string, oldValue: string | null, newValue: string | null): Promise<void>;
  dropContactCache(email: string): Promise<void>;
}

export interface ActionHero {
  addLogbook(projectId: number, text: string): Promise<void>;
  setStep(projectId: number, stepId: number): Promise<void>;
  projectById(id: number): Promise<HeroProject | null>;
  createContact(c: NewContact, source: string): Promise<number>;
  contactsByEmail(email: string): Promise<HeroContact[]>;
  createProject(p: NewProject): Promise<{ id: number; nr: string }>;
}

export interface ActionConfig {
  /** Erlaubte Zielschritte (Whitelist aus email_config.hero.steps). */
  stepIds: number[];
  projectTypeId: number | null;
  startStepId: number | null;
  gewerke: Gewerk[];
}

export interface ActionDeps { hero: ActionHero | null; store: ActionStore; config: ActionConfig }

export class ActionError extends Error {}

/** Bearbeitete Felder ueber den Payload legen; verschachtelte Objekte (contact, project, request) werden gemischt, nicht ersetzt. */
export function mergeEdits(payload: any, edits: Record<string, any> | undefined): any {
  const out: Record<string, any> = { ...(payload ?? {}) };
  for (const [k, v] of Object.entries(edits ?? {})) {
    const isObj = (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x);
    out[k] = isObj(v) && isObj(out[k]) ? { ...out[k], ...v } : v;
  }
  return out;
}

const need = <T>(v: T | null | undefined, msg: string): T => {
  if (v == null || (typeof v === "string" && !v.trim())) throw new ActionError(msg);
  return v;
};

async function settle(store: ActionStore, s: SuggestionRow) {
  const open = await store.openCount(s.message_id);
  await store.setMessageStatus(s.message_id, open > 0 ? "wartet" : "erledigt");
}

/** Mail dem Projekt zuordnen (manuell bestaetigt = sicher) und ins Logbuch schreiben. */
async function assignAndLog(
  s: SuggestionRow, project: HeroProject, text: string, deps: ActionDeps, warnings: string[],
): Promise<{ logged: boolean }> {
  const { hero, store } = deps;
  await store.assignProject(s.message.id, s.message.thread_id, project.id, {
    certain: true, reason: "Manuell bestätigt", projectNr: project.nr, projectName: project.name, stepId: project.stepId,
  });
  if (s.message.hero_logged_at) return { logged: false };
  try {
    await hero!.addLogbook(project.id, text);
    await store.markLogged(s.message.id);
    return { logged: true };
  } catch (e) {
    warnings.push(`Logbuch-Eintrag fehlgeschlagen: ${(e as Error).message}`);
    return { logged: false };
  }
}

export interface DecideInput {
  suggestionId: string;
  decision: "accept" | "reject";
  /** Bearbeitete Felder aus der Mail-App; ueberschreiben den Payload. */
  edits?: Record<string, any>;
}

export async function decideSuggestion(input: DecideInput, deps: ActionDeps): Promise<Record<string, unknown>> {
  const { store } = deps;
  const s = await store.getSuggestion(input.suggestionId);
  if (!s) throw new ActionError("Vorschlag nicht gefunden.");

  if (input.decision === "reject") {
    if (s.status !== "offen" && s.status !== "fehlgeschlagen") throw new ActionError("Der Vorschlag wurde schon entschieden.");
    await store.finish(s.id, "abgelehnt", {});
    // Eine Ablehnung ist eine Korrektur: der Assistent lernt daraus.
    await store.addFeedback(s.message_id, `suggestion.${s.type}`, "vorgeschlagen", "abgelehnt");
    await settle(store, s);
    return { status: "abgelehnt" };
  }

  if (!deps.hero) throw new ActionError("HERO ist nicht aktiviert (hero_enabled / hero_api_key).");
  if (!(await store.claim(s.id))) throw new ActionError("Der Vorschlag wurde schon entschieden oder wird gerade ausgeführt.");

  const warnings: string[] = [];
  try {
    const p = mergeEdits(s.payload, input.edits);
    let result: Record<string, unknown>;
    switch (s.type) {
      case "link_project":
      case "log_entry": {
        const projectId = Number(need(p.projectId, "Bitte ein Projekt auswählen."));
        if (!Number.isFinite(projectId) || projectId <= 0) throw new ActionError("Ungültige Projekt-ID.");
        const project = need(await deps.hero.projectById(projectId), `Projekt ${projectId} gibt es in HERO nicht.`);
        if (s.type === "link_project" && s.payload.projectId !== projectId) {
          await store.addFeedback(s.message_id, "hero_project", String(s.payload.projectId ?? ""), String(projectId));
        }
        const text = String(p.text || logbookText({ ...s.message, direction: s.message.direction }, s.message.account_label));
        const r = await assignAndLog(s, project, text, deps, warnings);
        result = { projectId, projectNr: project.nr, logged: r.logged };
        break;
      }

      case "change_step": {
        const projectId = Number(need(p.projectId, "Projekt fehlt."));
        const stepId = Number(need(p.toStepId, "Zielschritt fehlt."));
        // Nur Schritte, die im Admin-Bereich als Ziele hinterlegt sind – nie eine frei gelieferte ID.
        if (!deps.config.stepIds.includes(stepId)) throw new ActionError("Dieser Schritt ist nicht als Ziel freigegeben (Einstellungen → HERO-IDs).");
        await deps.hero.setStep(projectId, stepId);
        result = { projectId, stepId, label: p.toLabel ?? stepLabel(String(p.toKey ?? "")) };
        break;
      }

      case "create_project":
        result = await createProject(s, p, deps, warnings);
        break;

      default:
        throw new ActionError(`Vorschlagsart „${s.type}“ wird noch nicht unterstützt.`);
    }
    await store.finish(s.id, "angenommen", { ...result, ...(warnings.length ? { warnings } : {}) });
    await settle(store, s);
    return { status: "angenommen", ...result, ...(warnings.length ? { warnings } : {}) };
  } catch (e) {
    await store.finish(s.id, "fehlgeschlagen", { error: String((e as Error).message).slice(0, 400) });
    throw e;
  }
}

async function createProject(s: SuggestionRow, p: any, deps: ActionDeps, warnings: string[]): Promise<Record<string, unknown>> {
  const { hero, store } = deps;
  const c = p.contact ?? {};
  const email = String(c.email || s.message.from_addr || "").trim().toLowerCase();
  need(email, "E-Mail-Adresse fehlt.");
  if (!String(c.last_name || "").trim() && !String(c.company || "").trim()) throw new ActionError("Nachname oder Firma fehlt.");
  const name = String(need(p.project?.name, "Projektname fehlt.")).trim().slice(0, 200);

  const g = deps.config.gewerke.find((x) => x.short === p.project?.gewerk?.short) ?? null;
  const measureId = g?.measure_id ?? p.project?.gewerk?.measure_id ?? null;

  // 1. Kontakt: `findExisting` verhindert Dubletten bei gleicher E-Mail.
  const contactId = await hero!.createContact({ ...c, email }, "Mail-Assistent");
  const found = await hero!.contactsByEmail(email).catch(() => [] as HeroContact[]);
  const customerId = found.find((x) => x.id === contactId)?.customerId ?? found[0]?.customerId ?? contactId;

  // 2. Projekt (Startschritt „Anfragen")
  const notes = String(p.project?.notes || s.message.summary || s.message.subject || "").slice(0, 2000);
  const proj = await hero!.createProject({
    name, customerId, measureId, typeId: deps.config.projectTypeId, stepId: deps.config.startStepId, notes,
    address: { street: c.street, zip: c.zip, city: c.city },
  });

  // Ab hier existiert das Projekt: weitere Fehler sind Hinweise, kein Abbruch (sonst gaebe es beim Wiederholen ein zweites Projekt).
  try {
    await store.dropContactCache(email);
    const details = [p.request?.service, p.request?.dimensions, p.request?.quantity && `Menge: ${p.request.quantity}`, p.request?.material, p.request?.location]
      .filter(Boolean).join(" · ");
    const text = logbookText({ ...s.message }, s.message.account_label) + (details ? `\nAnfrage: ${details}` : "");
    await assignAndLog(s, { id: proj.id, nr: proj.nr, name, stepId: deps.config.startStepId, stepName: null, customerId, customerName: "" }, text, deps, warnings);
  } catch (e) {
    warnings.push(`Nacharbeiten fehlgeschlagen: ${(e as Error).message}`);
  }
  return { contactId, customerId, projectId: proj.id, projectNr: proj.nr };
}
