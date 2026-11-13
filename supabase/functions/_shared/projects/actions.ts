// project-action: schreibende Aktionen auf HERO-Projekten (Phase 2).
//
// Schattenmodus: solange app_config.projects_write_enabled nicht "true" ist, wird NICHTS nach HERO geschrieben.
// Die Aktion landet dann nur in project_actions_log (shadow = true). Alle HERO-Zugriffe kommen von aussen (`HeroOps`),
// damit die Logik ohne HERO testbar ist. Fehler werfen mit deutscher Meldung; der Aufrufer macht daraus { ok:false }.

import { evaluateAll } from "./evaluate.ts";
import { isMode, looksLikeEmail, type AutopilotMode } from "./followup.ts";
import { displayStepName, isClosedKey, stepKey } from "./steps.ts";

export interface HeroStep { id: number; name: string }

export interface HeroOps {
  listSteps(): Promise<HeroStep[]>;
  setStep(heroId: number, stepId: number): Promise<void>;
  addLogbook(heroId: number, text: string): Promise<void>;
  createEvent(a: {
    heroId: number; title: string; startIso: string; endIso: string; categoryId: number; partnerId: number | null; description?: string;
  }): Promise<{ id: number | null; error?: string }>;
}

export interface ActionCtx {
  sb: any;
  ops: HeroOps;
  /** Anzeigename fuer Log und Logbuch. */
  user: string;
  shadow: boolean;
  now?: Date;
  /** Sichtbarkeit fuer Entwuerfe (Mitarbeiter sehen nur eigene bzw. nicht zugewiesene Projekte). */
  canSee?: (p: { assignee_emails: string[] | null }) => boolean;
}

export interface ActionResult {
  ok: true;
  shadow: boolean;
  message: string;
  /** Warnungen, die die Aktion nicht verhindert haben (z. B. Logbuch fehlgeschlagen). */
  warnings?: string[];
  [k: string]: unknown;
}

const MAX_TEXT = 2000;
export const MAX_EVENTS = 6;
export const MAX_BULK = 25;

async function logAction(c: ActionCtx, action: string, heroId: number | null, payload: Record<string, unknown>, extra: { response?: unknown; error?: string } = {}) {
  const { error } = await c.sb.from("project_actions_log").insert({
    user: c.user, action, hero_id: heroId, payload, shadow: c.shadow, hero_response: extra.response ?? null, error: extra.error ?? null,
  });
  if (error) console.warn("[project-action] Log fehlgeschlagen:", error.message);
}

async function loadProject(c: ActionCtx, heroId: number) {
  const { data, error } = await c.sb.from("hero_projects").select("hero_id, project_nr, name, step_id, step_name, step_key").eq("hero_id", heroId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Projekt nicht gefunden (nicht mehr offen?).");
  return data as { hero_id: number; project_nr: string; name: string; step_id: number | null; step_name: string; step_key: string };
}

/** Status per Schluessel (z. B. "abgeschlossen") in der echten HERO-Liste finden – nie eine feste ID. */
export async function findStepByKey(ops: HeroOps, key: string): Promise<HeroStep> {
  const steps = await ops.listSteps();
  const hit = steps.find((s) => stepKey(s.name) === key);
  if (!hit) throw new Error(`In HERO gibt es keinen Status „${key}“.`);
  return hit;
}

/** Spiegel sofort anpassen (der naechste hero-sync bestaetigt es): geschlossene Projekte fliegen raus. */
async function mirrorStep(c: ActionCtx, heroId: number, step: HeroStep) {
  const key = stepKey(step.name);
  if (isClosedKey(key)) {
    await c.sb.from("hero_projects").delete().eq("hero_id", heroId);
  } else {
    await c.sb.from("hero_projects").update({ step_id: step.id, step_name: step.name, step_key: key, step_since: (c.now ?? new Date()).toISOString() }).eq("hero_id", heroId);
  }
}

async function logbookSafe(c: ActionCtx, heroId: number, text: string, warnings: string[]) {
  try { await c.ops.addLogbook(heroId, text.slice(0, MAX_TEXT)); } catch (e) { warnings.push(`Logbuch-Eintrag fehlgeschlagen: ${(e as Error).message}`); }
}

async function changeStep(c: ActionCtx, action: "set_step" | "complete" | "archive", heroId: number, step: HeroStep, note?: string): Promise<ActionResult> {
  const p = await loadProject(c, heroId);
  const label = `${p.project_nr} → ${displayStepName(step.name)}`;
  const payload = { stepId: step.id, stepName: step.name, from: p.step_name, ...(note ? { note } : {}) };
  if (c.shadow) {
    await logAction(c, action, heroId, payload);
    return { ok: true, shadow: true, message: `Schattenmodus: ${label} wäre gesetzt worden (nichts geschrieben).` };
  }
  try {
    await c.ops.setStep(heroId, step.id);
  } catch (e) {
    await logAction(c, action, heroId, payload, { error: (e as Error).message });
    throw e;
  }
  const warnings: string[] = [];
  await mirrorStep(c, heroId, step);
  const from = displayStepName(p.step_name);
  const text = action === "complete"
    ? `Projekt abgeschlossen (Projekte-Ansicht, ${c.user}).${note ? ` ${note}` : ""}`
    : action === "archive"
      ? `Projekt archiviert (Projekte-Ansicht, ${c.user}).${note ? ` ${note}` : ""}`
      : `Status von „${from}“ auf „${displayStepName(step.name)}“ gesetzt (Projekte-Ansicht, ${c.user}).${note ? ` ${note}` : ""}`;
  await logbookSafe(c, heroId, text, warnings);
  await logAction(c, action, heroId, payload, { response: { ok: true, warnings } });
  return { ok: true, shadow: false, message: `${label} gesetzt.`, ...(warnings.length ? { warnings } : {}) };
}

export async function setStepAction(c: ActionCtx, heroId: number, stepId: number): Promise<ActionResult> {
  const steps = await c.ops.listSteps();
  const step = steps.find((s) => s.id === stepId);
  if (!step) throw new Error("Diesen Status gibt es in HERO nicht.");
  const r = await changeStep(c, "set_step", heroId, step);
  if (!c.shadow) await evaluateAll(c.sb, c.now);
  return r;
}

export async function completeAction(c: ActionCtx, heroId: number): Promise<ActionResult> {
  const r = await changeStep(c, "complete", heroId, await findStepByKey(c.ops, "abgeschlossen"));
  if (!c.shadow) await evaluateAll(c.sb, c.now);
  return r;
}

export async function archiveAction(c: ActionCtx, heroId: number): Promise<ActionResult> {
  const r = await changeStep(c, "archive", heroId, await findStepByKey(c.ops, "archiviert"));
  if (!c.shadow) await evaluateAll(c.sb, c.now);
  return r;
}

export async function noteAction(c: ActionCtx, heroId: number, textRaw: string): Promise<ActionResult> {
  const text = String(textRaw || "").trim();
  if (!text) throw new Error("Bitte einen Text eingeben.");
  if (text.length > MAX_TEXT) throw new Error(`Höchstens ${MAX_TEXT} Zeichen.`);
  const p = await loadProject(c, heroId);
  const payload = { text };
  if (c.shadow) {
    await logAction(c, "logbook_note", heroId, payload);
    return { ok: true, shadow: true, message: `Schattenmodus: Notiz für ${p.project_nr} wäre eingetragen worden (nichts geschrieben).` };
  }
  try {
    await c.ops.addLogbook(heroId, `${text}\n— ${c.user} (Projekte-Ansicht)`);
  } catch (e) {
    await logAction(c, "logbook_note", heroId, payload, { error: (e as Error).message });
    throw e;
  }
  await logAction(c, "logbook_note", heroId, payload, { response: { ok: true } });
  return { ok: true, shadow: false, message: "Notiz im HERO-Logbuch eingetragen." };
}

// ---------------------------------------------------------------------------------------------- Termine

export interface EventInput {
  title: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" Berliner Ortszeit */
  time?: string;
  durationMinutes: number;
  /** employees.id (-> hero_partner_id); leer = ohne Mitarbeiter */
  employeeId?: string | null;
}

/** Berliner Wanduhrzeit -> echter Zeitpunkt (ISO). `toHeroTime` rechnet beim Schreiben wieder zurueck. */
export function berlinWallToIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Datum oder Uhrzeit ungültig.");
  const wall = `${date}T${time}:00`;
  for (const off of ["+01:00", "+02:00"]) {
    const iso = new Date(`${wall}${off}`);
    if (Number.isNaN(iso.getTime())) continue;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(iso);
    const p: Record<string, string> = {};
    for (const x of parts) p[x.type] = x.value;
    if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` === wall) return iso.toISOString();
  }
  throw new Error("Datum oder Uhrzeit ungültig.");
}

export async function eventsAction(c: ActionCtx, heroId: number, events: EventInput[], categoryId: number | null): Promise<ActionResult> {
  if (!Array.isArray(events) || !events.length) throw new Error("Keine Termine angegeben.");
  if (events.length > MAX_EVENTS) throw new Error(`Höchstens ${MAX_EVENTS} Termine auf einmal.`);
  const p = await loadProject(c, heroId);

  // Alles vorab pruefen: entweder werden alle Termine angelegt oder keiner wegen eines Tippfehlers.
  const ids = [...new Set(events.map((e) => e.employeeId).filter((x): x is string => !!x))];
  const partner = new Map<string, number | null>();
  if (ids.length) {
    const { data } = await c.sb.from("employees").select("id, hero_partner_id").in("id", ids);
    for (const r of data || []) partner.set(String(r.id), r.hero_partner_id != null ? Number(r.hero_partner_id) : null);
  }
  const planned = events.map((e) => {
    const title = String(e.title || "").trim();
    if (!title) throw new Error("Jeder Termin braucht einen Titel.");
    const dur = Math.round(Number(e.durationMinutes));
    if (!(dur >= 15 && dur <= 24 * 60)) throw new Error("Dauer: 15 Minuten bis 24 Stunden.");
    const startIso = berlinWallToIso(String(e.date), String(e.time || "08:00"));
    const endIso = new Date(new Date(startIso).getTime() + dur * 60_000).toISOString();
    return { title, startIso, endIso, durationMinutes: dur, date: e.date, time: e.time || "08:00", partnerId: e.employeeId ? (partner.get(e.employeeId) ?? null) : null, employeeId: e.employeeId ?? null };
  });
  const payload = { events: planned.map((x) => ({ title: x.title, date: x.date, time: x.time, durationMinutes: x.durationMinutes, employeeId: x.employeeId })) };

  if (c.shadow) {
    await logAction(c, "create_events", heroId, payload);
    return { ok: true, shadow: true, message: `Schattenmodus: ${planned.length} Termin(e) für ${p.project_nr} wären angelegt worden (nichts geschrieben).` };
  }
  if (!categoryId) throw new Error("HERO verlangt eine Terminkategorie (Einstellung projects_event_category_id bzw. booking_hero_category_id fehlt).");

  const created: { title: string; id: number }[] = [];
  const failed: string[] = [];
  for (const e of planned) {
    const r = await c.ops.createEvent({ heroId, title: e.title, startIso: e.startIso, endIso: e.endIso, categoryId, partnerId: e.partnerId });
    if (r.id) created.push({ title: e.title, id: r.id });
    else failed.push(`${e.title}: ${r.error ?? "unbekannter Fehler"}`);
  }
  const warnings: string[] = [];
  if (created.length) {
    await logbookSafe(c, heroId, `Termine angelegt (Projekte-Ansicht, ${c.user}): ${planned.filter((x) => created.some((k) => k.title === x.title)).map((x) => `${x.title} ${x.date} ${x.time}`).join("; ")}`, warnings);
  }
  await logAction(c, "create_events", heroId, payload, { response: { created, failed }, error: failed.length ? failed.join(" | ") : undefined });
  if (failed.length && !created.length) throw new Error(`Termine nicht angelegt – ${failed.join(" | ")}`);
  if (failed.length) warnings.push(`Nicht angelegt: ${failed.join(" | ")}`);
  return { ok: true, shadow: false, message: `${created.length} Termin(e) in HERO angelegt.`, created, ...(warnings.length ? { warnings } : {}) };
}

// ---------------------------------------------------------------------------------------------- Aufraeumen

/** Mehrere Projekte archivieren (hoechstens MAX_BULK je Aufruf – die Oberflaeche ruft in Paketen auf). */
export async function bulkArchiveAction(c: ActionCtx, heroIds: number[]): Promise<ActionResult> {
  const ids = [...new Set((heroIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) throw new Error("Keine Projekte ausgewählt.");
  if (ids.length > MAX_BULK) throw new Error(`Höchstens ${MAX_BULK} Projekte je Aufruf.`);
  const step = await findStepByKey(c.ops, "archiviert");
  const done: number[] = [];
  const failed: { heroId: number; error: string }[] = [];
  const warnings: string[] = [];
  for (const id of ids) {
    try {
      const p = await loadProject(c, id);
      const payload = { stepId: step.id, from: p.step_name, bulk: true };
      if (c.shadow) { await logAction(c, "bulk_archive", id, payload); done.push(id); continue; }
      await c.ops.setStep(id, step.id);
      await mirrorStep(c, id, step);
      await logbookSafe(c, id, `Projekt archiviert (Aufräumen, ${c.user}).`, warnings);
      await logAction(c, "bulk_archive", id, payload, { response: { ok: true } });
      done.push(id);
    } catch (e) {
      const msg = (e as Error).message;
      failed.push({ heroId: id, error: msg });
      await logAction(c, "bulk_archive", id, { bulk: true }, { error: msg });
    }
  }
  if (!c.shadow && done.length) await evaluateAll(c.sb, c.now);
  return {
    ok: true, shadow: c.shadow, done, failed,
    message: c.shadow
      ? `Schattenmodus: ${done.length} Projekt(e) wären archiviert worden (nichts geschrieben).`
      : `${done.length} archiviert${failed.length ? `, ${failed.length} fehlgeschlagen` : ""}.`,
    ...(warnings.length ? { warnings } : {}),
  };
}

// ---------------------------------------------------------------------------------------------- Nachfassen

/** Entwurf in der Karte bearbeiten (Empfaenger, Betreff, Text). Rein lokal – gesendet wird erst per Klick. */
export async function saveDraftAction(c: ActionCtx, draftId: string, patch: { to?: string; subject?: string; body?: string }): Promise<ActionResult> {
  const { data: d } = await c.sb.from("project_followup_mails").select("id, hero_id, state").eq("id", draftId).maybeSingle();
  if (!d || d.state !== "draft") throw new Error("Dieser Entwurf ist nicht mehr offen.");
  const { data: p } = await c.sb.from("hero_projects").select("hero_id, assignee_emails").eq("hero_id", d.hero_id).maybeSingle();
  if (!p || (c.canSee && !c.canSee(p))) throw new Error("Projekt nicht gefunden.");
  const upd: Record<string, string> = {};
  if (patch.to !== undefined) {
    const to = String(patch.to).trim().toLowerCase();
    if (!looksLikeEmail(to)) throw new Error("Bitte eine gültige E-Mail-Adresse eintragen.");
    upd.to_email = to;
  }
  if (patch.subject !== undefined) {
    const subject = String(patch.subject).trim();
    if (!subject || subject.length > 300) throw new Error("Betreff: 1 bis 300 Zeichen.");
    upd.subject = subject;
  }
  if (patch.body !== undefined) {
    const body = String(patch.body).replace(/\r\n/g, "\n").trim();
    if (!body || body.length > 10_000) throw new Error("Text: 1 bis 10.000 Zeichen.");
    upd.body = body;
  }
  if (!Object.keys(upd).length) throw new Error("Nichts zu ändern.");
  const { error } = await c.sb.from("project_followup_mails").update(upd).eq("id", draftId).eq("state", "draft");
  if (error) throw new Error(error.message);
  await logAction(c, "save_draft", Number(d.hero_id), { draftId, fields: Object.keys(upd) });
  return { ok: true, shadow: false, message: "Entwurf gespeichert." };
}

/**
 * Autopilot je Projekt und Regel („Für dieses Projekt automatisch nachfassen“). mode = null: zurueck zur Einstellung der Regel.
 * Gilt auch im Schattenmodus (Einstellung, nicht Versand) – gesendet wird ohnehin nur ausserhalb des Schattenmodus.
 */
export async function setAutopilotAction(c: ActionCtx, heroId: number, ruleKey: string, mode: AutopilotMode | null): Promise<ActionResult> {
  await loadProject(c, heroId);
  const { data: rule } = await c.sb.from("project_rules").select("key, channel, label").eq("key", ruleKey).maybeSingle();
  if (!rule || rule.channel !== "mail") throw new Error("Für diese Regel gibt es keinen Mailweg.");
  if (mode !== null && !isMode(mode)) throw new Error("Autopilot: off, suggest oder auto.");
  if (mode === null) {
    const { error } = await c.sb.from("project_autopilot").delete().eq("hero_id", heroId).eq("rule_key", ruleKey);
    if (error) throw new Error(error.message);
  } else {
    const { data: ex } = await c.sb.from("project_autopilot").select("hero_id").eq("hero_id", heroId).eq("rule_key", ruleKey).maybeSingle();
    const r = ex
      ? await c.sb.from("project_autopilot").update({ mode }).eq("hero_id", heroId).eq("rule_key", ruleKey)
      : await c.sb.from("project_autopilot").insert({ hero_id: heroId, rule_key: ruleKey, mode });
    if (r.error) throw new Error(r.error.message);
  }
  await logAction(c, "set_autopilot", heroId, { ruleKey, mode });
  return { ok: true, shadow: false, message: mode === null ? "Zurück zur Einstellung der Regel." : mode === "auto" ? "Für dieses Projekt wird automatisch nachgefasst." : mode === "off" ? "Für dieses Projekt wird nicht nachgefasst." : "Für dieses Projekt gibt es einen Entwurf zum Senden." };
}

/** „Anruf erledigt“ (Stufe 2 der Kette): merkt den Anruf, schreibt ins HERO-Logbuch, setzt die Wiedervorlage der Regel. */
export async function callDoneAction(c: ActionCtx, heroId: number): Promise<ActionResult> {
  const p = await loadProject(c, heroId);
  const { data: rule } = await c.sb.from("project_rules").select("key, followup_days, followup_reason").eq("key", "nachfassen_anruf").maybeSingle();
  if (shadowOnly(c)) {
    await logAction(c, "call_done", heroId, {});
    return { ok: true, shadow: true, message: `Schattenmodus: Anruf zu ${p.project_nr} wäre vermerkt worden (nichts geschrieben).` };
  }
  const now = c.now ?? new Date();
  const warnings: string[] = [];
  const ins = await c.sb.from("project_followup_mails").insert({ hero_id: heroId, rule_key: "nachfassen", stage: 2, subject: "(Anruf)", body: `Anruf erledigt von ${c.user}`, state: "sent", sent_at: now.toISOString() });
  if (ins.error) throw new Error(ins.error.message);
  await logbookSafe(c, heroId, `Nachfass-Anruf erledigt (Projekte-Ansicht, ${c.user}).`, warnings);
  const due = new Date(now.getTime() + (Number(rule?.followup_days) || 7) * 86_400_000);
  due.setUTCHours(6, 0, 0, 0);
  await c.sb.from("followups").update({ done_at: now.toISOString() }).eq("target_type", "project").eq("hero_id", heroId).is("done_at", null);
  await c.sb.from("followups").insert({ target_type: "project", hero_id: heroId, due_at: due.toISOString(), reason: rule?.followup_reason || "Nach dem Anruf nachhaken", stage: 2 });
  await c.sb.from("project_cards").update({ state: "snoozed" }).eq("hero_id", heroId).in("state", ["open", "in_hero"]);
  await logAction(c, "call_done", heroId, {}, { response: { ok: true, warnings } });
  return { ok: true, shadow: false, message: "Anruf vermerkt.", ...(warnings.length ? { warnings } : {}) };
}

const shadowOnly = (c: ActionCtx) => c.shadow;
