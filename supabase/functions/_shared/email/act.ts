// „Handeln" (email-process, Teil 3): je nach Autopilot-Stufe automatisch ausfuehren
// oder als Vorschlag ablegen.
//
//   * Ordner verschieben, IMAP-Schlagwoerter
//   * HERO-Logbuch (sicher: automatisch; vermutet: Vorschlag „Projekt zuordnen")
//   * Vorschlaege: Kontakt + Projekt anlegen, Statuswechsel
//
// Im Schattenmodus laeuft keine Automatik: der Assistent schreibt nur in `plan`, was er
// tun WUERDE (die Mail-App zeigt es an). Nichts wird versendet, nichts geloescht.

import { decide, type Decision } from "./autopilot.ts";
import type { MatchInfo } from "./matchStage.ts";
import { pickGewerk, type Gewerk } from "./gewerke.ts";
import { stepLabel, suggestStep, type StepIds } from "./steps.ts";
import { displayName } from "./mail.ts";
import {
  CATEGORY_FOLDER_KEY, INBOX_CATEGORIES, type Autopilot, type Category, type FolderKey, type MatchMethod, type MessageStatus,
} from "./types.ts";

export interface PlanEntry { action: string; decision: Decision; done: boolean; detail?: string }

export interface ActMessage {
  id: string;
  account_id: string;
  thread_id: string | null;
  direction: "in" | "out";
  current_folder: string | null;
  current_uid: number | null;
  from_addr: string;
  from_name: string;
  to_addrs: string[];
  subject: string;
  category: Category | null;
  confidence: number | null;
  summary: string | null;
  extracted: any;
  hero_project_match_id: number | null;
  match_method: MatchMethod | null;
  match_info: MatchInfo;
  hero_logged_at: string | null;
  has_attachments: boolean;
  plan: PlanEntry[];
  status: MessageStatus;
  attempts: number;
  // Fuer Entwuerfe (Phase 3)
  message_id?: string;
  refs?: string[];
  body_text?: string | null;
  sent_at?: string | null;
  draft_message_id?: string | null;
  draft_text?: string | null;
  draft_uid?: number | null;
  beleg_state?: string | null;
  forwarded_at?: string | null;
}

export interface ActImap {
  move(folder: string, uid: number, dest: string): Promise<number | null>;
  addKeywords(folder: string, uid: number, keywords: string[]): Promise<void>;
}

export interface ActHero {
  addLogbook(projectId: number, text: string): Promise<void>;
  /** Aktueller Pipeline-Schritt (live gelesen). */
  projectStep(projectId: number): Promise<{ stepId: number | null; nr: string; name: string } | null>;
  setStep(projectId: number, stepId: number): Promise<void>;
}

export interface ActStore {
  loadActable(accountId: string, limit: number): Promise<ActMessage[]>;
  save(id: string, patch: {
    status: MessageStatus; plan: PlanEntry[]; hero_logged_at?: string; current_folder?: string; current_uid?: number | null;
    error?: string | null; attempts?: number;
  }): Promise<void>;
  /** Sofort festhalten, was schon passiert ist (Logbuch, Verschieben) – scheitert ein spaeterer Schritt, darf er nicht doppelt laufen. */
  progress(id: string, patch: { hero_logged_at?: string; current_folder?: string; current_uid?: number | null }): Promise<void>;
  /** false, wenn es diesen Vorschlag schon offen gibt (kein Duplikat). */
  createSuggestion(messageId: string, type: string, payload: Record<string, unknown>): Promise<boolean>;
  hasOpenSuggestions(messageId: string): Promise<boolean>;
  /** Eingehende Mails des Threads, die noch im Posteingang liegen und ein HERO-Projekt haben. */
  unansweredIncoming(threadId: string): Promise<ActMessage[]>;
  /** Gibt es im Thread eine ausgehende Mail NACH diesem Zeitpunkt (= schon beantwortet)? */
  hasOutgoingAfter(threadId: string, sentAt: string | null): Promise<boolean>;
  loadAttachments(messageId: string): Promise<import("./attachments.ts").AttachmentRow[]>;
  /** Beleg-Stand an der Mail festhalten (Portal-Abholung / Weiterleitung offen). */
  setBelegState(id: string, state: "weiterleiten_offen" | "portal_offen", vendor: string | null): Promise<void>;
}

export interface ActContext {
  autopilot: Autopilot;
  shadowMode: boolean;
  /** Aufgeloeste Pfade im Postfach. */
  inbox: string;
  folders: Partial<Record<FolderKey, string>>;
  steps: StepIds;
  gewerke: Gewerk[];
  /** Bezeichnung des Postfachs fuer den Logbuch-Text, z. B. „info@". */
  accountLabel: string;
  /** Erweiterungspunkt der Phasen 3 und 4 (Entwurf, Anhaenge, Angebot). */
  extra?: (m: ActMessage, ctx: ActContext, deps: ActDeps, plan: PlanEntry[]) => Promise<void>;
}

export interface ActDeps {
  /** Hochladen ans HERO-Projekt (nur fuer die Stufe „Automatisch" bei Anhaengen). */
  uploader?: { upload(projectId: number, items: import("./attachments.ts").UploadItem[], messageId: string): Promise<{ uploaded: number; failed: string[] }> } | null;
  imap: ActImap | null;
  hero: ActHero | null;
  store: ActStore;
  now?: () => Date;
}

export const DISCARD_MIN_CONFIDENCE = 0.85;

/** Vermutete Zuordnungen sind weniger sicher als eine Modell-Konfidenz; grobe Stufen reichen. */
export function matchConfidence(method: MatchMethod | null, certain: boolean): number {
  if (certain) return 1;
  return method === "kontakt" ? 0.75 : method === "ki" ? 0.7 : 0.5;
}

export function logbookText(m: Pick<ActMessage, "direction" | "from_name" | "from_addr" | "to_addrs" | "subject" | "summary" | "has_attachments">, accountLabel: string, attachmentCount = 0): string {
  const subject = m.subject || "(ohne Betreff)";
  const sum = m.summary ? ` – ${m.summary}` : "";
  if (m.direction === "out") {
    return `📤 Mail an ${m.to_addrs[0] ?? "?"} (${accountLabel}): ${subject}${sum}`;
  }
  const who = displayName(m.from_name, m.from_addr);
  const att = m.has_attachments || attachmentCount ? `; Anhänge: ${attachmentCount || "ja"}` : "";
  return `📥 Mail von ${who} (${accountLabel}): ${subject}${sum}${att}`;
}

function folderTarget(m: ActMessage, ctx: ActContext): { key: FolderKey; rule: "folders" | "discard" } | { skip: string } | null {
  if (m.direction !== "in" || !m.category) return null;
  if (m.extracted?.beleg?.is_booking_document === true && m.extracted.beleg.delivery === "portal") return { key: "belegabholung", rule: "folders" };
  const key = CATEGORY_FOLDER_KEY[m.category] as FolderKey | null;
  if (!key) return null; // bleibt im Posteingang (Arbeitsliste)
  const reply = m.extracted?.reply?.needed === true;
  if (m.category === "verwaltung" && reply) return { skip: "Handlungsbedarf erkannt – bleibt im Posteingang" };
  if (m.category === "werbung_spam") {
    if (m.match_info?.knownContact || m.hero_project_match_id) return { skip: "Bekannter HERO-Kontakt – nie aussortieren" };
    if (m.extracted?._meta?.protect) return { skip: "Absender ist geschützt – nie aussortieren" };
    return { key, rule: "discard" };
  }
  return { key, rule: "folders" };
}

export interface ActResult {
  status: MessageStatus;
  plan: PlanEntry[];
  patch: { hero_logged_at?: string; current_folder?: string; current_uid?: number | null };
}

export async function actOn(m: ActMessage, ctx: ActContext, deps: ActDeps): Promise<ActResult> {
  const plan: PlanEntry[] = [];
  const patch: { hero_logged_at?: string; current_folder?: string; current_uid?: number | null } = {};
  const certain = m.match_info?.certain === true;
  const dec = (a: Parameters<typeof decide>[0], confidence: number | null, c?: boolean) =>
    decide(a, { autopilot: ctx.autopilot, shadowMode: ctx.shadowMode, confidence, certain: c });
  const note = (action: string, decision: Decision, done: boolean, detail?: string) => plan.push({ action, decision, done, detail });

  // ---------------------------------------------------------------- Belege
  // Der Stand ist nur eine Markierung in der Datenbank (Liste „Im Portal abzuholen“ bzw. „Weiterleiten offen“) –
  // er aendert nichts im Postfach und gilt deshalb auch im Schattenmodus.
  const beleg = m.extracted?.beleg;
  if (m.direction === "in" && beleg?.is_booking_document === true && !m.beleg_state) {
    const state = beleg.delivery === "portal" ? "portal_offen" : beleg.delivery === "anhang" && m.has_attachments ? "weiterleiten_offen" : null;
    if (state) {
      await deps.store.setBelegState(m.id, state, beleg.vendor ?? null);
      note("beleg", "auto", true, state === "portal_offen"
        ? `Rechnung liegt im Portal${beleg.vendor ? ` von ${beleg.vendor}` : ""} – im Ordner „Belege abholen“, Liste „Im Portal abzuholen“`
        : "Beleg mit Anhang – zum Weiterleiten vorgemerkt");
    }
  }

  // ---------------------------------------------------------------- Vorschlaege
  const projectId = m.hero_project_match_id;

  // Logbuch bzw. Zuordnung
  if (projectId) {
    if (m.hero_logged_at) {
      note("log", "skip", true, "Schon im Logbuch");
    } else if (!deps.hero) {
      note("log", "skip", false, "HERO ist nicht aktiviert");
    } else {
      const text = logbookText(m, ctx.accountLabel);
      const action = certain ? "log_certain" : "log_assumed";
      const d = dec(action, matchConfidence(m.match_method, certain), certain);
      if (d === "auto") {
        await deps.hero.addLogbook(projectId, text);
        patch.hero_logged_at = (deps.now?.() ?? new Date()).toISOString();
        await deps.store.progress(m.id, { hero_logged_at: patch.hero_logged_at });
        note("log", d, true, `Logbuch ${m.match_info?.projectNr ?? projectId}`);
      } else if (d === "suggest") {
        const created = await deps.store.createSuggestion(m.id, certain ? "log_entry" : "link_project", {
          projectId, projectNr: m.match_info?.projectNr ?? null, projectName: m.match_info?.projectName ?? null,
          method: m.match_method, reason: m.match_info?.reason ?? null, candidates: m.match_info?.candidates ?? [], text,
        });
        note("log", d, created, created ? "Vorschlag" : "Vorschlag liegt schon offen");
      } else {
        note("log", d, false, `Würde ins Logbuch von ${m.match_info?.projectNr ?? projectId} schreiben`);
      }
    }
  } else if (m.match_info?.candidates && m.match_info.candidates.length > 1 && m.direction === "in") {
    // Mehrere offene Projekte, keins eindeutig: der Mensch waehlt.
    const created = await deps.store.createSuggestion(m.id, "link_project", {
      projectId: null, candidates: m.match_info.candidates, text: logbookText(m, ctx.accountLabel), reason: m.match_info.reason,
    });
    note("link_project", "suggest", created, "Mehrere offene Projekte – bitte auswählen");
  }

  // Neue Anfrage ohne Projekt -> Kontakt + Projekt anlegen (Vorschlag)
  if (m.direction === "in" && m.category === "anfrage_neu" && !projectId) {
    const d = dec("create_project", m.confidence);
    if (d === "suggest" || d === "auto") {
      // „Automatisch" gibt es hier bewusst nicht: neue Daten in HERO entstehen nur per Klick.
      const created = await deps.store.createSuggestion(m.id, "create_project", buildCreateProjectPayload(m, ctx));
      note("create_project", "suggest", created, created ? "Vorschlag: Kontakt + Projekt anlegen" : "Vorschlag liegt schon offen");
    } else if (d === "shadow") {
      note("create_project", d, false, "Würde Kontakt + Projekt vorschlagen");
    }
  }

  // Statuswechsel
  const signal = m.extracted?.signal ?? null;
  if (m.direction === "in" && projectId && signal && deps.hero) {
    const cur = await deps.hero.projectStep(projectId).catch(() => null);
    const s = cur ? suggestStep(signal, cur.stepId, ctx.steps) : null;
    if (s) {
      const d = dec("status_change", m.confidence, certain);
      const payload = {
        projectId, projectNr: cur?.nr ?? null, fromStepId: cur?.stepId ?? null, toStepId: s.toStepId, toKey: s.toKey,
        toLabel: stepLabel(s.toKey), alternatives: s.alternatives.map((a) => ({ ...a, label: stepLabel(a.key) })),
        reason: s.reason, hint: s.hint ?? null, signal,
      };
      if (d === "auto") {
        await deps.hero.setStep(projectId, s.toStepId);
        note("status_change", d, true, `Schritt → ${stepLabel(s.toKey)}`);
      } else if (d === "suggest") {
        const created = await deps.store.createSuggestion(m.id, "change_step", payload);
        note("status_change", d, created, `Vorschlag: ${stepLabel(s.toKey)}`);
      } else if (d === "shadow") {
        note("status_change", d, false, `Würde ${stepLabel(s.toKey)} vorschlagen`);
      }
    }
  }

  // Phasen 3 und 4 (Entwurf, Anhaenge, Angebot) haengen sich hier ein.
  if (ctx.extra) await ctx.extra(m, ctx, deps, plan);

  // ---------------------------------------------------------------- Postfach
  const target = folderTarget(m, ctx);
  if (target && "skip" in target) {
    note("move", "skip", false, target.skip);
  } else if (target) {
    const dest = ctx.folders[target.key];
    const action = target.rule === "discard" ? "move_discard" : "move_folders";
    // Aussortieren nur bei hoher Konfidenz: sonst bleibt die Mail liegen.
    const conf = target.rule === "discard" && (m.confidence ?? 0) < DISCARD_MIN_CONFIDENCE ? 0 : m.confidence;
    const d = dec(action, conf, m.extracted?._meta?.source === "regel");
    if (!dest) note("move", "skip", false, "Zielordner ist nicht eingerichtet");
    else if (m.current_folder !== ctx.inbox) note("move", "skip", true, "Liegt nicht mehr im Posteingang");
    else if (d === "auto") {
      if (!deps.imap || m.current_uid == null) note("move", "skip", false, "Kein IMAP-Zugriff / UID unbekannt");
      else {
        const newUid = await deps.imap.move(ctx.inbox, m.current_uid, dest);
        patch.current_folder = dest;
        patch.current_uid = newUid;
        await deps.store.progress(m.id, { current_folder: dest, current_uid: newUid });
        note("move", d, true, `→ ${dest}`);
      }
    } else if (d === "shadow") note("move", d, false, `Würde nach „${dest}“ verschieben`);
    else if (d === "suggest") note("move", d, false, `Unsicher (${Math.round((m.confidence ?? 0) * 100)} %) – bleibt im Posteingang`);
  }

  // Beantwortet: fruehere Kundenmails des Threads wandern nach „1 Kunden & Projekte".
  if (m.direction === "out" && m.thread_id && ctx.folders.kunden) {
    const d = dec("move_answered", 1, true);
    const earlier = d === "skip" ? [] : await deps.store.unansweredIncoming(m.thread_id);
    for (const e of earlier) {
      if (!e.category || !INBOX_CATEGORIES.includes(e.category) || e.current_uid == null || e.current_folder !== ctx.inbox) continue;
      if (d === "auto" && deps.imap) {
        const newUid = await deps.imap.move(ctx.inbox, e.current_uid, ctx.folders.kunden);
        await deps.store.save(e.id, { status: "erledigt", plan: e.plan, current_folder: ctx.folders.kunden, current_uid: newUid });
        note("move_answered", d, true, `„${e.subject}“ → ${ctx.folders.kunden}`);
      } else {
        note("move_answered", d, false, `Würde „${e.subject}“ nach „${ctx.folders.kunden}“ verschieben`);
      }
    }
  }

  // Schlagwoerter (Thunderbird zeigt sie als Tags) – nach dem Verschieben an der neuen UID.
  const open = await deps.store.hasOpenSuggestions(m.id);
  const keywords: string[] = [];
  if (m.match_info?.projectNr) keywords.push(m.match_info.projectNr);
  if (open) keywords.push("Freigabe-offen");
  if (m.plan.some((p) => p.action === "draft" && p.done) || plan.some((p) => p.action === "draft" && p.done)) keywords.push("KI-Entwurf");
  if (keywords.length) {
    const d = dec("keywords", 1, true);
    const folder = patch.current_folder ?? m.current_folder;
    const uid = "current_uid" in patch ? patch.current_uid : m.current_uid;
    if (d === "auto") {
      if (deps.imap && folder && uid != null) {
        await deps.imap.addKeywords(folder, uid, keywords);
        note("keywords", d, true, keywords.join(", "));
      } else note("keywords", "skip", false, "Kein IMAP-Zugriff / UID unbekannt");
    } else if (d === "shadow") note("keywords", d, false, `Würde setzen: ${keywords.join(", ")}`);
  }

  return { status: open ? "wartet" : "erledigt", plan, patch };
}

export interface ActSummary { processed: number; errors: number; moved: number; logged: number; suggestions: number }

export async function actPending(accountId: string, ctx: ActContext, deps: ActDeps, limit = 20): Promise<ActSummary> {
  const sum: ActSummary = { processed: 0, errors: 0, moved: 0, logged: 0, suggestions: 0 };
  for (const m of await deps.store.loadActable(accountId, limit)) {
    try {
      const r = await actOn(m, ctx, deps);
      sum.processed++;
      sum.moved += r.plan.filter((p) => p.action.startsWith("move") && p.decision === "auto" && p.done).length;
      sum.logged += r.plan.filter((p) => p.action === "log" && p.decision === "auto" && p.done).length;
      sum.suggestions += r.plan.filter((p) => p.decision === "suggest" && p.done).length;
      await deps.store.save(m.id, { status: r.status, plan: r.plan, ...r.patch, error: null });
    } catch (e) {
      sum.errors++;
      // Nach drei Fehlversuchen aufgeben (Status „fehler"), statt jede 5 Minuten neu zu versuchen.
      const attempts = m.attempts + 1;
      await deps.store.save(m.id, {
        status: attempts >= 3 ? "fehler" : m.status, plan: m.plan, attempts,
        error: String((e as Error)?.message || e).slice(0, 400),
      });
    }
  }
  return sum;
}

// ---------------------------------------------------------------------------

export function buildCreateProjectPayload(m: ActMessage, ctx: Pick<ActContext, "gewerke">): Record<string, unknown> {
  const ex = m.extracted ?? {};
  const contact = ex.contact ?? {};
  const req = ex.request ?? {};
  const text = `${m.subject}\n${req.summary ?? ""}`;
  const g = pickGewerk(ctx.gewerke, { service: req.service ?? null, text });
  const name =
    (req.project_name as string | null) || [req.service, req.location].filter(Boolean).join(" ") || m.subject || "Neue Anfrage";
  return {
    contact: {
      salutation: contact.salutation ?? null, first_name: contact.first_name ?? null, last_name: contact.last_name ?? null,
      company: contact.company ?? null, email: contact.email || m.from_addr, phone: contact.phone ?? null,
      street: contact.street ?? null, zip: contact.zip ?? null, city: contact.city ?? null,
    },
    project: { name, gewerk: g ? { short: g.short, measure_id: g.measure_id } : null, notes: req.summary ?? m.subject },
    request: { service: req.service ?? null, dimensions: req.dimensions ?? null, quantity: req.quantity ?? null, material: req.material ?? null, location: req.location ?? null },
    summary: m.summary,
    subject: m.subject,
    from: m.from_addr,
  };
}
