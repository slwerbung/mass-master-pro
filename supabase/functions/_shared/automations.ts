// Shared automation dispatch.
//
// Used by run-automations (HTTP entry, e.g. from the client) and directly by
// other edge functions that fire triggers server-side (submit-vehicle-request).
//
// Extensibility: add a new action by adding a handler to ACTION_HANDLERS.
// Add a new trigger by calling dispatchAutomations(supabase, "<trigger>", ctx)
// from wherever that event happens — no change needed here for new triggers.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateAufmassPdf, uploadPdfToHero, fmtDate } from "./aufmassPdf.ts";
import { loadDropboxSettings, getDropboxAccessToken, dbxEnsureTree, buildName } from "./dropbox.ts";

// Calendar mutations live on the documented current API version. If HERO
// retires the (deprecated) create_calendar_event, swap the mutation here.
const HERO_GRAPHQL_URL = "https://login.hero-software.de/api/external/v9/graphql";

export interface AutomationContext {
  // The local project UUID. Used by assign_employee and similar actions.
  projectId?: string | null;
  // The linked HERO project_match_id, when known. Calendar actions need it.
  heroProjectId?: number | null;
  // CaptFix employee id that triggered the automation (if any). Used to
  // default the calendar target to that employee's mapped HERO partner.
  actingEmployeeId?: string | null;
  // Free-form extras for logging / future conditions.
  [k: string]: unknown;
}

interface AutomationRow {
  id: string;
  name: string;
  trigger_type: string;
  action_type: string;
  action_config: Record<string, any>;
}

type ActionResult = { status: "success" | "error" | "skipped"; message: string };

// ── date helper: ISO 8601 with the correct Europe/Berlin offset ──────────
function berlinOffset(d: Date): string {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    timeZoneName: "longOffset",
  }).format(d);
  const m = s.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+01:00";
}
function toBerlinIso(instant: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${berlinOffset(instant)}`;
}
// base = "now" in Berlin + dayOffset days, at HH:MM, lasting durationMin.
// When skipWeekends is set, a resulting Saturday/Sunday is pushed to the next
// Monday (nächster Werktag).
function buildEventTimes(now: Date, dayOffset: number, time: string, durationMin: number, skipWeekends = false) {
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [y, m, d] = dayFmt.format(now).split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + (Number.isFinite(dayOffset) ? dayOffset : 0));
  if (skipWeekends) {
    // base was built from Berlin y/m/d, so getUTCDay() is the correct weekday.
    const wd = base.getUTCDay(); // 0 = Sun, 6 = Sat
    if (wd === 6) base.setUTCDate(base.getUTCDate() + 2);
    else if (wd === 0) base.setUTCDate(base.getUTCDate() + 1);
  }
  const ty = base.getUTCFullYear(), tm = base.getUTCMonth() + 1, td = base.getUTCDate();
  const [hhRaw, miRaw] = (time || "09:00").split(":");
  const hh = Math.min(23, Math.max(0, parseInt(hhRaw, 10) || 9));
  const mi = Math.min(59, Math.max(0, parseInt(miRaw, 10) || 0));
  const offset = berlinOffset(new Date(Date.UTC(ty, tm - 1, td, 12)));
  const sign = offset[0] === "-" ? -1 : 1;
  const [oh, om] = offset.slice(1).split(":").map(Number);
  const offsetMin = sign * (oh * 60 + om);
  const startInstant = new Date(Date.UTC(ty, tm - 1, td, hh, mi, 0) - offsetMin * 60000);
  const dur = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 60;
  const endInstant = new Date(startInstant.getTime() + dur * 60000);
  return { start: toBerlinIso(startInstant), end: toBerlinIso(endInstant) };
}

// ── HERO calendar action ──────────────────────────────────────────────--
async function heroCreateCalendarEvent(
  apiKey: string, input: Record<string, unknown>
): Promise<{ ok: boolean; id?: number; error?: string }> {
  const query = `mutation Create($calendar_event: CalendarEventInput!) {
    calendar_event: create_calendar_event(calendar_event: $calendar_event) { id title start end }
  }`;
  try {
    const resp = await fetch(HERO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables: { calendar_event: input } }),
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
    const data = JSON.parse(text);
    if (data.errors?.length) return { ok: false, error: data.errors[0]?.message || "GraphQL-Fehler" };
    return { ok: true, id: data?.data?.calendar_event?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function runHeroCalendarAction(
  supabase: SupabaseClient,
  apiKey: string | undefined, heroEnabled: boolean,
  cfg: Record<string, any>, ctx: AutomationContext
): Promise<ActionResult> {
  if (!heroEnabled || !apiKey) return { status: "skipped", message: "HERO ist nicht aktiv" };
  const projectMatchId = ctx.heroProjectId;
  if (!projectMatchId) return { status: "skipped", message: "Projekt nicht mit HERO verknüpft" };

  const { start, end } = buildEventTimes(
    new Date(),
    Number(cfg.dayOffset ?? 0),
    String(cfg.time ?? "09:00"),
    Number(cfg.durationMinutes ?? 60),
    // Default ON: unless explicitly disabled, push weekend dates to the next
    // working day. Existing rules (no key stored) benefit without re-saving.
    cfg.skipWeekends !== false && cfg.skipWeekends !== "false"
  );
  const input: Record<string, unknown> = {
    title: cfg.title || "Aufmaß vor Ort",
    start, end,
    project_match_id: projectMatchId,
  };
  if (cfg.description) input.description = String(cfg.description);
  if (cfg.categoryId) input.category_id = Number(cfg.categoryId);
  if (cfg.allDay === true || cfg.allDay === "true") input.all_day = true;

  // Resolve the appointment target.
  // 1) explicit cfg.target ("partner:ID" / "resource:ID", or a raw number = partner for legacy),
  // 2) legacy cfg.partnerId (raw number = partner),
  // 3) fallback: the triggering employee's mapped HERO partner.
  let partnerId: number | null = null;
  let resourceId: number | null = null;
  let targetNote = "";

  const rawTarget = cfg.target != null && String(cfg.target).trim() !== "" ? String(cfg.target).trim() : "";
  if (rawTarget) {
    if (rawTarget.startsWith("resource:")) {
      const n = Number(rawTarget.slice("resource:".length));
      if (Number.isInteger(n) && n > 0) { resourceId = n; targetNote = `Ressource ${n}`; }
    } else if (rawTarget.startsWith("partner:")) {
      const n = Number(rawTarget.slice("partner:".length));
      if (Number.isInteger(n) && n > 0) { partnerId = n; targetNote = `Mitarbeiter ${n}`; }
    } else {
      const n = Number(rawTarget);
      if (Number.isInteger(n) && n > 0) { partnerId = n; targetNote = `Mitarbeiter ${n}`; }
    }
  } else if (cfg.partnerId) {
    const n = Number(cfg.partnerId);
    if (Number.isInteger(n) && n > 0) { partnerId = n; targetNote = `Mitarbeiter ${n}`; }
  } else if (ctx.actingEmployeeId) {
    // No explicit target — use the triggering employee's HERO mapping.
    const { data: emp } = await supabase
      .from("employees")
      .select("hero_partner_id, name")
      .eq("id", ctx.actingEmployeeId)
      .maybeSingle();
    if (emp?.hero_partner_id) {
      partnerId = Number(emp.hero_partner_id);
      targetNote = `auslösender Mitarbeiter (${emp.name || partnerId})`;
    }
  }

  if (partnerId) input.partner_ids = [partnerId];
  if (resourceId) input.resource_ids = [resourceId];

  const res = await heroCreateCalendarEvent(apiKey, input);
  if (res.ok) {
    const who = targetNote ? `, ${targetNote}` : ", ohne Zuordnung";
    return { status: "success", message: `HERO-Termin angelegt (ID ${res.id ?? "?"}) für ${start}${who}` };
  }
  return { status: "error", message: res.error || "Unbekannter Fehler" };
}

// ── assign_employee action ────────────────────────────────────────────
async function runAssignEmployeeAction(
  supabase: SupabaseClient,
  _apiKey: string | undefined,
  _heroEnabled: boolean,
  cfg: Record<string, any>,
  ctx: AutomationContext
): Promise<ActionResult> {
  const projectId = ctx.projectId as string | undefined;
  if (!projectId) return { status: "skipped", message: "Keine Projekt-ID im Kontext" };

  // Use explicit employee from config, fall back to the triggering employee.
  const employeeId = (cfg.employee_id && String(cfg.employee_id).trim()) || ctx.actingEmployeeId;
  if (!employeeId) return { status: "skipped", message: "Kein Mitarbeiter angegeben und kein auslösender Mitarbeiter im Kontext" };

  // Upsert into project_employee_assignments (ignore if already assigned).
  const { error } = await supabase
    .from("project_employee_assignments")
    .upsert({ project_id: projectId, employee_id: employeeId }, { onConflict: "project_id,employee_id" });

  if (error) return { status: "error", message: `Zuordnung fehlgeschlagen: ${error.message}` };

  // Fetch name for logging.
  const { data: emp } = await supabase.from("employees").select("name").eq("id", employeeId).maybeSingle();
  return { status: "success", message: `Mitarbeiter "${emp?.name || employeeId}" dem Projekt ${projectId} zugeordnet` };
}

// ── HERO: upload Aufmaß-PDF action ────────────────────────────────────
// Generates a project Aufmaß-PDF and uploads it to the linked HERO project
// as a document. The document type defaults to the admin mapping
// (app_config "hero_doc_type_aufmass_pdf") but can be overridden per
// automation via cfg.documentType.
async function runHeroUploadAufmassPdfAction(
  supabase: SupabaseClient,
  apiKey: string | undefined,
  heroEnabled: boolean,
  cfg: Record<string, any>,
  ctx: AutomationContext,
): Promise<ActionResult> {
  if (!heroEnabled || !apiKey) return { status: "skipped", message: "HERO ist nicht aktiv" };
  const heroProjectId = ctx.heroProjectId;
  if (!heroProjectId) return { status: "skipped", message: "Projekt nicht mit HERO verknüpft" };
  const projectId = ctx.projectId as string | undefined;
  if (!projectId) return { status: "skipped", message: "Keine Projekt-ID im Kontext" };

  // Resolve document type: explicit cfg override, else admin mapping.
  let docTypeId: number | null = null;
  const cfgDoc = cfg.documentType != null && String(cfg.documentType).trim() !== "" ? Number(cfg.documentType) : NaN;
  if (Number.isFinite(cfgDoc) && cfgDoc > 0) {
    docTypeId = cfgDoc;
  } else {
    const { data: dtRow } = await supabase.from("app_config").select("value").eq("key", "hero_doc_type_aufmass_pdf").maybeSingle();
    const v = dtRow?.value ? parseInt(String(dtRow.value), 10) : NaN;
    if (Number.isFinite(v) && v > 0) docTypeId = v;
  }

  // Resolve project number + company name.
  const { data: proj } = await supabase.from("projects").select("project_number").eq("id", projectId).maybeSingle();
  const projectNumber = (ctx.projectNumber as string) || proj?.project_number || projectId.slice(0, 8);
  const customerName = (ctx.customerName as string) || "Kunde";

  let companyName = "SL WERBUNG";
  const { data: legalRow } = await supabase.from("app_config").select("value").eq("key", "legal_info").maybeSingle();
  if (legalRow?.value) {
    try {
      const info = JSON.parse(legalRow.value);
      if (info?.companyName?.trim()) companyName = info.companyName.trim();
    } catch { /* keep default */ }
  }

  const bytes = await generateAufmassPdf(supabase, { projectId, projectNumber, customerName, companyName });
  if (!bytes) return { status: "skipped", message: "Kein PDF erzeugt (keine Standorte)" };

  const safeNum = projectNumber.replace(/[^A-Za-z0-9-]/g, "_");
  const dateStr = fmtDate(new Date()).replace(/\./g, "-");
  const filename = `Captfix_Freigabe_${safeNum}_${dateStr}.pdf`;
  const res = await uploadPdfToHero(apiKey, Number(heroProjectId), bytes, filename, docTypeId);
  if (res.ok) {
    return { status: "success", message: `Aufmaß-PDF nach HERO hochgeladen (${filename}${docTypeId ? `, Typ ${docTypeId}` : ", ohne Typ"})` };
  }
  return { status: "error", message: res.error || "Upload fehlgeschlagen" };
}

// ── HERO: set project status (Plantafel step) ────────────────────────
// Moves the linked HERO project to a fixed status step. HERO only accepts the
// status via the NESTED current_project_match_status object (a top-level
// step_id is silently ignored). v7 is where update_project_match is proven.
async function runHeroSetStatusAction(
  _supabase: SupabaseClient,
  apiKey: string | undefined, heroEnabled: boolean,
  cfg: Record<string, any>, ctx: AutomationContext,
): Promise<ActionResult> {
  if (!heroEnabled || !apiKey) return { status: "skipped", message: "HERO ist nicht aktiv" };
  const projectMatchId = ctx.heroProjectId;
  if (!projectMatchId) return { status: "skipped", message: "Projekt nicht mit HERO verknüpft" };
  const stepId = cfg.statusStep != null && String(cfg.statusStep).trim() !== "" ? Number(cfg.statusStep) : NaN;
  if (!Number.isFinite(stepId) || stepId <= 0) return { status: "skipped", message: "Kein Zielstatus konfiguriert" };
  try {
    const resp = await fetch("https://login.hero-software.de/api/external/v7/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: `mutation($pm: ProjectMatchInput!){ update_project_match(project_match: $pm){ id current_project_match_status { step_id } } }`,
        variables: { pm: { id: projectMatchId, current_project_match_status: { step_id: stepId } } },
      }),
    });
    const text = await resp.text();
    if (!resp.ok) return { status: "error", message: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
    const data = JSON.parse(text);
    if (data.errors?.length) return { status: "error", message: data.errors[0]?.message || "GraphQL-Fehler" };
    const newStep = Number(data?.data?.update_project_match?.current_project_match_status?.step_id);
    if (newStep !== stepId) return { status: "error", message: `Status nicht übernommen (Ziel-Step ${stepId}) – passt der Status zum Projekttyp?` };
    return { status: "success", message: `HERO-Status gesetzt (Step ${stepId})` };
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }
}

// ── Dropbox: Kundenordner anlegen ─────────────────────────────────────
// Basis-Pfad + Kundenordner (Namensmuster aus der Dropbox-Karte im Admin).
// Idempotent: existierende Ordner sind kein Fehler.
async function runDropboxCustomerFolderAction(
  supabase: SupabaseClient,
  _apiKey: string | undefined, _heroEnabled: boolean,
  _cfg: Record<string, any>, ctx: AutomationContext,
): Promise<ActionResult> {
  const settings = await loadDropboxSettings(supabase);
  if (!settings.enabled) return { status: "skipped", message: "Dropbox-Integration ist nicht aktiv" };
  const customerName = String(ctx.customerName || "").trim();
  if (!customerName) return { status: "skipped", message: "Kein Kundenname im Kontext" };

  const tokenRes = await getDropboxAccessToken(supabase);
  if ("error" in tokenRes) return { status: "error", message: tokenRes.error };

  const folder = buildName(settings.customerPattern, {
    kunde: customerName,
    kundennr: ctx.heroCustomerId != null ? String(ctx.heroCustomerId) : "",
  });
  const path = `${settings.basePath}/${folder}`;
  const res = await dbxEnsureTree(tokenRes.token, path, []);
  if (!res.ok) return { status: "error", message: res.error || "Dropbox-Fehler" };

  if (ctx.heroCustomerId) {
    await supabase.from("dropbox_synced").upsert(
      { kind: "customer", hero_id: Number(ctx.heroCustomerId), dropbox_path: path },
      { onConflict: "kind,hero_id" },
    );
  }
  return { status: "success", message: `Kundenordner ${res.created.length > 0 ? "angelegt" : "vorhanden"}: ${path}` };
}

// ── Dropbox: Projektordner + Unterordner-Vorlage anlegen ──────────────
// Legt (falls nötig auch) den Kundenordner an, darin den Projektordner und
// die im Admin konfigurierte Unterordner-Struktur.
async function runDropboxProjectFolderAction(
  supabase: SupabaseClient,
  _apiKey: string | undefined, _heroEnabled: boolean,
  _cfg: Record<string, any>, ctx: AutomationContext,
): Promise<ActionResult> {
  const settings = await loadDropboxSettings(supabase);
  if (!settings.enabled) return { status: "skipped", message: "Dropbox-Integration ist nicht aktiv" };
  const projectNr = String(ctx.projectNr || "").trim();
  const projectName = String(ctx.projectName || "").trim();
  const customerName = String(ctx.customerName || "").trim();
  if (!projectNr && !projectName) return { status: "skipped", message: "Keine Projektdaten im Kontext" };

  const tokenRes = await getDropboxAccessToken(supabase);
  if ("error" in tokenRes) return { status: "error", message: tokenRes.error };

  // Kundenordner bestimmen. Wenn Captfix für diese HERO-Kunden-ID schon
  // einmal einen Ordner angelegt hat, ist dessen echter Pfad in
  // dropbox_synced gespeichert → wir verwenden GENAU diesen wieder (auch
  // wenn das Namensmuster inzwischen geändert wurde), statt ihn neu zu
  // berechnen. Nur ohne gespeicherten Pfad wird er aus dem Muster gebaut.
  let customerPath: string | null = null;
  if (ctx.heroCustomerId) {
    const { data: known } = await supabase.from("dropbox_synced")
      .select("dropbox_path").eq("kind", "customer").eq("hero_id", Number(ctx.heroCustomerId)).maybeSingle();
    if (known?.dropbox_path) customerPath = known.dropbox_path as string;
  }
  if (!customerPath) {
    const customerFolder = buildName(settings.customerPattern, {
      kunde: customerName || "Ohne Kunde",
      kundennr: ctx.heroCustomerId != null ? String(ctx.heroCustomerId) : "",
    });
    customerPath = `${settings.basePath}/${customerFolder}`;
  }
  const projectFolder = buildName(settings.projectPattern, {
    projektnr: projectNr,
    projektname: projectName,
    kunde: customerName,
  });
  const path = `${customerPath}/${projectFolder}`;
  const res = await dbxEnsureTree(tokenRes.token, path, settings.subfolders);
  if (!res.ok) return { status: "error", message: res.error || "Dropbox-Fehler" };

  if (ctx.heroProjectId) {
    await supabase.from("dropbox_synced")
      .update({ dropbox_path: path })
      .eq("kind", "project").eq("hero_id", Number(ctx.heroProjectId));
  }
  // Kundenordner-Pfad für diese HERO-Kunden-ID merken, damit spätere
  // Projekte desselben Kunden immer denselben Ordner nutzen.
  if (ctx.heroCustomerId) {
    await supabase.from("dropbox_synced").upsert(
      { kind: "customer", hero_id: Number(ctx.heroCustomerId), dropbox_path: customerPath },
      { onConflict: "kind,hero_id" },
    );
  }
  return {
    status: "success",
    message: `Projektordner ${path} (${res.created.length} neu, ${settings.subfolders.length} Unterordner geprüft)`,
  };
}

const ACTION_HANDLERS: Record<
  string,
  (supabase: SupabaseClient, apiKey: string | undefined, heroEnabled: boolean, cfg: any, ctx: AutomationContext) => Promise<ActionResult>
> = {
  assign_employee: runAssignEmployeeAction,
  hero_create_calendar_event: runHeroCalendarAction,
  hero_upload_aufmass_pdf: runHeroUploadAufmassPdfAction,
  hero_set_status: runHeroSetStatusAction,
  dropbox_create_customer_folder: runDropboxCustomerFolderAction,
  dropbox_create_project_folder: runDropboxProjectFolderAction,
};

// ── dispatch ─────────────────────────────────────────────────────────---
export async function dispatchAutomations(
  supabase: SupabaseClient, triggerType: string, ctx: AutomationContext
): Promise<{ ran: number }> {
  const { data: rules } = await supabase
    .from("automations")
    .select("id,name,trigger_type,action_type,action_config")
    .eq("trigger_type", triggerType)
    .eq("enabled", true)
    .order("sort_order");

  const list = (rules || []) as AutomationRow[];
  if (list.length === 0) return { ran: 0 };

  // Read HERO config once for all matching rules.
  const { data: cfgRows } = await supabase
    .from("app_config").select("key,value").in("key", ["hero_api_key", "hero_enabled"]);
  const conf = new Map((cfgRows || []).map((r: any) => [r.key, r.value]));
  const apiKey = (conf.get("hero_api_key") as string) || undefined;
  const heroEnabled = conf.get("hero_enabled") === "true" || conf.get("hero_enabled") === true;

  for (const rule of list) {
    const handler = ACTION_HANDLERS[rule.action_type];
    let result: ActionResult;
    if (!handler) {
      result = { status: "error", message: `Unbekannte Aktion: ${rule.action_type}` };
    } else {
      try {
        result = await handler(supabase, apiKey, heroEnabled, rule.action_config || {}, ctx);
      } catch (e) {
        result = { status: "error", message: (e as Error).message };
      }
    }
    await supabase.from("automation_runs").insert({
      automation_id: rule.id,
      automation_name: rule.name,
      trigger_type: rule.trigger_type,
      action_type: rule.action_type,
      status: result.status,
      message: result.message,
      context: ctx,
    });
  }
  return { ran: list.length };
}
