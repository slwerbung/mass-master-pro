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
import type { UploadItem } from "./attachments.ts";
import { offerLogText, type OfferPayload } from "./offer.ts";
import { buildConfirmationActions, confirmationLogText, type ConfirmationPayload, type ConfirmationPosition } from "./confirmation.ts";
import type { DocumentKind, HeroDocument } from "./hero.ts";
import type { StepIds } from "./steps.ts";

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
  /** Andere offene Vorschlaege dieser Mail mit den genannten Arten schliessen (Alternative gewaehlt). */
  closeAlternatives(messageId: string, exceptId: string, types: string[], reason: string): Promise<void>;
  setMessageStatus(messageId: string, status: "erledigt" | "wartet"): Promise<void>;
  addFeedback(messageId: string, field: string, oldValue: string | null, newValue: string | null): Promise<void>;
  dropContactCache(email: string): Promise<void>;
  /** Speicherpfade der angefragten Anhaenge dieser Mail (nur eigene, nur gespeicherte). */
  attachmentFiles(messageId: string, ids: string[]): Promise<{ id: string; filename: string; mime: string; storage_path: string }[]>;
  markUploaded(attachmentId: string, uploadId: string): Promise<void>;
  /** Nach einer Zuordnung: Upload-Vorschlag fuer die Anhaenge anlegen (falls es welche gibt). */
  suggestUploads(messageId: string, projectId: number, projectNr: string): Promise<void>;
  /** Folge-Vorschlag anlegen (z. B. „AB versenden" nach „AB anlegen"); ein offener gleicher bleibt. */
  createSuggestion(messageId: string, type: string, payload: Record<string, unknown>): Promise<void>;
  /** Vorschlag wieder auf „offen" (z. B. AB noch nicht abgeschlossen – spaeter erneut versenden). */
  release(id: string): Promise<void>;
}

export interface ActionHero {
  addLogbook(projectId: number, text: string): Promise<void>;
  setStep(projectId: number, stepId: number): Promise<void>;
  projectById(id: number): Promise<HeroProject | null>;
  createContact(c: NewContact, source: string): Promise<number>;
  contactsByEmail(email: string): Promise<HeroContact[]>;
  createProject(p: NewProject): Promise<{ id: number; nr: string }>;
  uploadDocument(projectId: number, file: { bytes: Uint8Array; filename: string; mime: string }, documentTypeId: number): Promise<{ uploadId: string }>;
  /** Dokument als ENTWURF mit DocumentBuilder-Aktionen anlegen. */
  createDocument(projectId: number, documentTypeId: number, actions: Record<string, unknown>[]): Promise<{ id: number | null; nr: string | null }>;
  documentById(id: number): Promise<HeroDocument | null>;
  emailTemplates(kind: DocumentKind): Promise<{ id: number; name: string }[]>;
  /** Echter Versand an den Kunden ueber HERO – nur in `sendDocument`. */
  sendDocumentMail(m: { kind: DocumentKind; documentId: number; recipient: string; templateId: number; fileUuid: string }): Promise<void>;
  setDocumentSent(documentId: number): Promise<void>;
}

export interface ActionConfig {
  /** Erlaubte Zielschritte (Whitelist aus email_config.hero.steps). */
  stepIds: number[];
  projectTypeId: number | null;
  startStepId: number | null;
  gewerke: Gewerk[];
  /** Erlaubte HERO-Dokumenttypen fuer Anhaenge (Whitelist aus email_config.hero.document_types). */
  documentTypeIds: number[];
  steps: StepIds;
  offerTypeId: number | null;
  /** Dokumenttyp „Auftragsbestätigung" (HERO 171301). */
  confirmationTypeId: number | null;
}

export interface ActionDeps {
  hero: ActionHero | null;
  store: ActionStore;
  config: ActionConfig;
  files?: { download(path: string): Promise<Uint8Array> };
  /** Nach einer Zuordnung eine Angebotsvorbereitung vorschlagen (nur Neuanfragen; best effort). */
  offers?: { suggest(messageId: string, projectId: number, projectNr: string): Promise<void> };
}

export class ActionError extends Error {}
/** Noch nicht moeglich (z. B. AB noch Entwurf): der Vorschlag bleibt offen und laesst sich spaeter erneut ausfuehren. */
export class NotReadyError extends ActionError {}

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

/**
 * „Zu bestehendem Projekt zuordnen“ und „Neues Projekt anlegen“ sind zwei Antworten auf dieselbe Frage. Die Mail-App
 * zeigt sie als eine Karte; wird eine angenommen, ist die andere erledigt.
 */
export const PROJECT_ALTERNATIVES = ["link_project", "create_project"];

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
  if (s.message.hero_logged_at) {
    await store.suggestUploads(s.message.id, project.id, project.nr).catch(() => {});
    await deps.offers?.suggest(s.message.id, project.id, project.nr).catch(() => {});
    return { logged: false };
  }
  try {
    await hero!.addLogbook(project.id, text);
    await store.markLogged(s.message.id);
    await store.suggestUploads(s.message.id, project.id, project.nr).catch(() => {});
    await deps.offers?.suggest(s.message.id, project.id, project.nr).catch(() => {});
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
    const reason = String(input.edits?.reason ?? "").trim().slice(0, 300);
    await store.finish(s.id, "abgelehnt", reason ? { reason } : {});
    // Eine Ablehnung ist eine Korrektur: der Assistent lernt daraus (mit Grund, wenn einer genannt wurde).
    await store.addFeedback(s.message_id, `suggestion.${s.type}`, "vorgeschlagen", reason ? `abgelehnt: ${reason}` : "abgelehnt");
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

      case "upload_attachments":
        result = await uploadAttachments(s, p, deps, warnings);
        break;

      case "prepare_offer":
        result = await prepareOffer(s, p as OfferPayload, deps, warnings);
        break;

      case "create_confirmation":
        result = await createConfirmation(s, p, deps, warnings);
        break;

      case "send_document":
        result = await sendDocument(s, p, deps, warnings);
        break;

      default:
        throw new ActionError(`Vorschlagsart „${s.type}“ wird noch nicht unterstützt.`);
    }
    await store.finish(s.id, "angenommen", { ...result, ...(warnings.length ? { warnings } : {}) });
    if (PROJECT_ALTERNATIVES.includes(s.type)) {
      await store.closeAlternatives(s.message_id, s.id, PROJECT_ALTERNATIVES, "Alternative gewählt").catch(() => {});
    }
    await settle(store, s);
    return { status: "angenommen", ...result, ...(warnings.length ? { warnings } : {}) };
  } catch (e) {
    if (e instanceof NotReadyError) await store.release(s.id);
    else await store.finish(s.id, "fehlgeschlagen", { error: String((e as Error).message).slice(0, 400) });
    throw e;
  }
}

async function createProject(s: SuggestionRow, p: any, deps: ActionDeps, warnings: string[]): Promise<Record<string, unknown>> {
  const { hero, store } = deps;
  const c = p.contact ?? {};
  const email = String(c.email || s.message.from_addr || "").trim().toLowerCase();
  // Bestehender HERO-Kunde (aus der Zuordnung), solange in der Mail-App nicht „neuen Kontakt anlegen" gewaehlt ist.
  const existingId = p.useExisting !== false && Number(p.existingCustomer?.id) > 0 ? Number(p.existingCustomer.id) : null;
  if (!existingId) {
    need(email, "E-Mail-Adresse fehlt.");
    if (!String(c.last_name || "").trim() && !String(c.company || "").trim()) throw new ActionError("Nachname oder Firma fehlt.");
  }
  const name = String(need(p.project?.name, "Projektname fehlt.")).trim().slice(0, 200);

  // Nur Gewerke aus der Konfiguration; unbekannt -> Standard-Gewerk (WER), nie eine frei gelieferte measure_id.
  const g = deps.config.gewerke.find((x) => x.short === p.project?.gewerk?.short) ?? deps.config.gewerke.find((x) => x.default) ?? null;
  const measureId = g?.measure_id ?? (deps.config.gewerke.length ? null : p.project?.gewerk?.measure_id ?? null);

  // 1. Kontakt: bestehenden Kunden nehmen, sonst anlegen. Gibt es die E-Mail-Adresse in HERO schon, wird NIE ein
  //    neuer Kontakt angelegt – `findExisting` von HERO erkennt Ansprechpartner eines Firmenkunden nicht (Dublette live
  //    passiert: Firma neu angelegt, obwohl die Absenderin Ansprechpartnerin beim bestehenden Kunden war).
  let contactId: number | null = null;
  let customerId: number;
  if (existingId) {
    customerId = existingId;
  } else {
    const known = email ? await hero!.contactsByEmail(email).catch(() => [] as HeroContact[]) : [];
    if (known.length) {
      customerId = known[0].customerId;
      warnings.push(`Den Kontakt ${email} gibt es in HERO schon – Projekt beim bestehenden Kunden ${known[0].name || customerId} angelegt, kein neuer Kontakt.`);
    } else {
      contactId = await hero!.createContact({ ...c, email }, "Mail-Assistent");
      const found = await hero!.contactsByEmail(email).catch(() => [] as HeroContact[]);
      customerId = found.find((x) => x.id === contactId)?.customerId ?? found[0]?.customerId ?? contactId;
    }
  }

  // 2. Projekt (Startschritt „Anfragen")
  const notes = String(p.project?.notes || s.message.summary || s.message.subject || "").slice(0, 2000);
  const proj = await hero!.createProject({
    name, customerId, measureId, typeId: deps.config.projectTypeId, stepId: deps.config.startStepId, notes,
    address: { street: c.street, zip: c.zip, city: c.city },
  });

  // Ab hier existiert das Projekt: weitere Fehler sind Hinweise, kein Abbruch (sonst gaebe es beim Wiederholen ein zweites Projekt).
  try {
    if (email) await store.dropContactCache(email);
    const details = [p.request?.service, p.request?.dimensions, p.request?.quantity && `Menge: ${p.request.quantity}`, p.request?.material, p.request?.location]
      .filter(Boolean).join(" · ");
    const text = logbookText({ ...s.message }, s.message.account_label) + (details ? `\nAnfrage: ${details}` : "");
    await assignAndLog(s, { id: proj.id, nr: proj.nr, name, stepId: deps.config.startStepId, stepName: null, customerId, customerName: "" }, text, deps, warnings);
  } catch (e) {
    warnings.push(`Nacharbeiten fehlgeschlagen: ${(e as Error).message}`);
  }
  return { contactId, customerId, projectId: proj.id, projectNr: proj.nr };
}

async function uploadAttachments(s: SuggestionRow, p: any, deps: ActionDeps, warnings: string[]): Promise<Record<string, unknown>> {
  const projectId = Number(need(p.projectId, "Projekt fehlt."));
  const items = ((p.items ?? []) as UploadItem[]).filter((i) => i.selected !== false);
  if (!items.length) throw new ActionError("Keine Anhänge ausgewählt.");
  if (!deps.files) throw new ActionError("Kein Dateizugriff konfiguriert.");
  for (const i of items) {
    // Nur freigegebene Dokumenttypen – nie eine frei gelieferte ID.
    if (!deps.config.documentTypeIds.includes(Number(i.documentTypeId))) {
      throw new ActionError(`Dokumenttyp ${i.documentTypeId} ist nicht freigegeben (Einstellungen → HERO-IDs).`);
    }
  }
  // Pfade kommen aus der Datenbank, nie aus dem Client.
  const files = await deps.store.attachmentFiles(s.message_id, items.map((i) => i.attachmentId));
  const byId = new Map(files.map((f) => [f.id, f]));
  let uploaded = 0;
  const failed: string[] = [];
  for (const i of items) {
    const f = byId.get(i.attachmentId);
    if (!f) { failed.push(`${i.filename}: nicht gefunden`); continue; }
    try {
      const bytes = await deps.files.download(f.storage_path);
      const r = await deps.hero!.uploadDocument(projectId, { bytes, filename: f.filename, mime: f.mime }, Number(i.documentTypeId));
      await deps.store.markUploaded(f.id, r.uploadId);
      uploaded++;
    } catch (e) {
      failed.push(`${i.filename}: ${(e as Error).message}`.slice(0, 160));
    }
  }
  if (!uploaded) throw new ActionError(`Kein Anhang hochgeladen. ${failed.join(" | ")}`);
  if (failed.length) warnings.push(`Nicht hochgeladen: ${failed.join(" | ")}`);
  return { projectId, uploaded, failed: failed.length };
}

async function prepareOffer(s: SuggestionRow, p: OfferPayload, deps: ActionDeps, warnings: string[]): Promise<Record<string, unknown>> {
  const { hero, config } = deps;
  const projectId = Number(need(p.projectId, "Projekt fehlt."));
  const kind = p.kind === "vor_ort" ? "vor_ort" : "angebot";
  const stepId = need(kind === "vor_ort" ? config.steps.vor_ort : config.steps.angebot, `Schritt „${kind === "vor_ort" ? "Vor-Ort-Termin" : "Angeboterstellung"}“ ist nicht konfiguriert (Einstellungen → HERO-IDs).`);
  const project = need(await hero!.projectById(projectId), `Projekt ${projectId} gibt es in HERO nicht.`);

  // 1. Die Positionsliste ist das eigentliche Ergebnis: sie steht im Logbuch, auch wenn spaeter etwas scheitert.
  await hero!.addLogbook(projectId, offerLogText({ ...p, kind, projectId }));

  // 2. Schritt wechseln (gleicher Schritt = nichts zu tun)
  if (project.stepId !== stepId) await hero!.setStep(projectId, stepId);

  // 3. Angebot als Entwurf: HERO-Leistungen mit Menge (Preise aus den HERO-Stammdaten). Positionen ohne
  //    Leistung oder Menge stehen nur im Logbuch und werden in HERO ergaenzt.
  let documentId: number | null = null;
  if (kind === "angebot") {
    if (!config.offerTypeId) warnings.push("Dokumenttyp „Angebot“ ist nicht konfiguriert – bitte das Angebot in HERO von Hand anlegen.");
    else {
      const actions = (p.positions ?? []).filter((x) => x.serviceId != null && x.quantity != null && x.quantity > 0)
        .map((x) => ({ add_existing_service: { supplyServiceId: Number(x.serviceId), quantity: Number(x.quantity) } }));
      try {
        documentId = (await hero!.createDocument(projectId, config.offerTypeId, actions)).id;
      } catch (e) {
        try {
          documentId = (await hero!.createDocument(projectId, config.offerTypeId, [])).id;
          warnings.push(`Positionen konnten nicht ins Angebot übernommen werden (stehen im Logbuch): ${(e as Error).message}`.slice(0, 300));
        } catch (e2) {
          warnings.push(`Angebot konnte nicht angelegt werden (bitte in HERO von Hand): ${(e2 as Error).message}`.slice(0, 300));
        }
      }
      const missing = (p.positions ?? []).length - actions.length;
      if (documentId && missing > 0) warnings.push(`${missing} Position(en) ohne HERO-Leistung oder Menge – bitte im Angebot ergänzen (siehe Logbuch).`);
      if (documentId) {
        await deps.store.createSuggestion(s.message_id, "send_document", sendPayload("offer", documentId, null, projectId, project.nr, s, null)).catch(() => {});
      }
    }
  }
  return { kind, projectId, stepId, documentId, positions: p.positions?.length ?? 0 };
}

function sendPayload(kind: DocumentKind, documentId: number, documentNr: string | null, projectId: number, projectNr: string | null, s: SuggestionRow, p: any): Record<string, unknown> {
  return {
    kind, documentId, documentNr, projectId, projectNr,
    recipient: String(p?.recipient || s.message.from_addr || "").trim().toLowerCase(),
    formality: p?.formality ?? null,
  };
}

/** Freigegebene Mengen/Auswahl ueber die Positionen des urspruenglichen Vorschlags legen – Namen und Preise nie aus dem Client. */
export function mergePositions(original: ConfirmationPosition[], edited: unknown): ConfirmationPosition[] {
  const byKey = new Map<string, any>();
  if (Array.isArray(edited)) for (const e of edited) if (e && typeof e === "object") byKey.set(`${(e as any).sourceDocId}/${(e as any).uid}`, e);
  return (original ?? []).map((o) => {
    const e = byKey.get(`${o.sourceDocId}/${o.uid}`);
    if (!e) return o;
    const q = Number(e.quantity);
    return { ...o, include: e.include !== false, quantity: Number.isFinite(q) && q > 0 ? q : o.quantity };
  });
}

async function createConfirmation(s: SuggestionRow, p: any, deps: ActionDeps, warnings: string[]): Promise<Record<string, unknown>> {
  const { hero, config, store } = deps;
  const typeId = need(config.confirmationTypeId, "Dokumenttyp „Auftragsbestätigung“ ist nicht konfiguriert (Einstellungen → Firma & HERO).");
  const orig = s.payload as ConfirmationPayload;

  // 1. Projekt: vorhandenes oder neu (Kontakt + Projekt wie bei „Projekt anlegen")
  let projectId = Number(p.projectId) || null;
  let projectNr: string | null = p.projectNr ?? null;
  let stepId: number | null = null;
  if (projectId) {
    const project = need(await hero!.projectById(projectId), `Projekt ${projectId} gibt es in HERO nicht.`);
    projectNr = project.nr;
    stepId = project.stepId;
    if (s.message.hero_project_match_id !== projectId || !s.message.hero_logged_at) {
      await assignAndLog(s, project, logbookText({ ...s.message }, s.message.account_label), deps, warnings);
    }
  } else {
    const r = await createProject(s, {
      contact: p.contact ?? orig.contact ?? {}, project: p.project ?? orig.project, request: {},
      existingCustomer: p.existingCustomer ?? orig.existingCustomer ?? null, useExisting: p.useExisting,
    }, deps, warnings);
    projectId = Number(r.projectId);
    projectNr = String(r.projectNr ?? "");
    stepId = config.startStepId;
  }

  // Ab hier existiert das Projekt: Fehler sind Hinweise (sonst entstuende beim Wiederholen ein zweites Projekt).
  const positions = mergePositions(orig.positions ?? [], p.positions);
  const { actions, hints } = buildConfirmationActions(positions);
  warnings.push(...hints);
  let doc: { id: number | null; nr: string | null } = { id: null, nr: null };
  try {
    doc = await hero!.createDocument(projectId, Number(typeId), actions);
  } catch (e) {
    warnings.push(`Positionen konnten nicht in die AB übernommen werden (stehen im Logbuch): ${(e as Error).message}`.slice(0, 300));
    try { doc = await hero!.createDocument(projectId, Number(typeId), []); } catch (e2) {
      warnings.push(`AB konnte nicht angelegt werden – bitte in HERO von Hand: ${(e2 as Error).message}`.slice(0, 300));
    }
  }

  // 2. Schritt (nur freigegebene Ziele)
  const toStepId = Number(p.toStepId) || null;
  if (toStepId) {
    if (!config.stepIds.includes(toStepId)) warnings.push("Der gewählte Schritt ist nicht als Ziel freigegeben – Status unverändert.");
    else if (stepId !== toStepId) await hero!.setStep(projectId, toStepId).catch((e) => warnings.push(`Statuswechsel fehlgeschlagen: ${(e as Error).message}`));
  }

  // 3. Logbuch + Folge-Vorschlag „AB versenden"
  await hero!.addLogbook(projectId, confirmationLogText({ ...orig, positions }, doc.nr)).catch((e) => warnings.push(`Logbuch: ${(e as Error).message}`));
  if (doc.id) await store.createSuggestion(s.message_id, "send_document", sendPayload("confirmation", doc.id, doc.nr, projectId, projectNr, s, { ...orig, ...p }));
  return { projectId, projectNr, documentId: doc.id, positions: positions.filter((x) => x.include).length };
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * Dokument an den Kunden versenden – ueber HERO, mit der HERO-Vorlage und dem PDF. Echter Versand, deshalb:
 * nur per Klick, nur ein abgeschlossenes Dokument (PDF da) genau dieses Projekts, nur eine Vorlage aus HERO.
 */
async function sendDocument(s: SuggestionRow, p: any, deps: ActionDeps, warnings: string[]): Promise<Record<string, unknown>> {
  const { hero } = deps;
  const kind: DocumentKind = p.kind === "offer" ? "offer" : "confirmation";
  const documentId = Number(need(p.documentId, "Dokument fehlt."));
  const projectId = Number(need(s.payload.projectId, "Projekt fehlt."));
  const recipient = String(p.recipient ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(recipient)) throw new NotReadyError("Bitte eine gültige Empfänger-Adresse eintragen.");

  // Dokument-ID und Projekt kommen aus dem gespeicherten Vorschlag, nie aus dem Client.
  if (documentId !== Number(s.payload.documentId)) throw new ActionError("Dokument passt nicht zum Vorschlag.");
  const doc = need(await hero!.documentById(documentId), `Dokument ${documentId} gibt es in HERO nicht (gelöscht?).`);
  if (doc.projectId !== projectId) throw new ActionError("Das Dokument gehört zu einem anderen Projekt.");
  if (doc.baseType && doc.baseType !== kind) throw new ActionError(`Das Dokument ist kein${kind === "offer" ? " Angebot" : "e Auftragsbestätigung"}.`);
  if (doc.statusCode === 200) return { documentId, documentNr: doc.nr, alreadySent: true };
  if (doc.statusCode < 100 || !doc.fileUuid) {
    throw new NotReadyError(`${doc.nr || "Das Dokument"} ist noch ein Entwurf ohne PDF – bitte in HERO prüfen und abschließen, dann hier versenden.`);
  }

  const templates = await hero!.emailTemplates(kind);
  const tpl = templates.find((t) => t.id === Number(p.templateId));
  if (!tpl) throw new NotReadyError("Bitte eine HERO-Mailvorlage auswählen.");

  await hero!.sendDocumentMail({ kind, documentId, recipient, templateId: tpl.id, fileUuid: doc.fileUuid });

  const after = await hero!.documentById(documentId).catch(() => null);
  if (after && after.statusCode !== 200) {
    await hero!.setDocumentSent(documentId).catch((e) => warnings.push(`Versendet, aber Status nicht gesetzt: ${(e as Error).message}`.slice(0, 200)));
  }
  await hero!.addLogbook(projectId, `📧 ${doc.nr} an ${recipient} versendet (Vorlage „${tpl.name}“, Mail-Assistent nach Freigabe).`)
    .catch((e) => warnings.push(`Logbuch: ${(e as Error).message}`));
  return { documentId, documentNr: doc.nr, recipient, templateId: tpl.id, sent: true };
}
