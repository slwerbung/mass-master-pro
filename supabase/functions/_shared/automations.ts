// Shared automation dispatch.
//
// Used by run-automations (HTTP entry, e.g. from the client) and directly by
// other edge functions that fire triggers server-side (submit-vehicle-request).
//
// Extensibility: add a new action by adding a handler to ACTION_HANDLERS.
// Add a new trigger by calling dispatchAutomations(supabase, "<trigger>", ctx)
// from wherever that event happens — no change needed here for new triggers.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Calendar mutations live on the documented current API version. If HERO
// retires the (deprecated) create_calendar_event, swap the mutation here.
const HERO_GRAPHQL_URL = "https://login.hero-software.de/api/external/v9/graphql";

export interface AutomationContext {
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
function buildEventTimes(now: Date, dayOffset: number, time: string, durationMin: number) {
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [y, m, d] = dayFmt.format(now).split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + (Number.isFinite(dayOffset) ? dayOffset : 0));
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
    Number(cfg.durationMinutes ?? 60)
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

const ACTION_HANDLERS: Record<
  string,
  (supabase: SupabaseClient, apiKey: string | undefined, heroEnabled: boolean, cfg: any, ctx: AutomationContext) => Promise<ActionResult>
> = {
  hero_create_calendar_event: runHeroCalendarAction,
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
