// Schnittstelle des Bereichs „Projekte“ der Mail-App. Die Oberflaeche greift NUR hierueber zu.
// Phase 1 = Schattenmodus: nichts geht nach HERO, keine Mail wird versendet. Die einzige Aktion ist die
// lokale Wiedervorlage (followups). Admin-Einstellungen nur fuer Admins.
//
//   POST { action: "...", ...parameter }  ->  { ok: true, data } | { ok: false, error }

import { createClient } from "@supabase/supabase-js";
import { fail, ok, preflight, readJson, type MailUser } from "../_shared/email/http.ts";
import { requireMailUser } from "../_shared/email/http.ts";
import { canSee, isShadow } from "../_shared/projects/access.ts";
import { evaluateAll } from "../_shared/projects/evaluate.ts";
import { berlinDayStartIso, effectiveAutopilot, parseWindow } from "../_shared/projects/followup.ts";
import { daysBetween } from "../_shared/projects/rules.ts";
import { normalizeDocuments } from "../_shared/projects/docs.ts";
import { DEFAULT_CHECKLISTS, parseChecklists, type TaskKind } from "../_shared/projects/heroTask.ts";

type Ctx = { sb: any; user: MailUser; body: Record<string, any> };

const must = <T extends { error: any }>(r: T): T => {
  if (r.error) throw new Error(r.error.message);
  return r;
};
const isAdmin = (u: MailUser) => u.role === "admin";
const DOC_LABEL: Record<string, string> = { offer: "Angebot", confirmation: "Auftragsbestätigung", delivery_note: "Lieferschein", measurement: "Aufmaß", calculation: "Kalkulation", letter: "Brief", invoice: "Rechnung", reversal_invoice: "Stornorechnung" };
/** „Abschlussrechnung RG-… – Versendet“: der HERO-Dokumentname gewinnt, sonst die Art. Allgemeine Uploads heißen „Dokument“. */
const docLabel = (d: { type: string; kind?: string }) => (d.kind && d.type !== "generic" ? d.kind : DOC_LABEL[d.type] ?? (d.kind || "Dokument"));

async function log(sb: any, user: MailUser, action: string, heroId: number | null, payload: Record<string, unknown>) {
  await sb.from("project_actions_log").insert({ user: user.name || user.email || user.id, action, hero_id: heroId, payload, shadow: await isShadow(sb) });
}

const PROJECT_COLS = "hero_id, project_nr, name, kunde, kunde_email, kunde_telefon, ort, gewerk, step_id, step_name, step_since, assignee_emails, hero_created";

function projectView(p: any, now: Date) {
  return {
    heroId: Number(p.hero_id), nr: p.project_nr, name: p.name, kunde: p.kunde, kundeEmail: p.kunde_email || "", kundeTelefon: p.kunde_telefon || "", ort: p.ort, gewerk: p.gewerk,
    stepName: p.step_name, days: daysBetween(p.step_since ?? p.hero_created, now), assignees: p.assignee_emails || [],
  };
}

async function loadProjects(sb: any, ids: number[]): Promise<Map<number, any>> {
  const map = new Map<number, any>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = must(await sb.from("hero_projects").select(PROJECT_COLS).in("hero_id", ids.slice(i, i + 100)));
    (data || []).forEach((p: any) => map.set(Number(p.hero_id), p));
  }
  return map;
}

const handlers: Record<string, (c: Ctx) => Promise<unknown>> = {
  /** Zahlen fuer Seitenleiste und Kopfzeile. */
  async overview({ sb, user }) {
    const now = new Date();
    const [cards, fus, run, sync, autoSent] = await Promise.all([
      sb.from("project_cards").select("hero_id, bundled").in("state", ["open", "in_hero"]),
      sb.from("followups").select("hero_id").eq("target_type", "project").is("done_at", null),
      sb.from("project_runs").select("created_at, ok, error, stats").eq("kind", "evaluate").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("project_runs").select("created_at, ok, error, stats").eq("kind", "sync").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("project_actions_log").select("id", { count: "exact", head: true }).eq("action", "auto_followup").eq("shadow", false),
    ]);
    const ids = [...new Set([...(cards.data || []), ...(fus.data || [])].map((r: any) => Number(r.hero_id)))];
    const projects = await loadProjects(sb, ids);
    const visible = (id: number) => { const p = projects.get(id); return !!p && canSee(user, p); };
    return {
      shadow: await isShadow(sb),
      cards: (cards.data || []).filter((c: any) => !c.bundled && visible(Number(c.hero_id))).length,
      cleanup: (cards.data || []).filter((c: any) => c.bundled && visible(Number(c.hero_id))).length,
      followups: (fus.data || []).filter((f: any) => visible(Number(f.hero_id))).length,
      lastSync: sync.data || null, lastEvaluate: run.data || null, now: now.toISOString(),
      autoSent: autoSent.count ?? 0,
    };
  },

  /** Autopilot-Dialog: Regeln mit Mailweg, Versandfenster, Limits, wie viel heute/insgesamt automatisch gesendet wurde. */
  async autopilot_overview({ sb }) {
    const [rules, cfg, today, total] = await Promise.all([
      sb.from("project_rules").select("key, label, suggestion, autopilot, active").eq("channel", "mail").order("sort", { ascending: true }),
      sb.from("app_config").select("key, value").in("key", ["projects_followup_hours", "projects_auto_max_per_run", "projects_auto_max_per_day", "projects_write_enabled"]),
      sb.from("project_actions_log").select("id", { count: "exact", head: true }).eq("action", "auto_followup").eq("shadow", false).gte("created_at", berlinDayStartIso(new Date())),
      sb.from("project_actions_log").select("id", { count: "exact", head: true }).eq("action", "auto_followup").eq("shadow", false),
    ]);
    must(rules);
    const c = new Map((cfg.data || []).map((r: any) => [r.key, r.value]));
    return {
      rules: rules.data, window: parseWindow(c.get("projects_followup_hours")), maxPerRun: Number(c.get("projects_auto_max_per_run")) || 5,
      maxPerDay: Number(c.get("projects_auto_max_per_day")) || 20, shadow: c.get("projects_write_enabled") !== "true",
      autoSentToday: today.count ?? 0, autoSentTotal: total.count ?? 0,
    };
  },

  /** Stapel, Aufraeum-Karte und Wiedervorlagen in einem Aufruf. */
  async list({ sb, user }) {
    const now = new Date();
    const [cards, fus, rules, cfg, drafts, overrides, tasks, checklistCfg] = await Promise.all([
      sb.from("project_cards").select("id, hero_id, rule_key, category, priority, state, bundled, reasons, created_at, locked_until").in("state", ["open", "in_hero"]).order("priority", { ascending: true }),
      sb.from("followups").select("id, hero_id, due_at, reason, stage").eq("target_type", "project").is("done_at", null).order("due_at", { ascending: true }),
      sb.from("project_rules").select("key, label, suggestion, channel, followup_days, followup_reason, autopilot"),
      sb.from("app_config").select("value").eq("key", "projects_bundle_after_days").maybeSingle(),
      sb.from("project_followup_mails").select("id, hero_id, rule_key, stage, subject, body, to_email, error").eq("state", "draft"),
      sb.from("project_autopilot").select("hero_id, rule_key, mode"),
      sb.from("hero_tasks").select("id, card_id, task, created_by, created_by_name, finished_at, check_result").or(`finished_at.is.null,finished_at.gt.${new Date(now.getTime() - 3 * 86_400_000).toISOString()}`),
      sb.from("app_config").select("value").eq("key", "projects_checklists").maybeSingle(),
    ]);
    must(cards); must(fus); must(rules); must(drafts); must(overrides); must(tasks);
    const lists = parseChecklists(checklistCfg.data?.value);
    // Arbeitsmodus: offene Aufgabe je Karte und letzter Hinweis aus einer nicht bestandenen Rueckkehr.
    const openTask = new Map<string, any>(), hintBy = new Map<string, string>();
    for (const t of tasks.data || []) {
      if (!t.finished_at) openTask.set(t.card_id, t);
      else if (t.check_result?.passed === false && t.check_result?.message) hintBy.set(t.card_id, String(t.check_result.message));
    }
    const draftBy = new Map<string, any>((drafts.data || []).map((d: any) => [`${d.hero_id}:${d.rule_key}`, d]));
    const modeBy = new Map<string, string>((overrides.data || []).map((o: any) => [`${o.hero_id}:${o.rule_key}`, o.mode]));
    const ids = [...new Set([...(cards.data || []), ...(fus.data || [])].map((r: any) => Number(r.hero_id)))];
    const projects = await loadProjects(sb, ids);
    const ruleBy = new Map<string, any>((rules.data || []).map((r: any) => [r.key, r]));
    const card = (c: any) => {
      const p = projects.get(Number(c.hero_id));
      const r = ruleBy.get(c.rule_key);
      const key = `${c.hero_id}:${c.rule_key}`;
      const d = draftBy.get(key);
      return p && canSee(user, p)
        ? {
          id: c.id, ruleKey: c.rule_key, ruleLabel: r?.label ?? c.rule_key, suggestion: r?.suggestion ?? "", channel: r?.channel ?? "api", followupDays: r?.followup_days ?? null, followupReason: r?.followup_reason ?? "", category: c.category, reasons: c.reasons, project: projectView(p, now),
          // Nachfassen: Autopilot (Projekt vor Regel), Override am Projekt und der Entwurf, falls vorhanden.
          autopilot: effectiveAutopilot(r?.autopilot, modeBy.get(key)), autopilotOverride: modeBy.get(key) ?? null,
          draft: d ? { id: d.id, to: d.to_email || "", subject: d.subject, body: d.body, stage: d.stage, error: d.error ?? null } : null,
          state: c.state,
          heroTask: (() => {
            const t = openTask.get(c.id);
            if (!t) return null;
            const k: TaskKind = (t.task as TaskKind) in DEFAULT_CHECKLISTS ? (t.task as TaskKind) : "generic";
            return { id: t.id, kind: k, label: lists[k].label, checklist: lists[k].items, by: t.created_by_name || "", mine: t.created_by === user.id, lockedUntil: c.locked_until ?? null };
          })(),
          hint: openTask.has(c.id) ? null : hintBy.get(c.id) ?? null,
        }
        : null;
    };
    const mapped = (cards.data || []).map((c: any) => ({ c, v: card(c) })).filter((x: any) => x.v);
    return {
      bundleAfterDays: Number(cfg.data?.value) || 60,
      stack: mapped.filter((x: any) => !x.c.bundled).map((x: any) => x.v),
      cleanup: mapped.filter((x: any) => x.c.bundled).map((x: any) => x.v),
      followups: (fus.data || []).map((f: any) => {
        const p = projects.get(Number(f.hero_id));
        return p && canSee(user, p) ? { id: f.id, dueAt: f.due_at, reason: f.reason, stage: f.stage, project: projectView(p, now) } : null;
      }).filter(Boolean),
    };
  },

  /** Kopf, letzte Ereignisse und Zusammenfassung einer Karte. */
  async detail({ sb, user, body }) {
    const heroId = Number(body.heroId);
    const { data: p } = must(await sb.from("hero_projects").select("*").eq("hero_id", heroId).maybeSingle());
    if (!p || !canSee(user, p)) throw new Error("Projekt nicht gefunden.");
    const now = new Date();
    const docs = normalizeDocuments(p.documents);
    const events: { at: string; text: string }[] = [];
    if (p.step_since) events.push({ at: p.step_since, text: `Status „${p.step_name.replace(/^[^\p{L}\p{N}]+/u, "")}“ gesetzt` });
    for (const d of docs) if (d.created) events.push({ at: d.created, text: `${docLabel(d)}${d.nr ? ` ${d.nr}` : ""} – ${d.status}` });
    events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const count = (t: string) => docs.filter((d) => d.type === t).length;
    return {
      project: projectView(p, now),
      events: events.slice(0, 3),
      summary: `${p.kunde || "Kunde unbekannt"} · ${p.name} · ${count("offer")} Angebot(e), ${count("confirmation")} AB`,
    };
  },

  /** Wiedervorlage legen: Karte verschwindet aus dem Stapel und kommt am Tag wieder (rein lokal). */
  async snooze({ sb, user, body }) {
    const heroId = Number(body.heroId);
    const reason = String(body.reason || "").trim();
    if (!reason) throw new Error("Bitte einen Grund angeben.");
    const due = new Date(String(body.dueAt || ""));
    if (Number.isNaN(due.getTime())) throw new Error("Datum ungültig.");
    // Datum ohne Uhrzeit: am Morgen faellig.
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.dueAt))) due.setUTCHours(6, 0, 0, 0);
    if (due.getTime() <= Date.now()) throw new Error("Die Wiedervorlage muss in der Zukunft liegen.");
    const { data: p } = must(await sb.from("hero_projects").select("hero_id, assignee_emails").eq("hero_id", heroId).maybeSingle());
    if (!p || !canSee(user, p)) throw new Error("Projekt nicht gefunden.");

    await sb.from("followups").update({ done_at: new Date().toISOString() }).eq("target_type", "project").eq("hero_id", heroId).is("done_at", null);
    const { data: fu } = must(await sb.from("followups").insert({ target_type: "project", hero_id: heroId, due_at: due.toISOString(), reason, created_by: user.id }).select("id").single());
    must(await sb.from("project_cards").update({ state: "snoozed" }).eq("hero_id", heroId).in("state", ["open", "in_hero"]));
    await log(sb, user, "snooze", heroId, { dueAt: due.toISOString(), reason });
    return { id: fu.id };
  },

  /** „Jetzt holen“: Wiedervorlage vorziehen, Karte kommt sofort zurueck in den Stapel. */
  async wake({ sb, user, body }) {
    const { data: f } = must(await sb.from("followups").select("id, hero_id").eq("id", String(body.followupId || "")).is("done_at", null).maybeSingle());
    if (!f) throw new Error("Wiedervorlage nicht gefunden.");
    const { data: p } = must(await sb.from("hero_projects").select("hero_id, assignee_emails").eq("hero_id", f.hero_id).maybeSingle());
    if (!p || !canSee(user, p)) throw new Error("Projekt nicht gefunden.");
    must(await sb.from("followups").update({ due_at: new Date().toISOString() }).eq("id", f.id));
    await log(sb, user, "wake", Number(f.hero_id), { followupId: f.id });
    return await evaluateAll(sb);
  },

  /** Terminarten und Mitarbeiter (mit HERO-Zuordnung) fuer den Dialog „Termine anlegen“. */
  async event_setup({ sb }) {
    const [types, emps] = await Promise.all([
      sb.from("project_event_types").select("id, name, duration_minutes, gap_days, default_employee_id, sort").order("sort", { ascending: true }),
      sb.from("employees").select("id, name, hero_partner_id").not("hero_partner_id", "is", null).order("name", { ascending: true }),
    ]);
    must(types); must(emps);
    return {
      types: (types.data || []).map((t: any) => ({ id: t.id, name: t.name, durationMinutes: t.duration_minutes, gapDays: t.gap_days, defaultEmployeeId: t.default_employee_id })),
      employees: (emps.data || []).map((e: any) => ({ id: e.id, name: e.name })),
    };
  },

  // ------------------------------------------------------------------ Einstellungen (nur Admin)
  async settings({ sb }) {
    const [steps, rules, cfg, templates] = await Promise.all([
      sb.from("project_step_settings").select("*").order("closeness", { ascending: true }),
      sb.from("project_rules").select("*").order("sort", { ascending: true }),
      sb.from("app_config").select("key, value").in("key", ["projects_bundle_after_days", "projects_write_enabled", "projects_followup_hours", "projects_auto_max_per_run", "projects_auto_max_per_day", "projects_checklists"]),
      sb.from("project_followup_templates").select("rule_key, stage, subject, body").order("rule_key", { ascending: true }).order("stage", { ascending: true }),
    ]);
    must(steps); must(rules); must(templates);
    const c = new Map((cfg.data || []).map((r: any) => [r.key, r.value]));
    return {
      steps: steps.data, rules: rules.data, templates: templates.data, bundleAfterDays: Number(c.get("projects_bundle_after_days")) || 60, writeEnabled: c.get("projects_write_enabled") === "true",
      window: parseWindow(c.get("projects_followup_hours")), limits: { perRun: Number(c.get("projects_auto_max_per_run")) || 5, perDay: Number(c.get("projects_auto_max_per_day")) || 20 },
      checklists: parseChecklists(c.get("projects_checklists")),
    };
  },
  /** Checkliste einer HERO-Aufgabe (Arbeitsmodus): Name und Punkte. */
  async save_checklist({ sb, body }) {
    const kind = String(body.kind || "") as TaskKind;
    if (!(kind in DEFAULT_CHECKLISTS)) throw new Error("Unbekannte Aufgabe.");
    const label = String(body.label ?? "").trim();
    const items = (Array.isArray(body.items) ? body.items : []).map((x: unknown) => String(x).trim()).filter(Boolean);
    if (!label || label.length > 80) throw new Error("Name: 1 bis 80 Zeichen.");
    if (!items.length || items.length > 20 || items.some((x: string) => x.length > 200)) throw new Error("1 bis 20 Punkte, je höchstens 200 Zeichen.");
    const { data } = must(await sb.from("app_config").select("value").eq("key", "projects_checklists").maybeSingle());
    const all = { ...parseChecklists(data?.value), [kind]: { label, items } };
    must(await sb.from("app_config").upsert({ key: "projects_checklists", value: JSON.stringify(all) }, { onConflict: "key" }));
    return { ok: true };
  },
  async save_step({ sb, body }) {
    const patch: Record<string, unknown> = {};
    if (body.targetDays !== undefined) {
      const n = Math.round(Number(body.targetDays));
      if (!(n >= 0 && n <= 365)) throw new Error("Sollzeit: 0 bis 365 Tage.");
      patch.target_days = n;
    }
    if (body.excluded !== undefined) patch.excluded = !!body.excluded;
    if (body.closeness !== undefined) patch.closeness = Math.round(Number(body.closeness)) || 0;
    if (!Object.keys(patch).length) throw new Error("Nichts zu ändern.");
    must(await sb.from("project_step_settings").update(patch).eq("step_id", Number(body.stepId)));
    return { ok: true };
  },
  async save_rule({ sb, body }) {
    const patch: Record<string, unknown> = {};
    if (body.active !== undefined) patch.active = !!body.active;
    if (body.thresholdDays !== undefined) patch.threshold_days = body.thresholdDays === null || body.thresholdDays === "" ? null : Math.max(0, Math.round(Number(body.thresholdDays)));
    if (body.followupDays !== undefined) patch.followup_days = body.followupDays === null || body.followupDays === "" ? null : Math.max(0, Math.round(Number(body.followupDays)));
    if (body.followupReason !== undefined) patch.followup_reason = String(body.followupReason).slice(0, 200);
    if (body.suggestion !== undefined) patch.suggestion = String(body.suggestion).slice(0, 200);
    if (body.autopilot !== undefined) {
      if (!["off", "suggest", "auto"].includes(String(body.autopilot))) throw new Error("Autopilot: off, suggest oder auto.");
      patch.autopilot = String(body.autopilot);
    }
    if (!Object.keys(patch).length) throw new Error("Nichts zu ändern.");
    must(await sb.from("project_rules").update(patch).eq("key", String(body.key || "")));
    return { ok: true };
  },
  /** Nachfass-Vorlage je Regel und Stufe (Platzhalter {kunde} {projekt} {angebot_nr} {angebot_datum}). */
  async save_template({ sb, body }) {
    const ruleKey = String(body.ruleKey || "");
    const stage = Math.round(Number(body.stage));
    const subject = String(body.subject ?? "").trim();
    const text = String(body.body ?? "").replace(/\r\n/g, "\n").trim();
    if (!(stage >= 1 && stage <= 3)) throw new Error("Stufe: 1 bis 3.");
    if (!subject || subject.length > 300) throw new Error("Betreff: 1 bis 300 Zeichen.");
    if (!text || text.length > 10_000) throw new Error("Text: 1 bis 10.000 Zeichen.");
    const { data: rule } = must(await sb.from("project_rules").select("key, channel").eq("key", ruleKey).maybeSingle());
    if (!rule || rule.channel !== "mail") throw new Error("Für diese Regel gibt es keinen Mailweg.");
    must(await sb.from("project_followup_templates").upsert({ rule_key: ruleKey, stage, subject, body: text }, { onConflict: "rule_key,stage" }));
    return { ok: true };
  },
  /** Versandfenster des Autopiloten: Wochentage (1 = Mo … 7 = So) und Stunden (Berliner Ortszeit). */
  async save_window({ sb, body }) {
    const days = [...new Set((Array.isArray(body.days) ? body.days : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
    const from = Math.round(Number(body.from)), to = Math.round(Number(body.to));
    if (!days.length) throw new Error("Mindestens ein Wochentag.");
    if (!(from >= 0 && from <= 23 && to >= 1 && to <= 24 && from < to)) throw new Error("Uhrzeit: von 0–23 bis 1–24, „von“ vor „bis“.");
    must(await sb.from("app_config").upsert({ key: "projects_followup_hours", value: JSON.stringify({ days, from, to }) }, { onConflict: "key" }));
    return { ok: true };
  },
  /** Obergrenzen des Autopiloten (je Lauf und je Tag). */
  async save_limits({ sb, body }) {
    const perRun = Math.round(Number(body.perRun)), perDay = Math.round(Number(body.perDay));
    if (!(perRun >= 0 && perRun <= 100) || !(perDay >= 0 && perDay <= 500)) throw new Error("Grenzen: je Lauf 0–100, je Tag 0–500.");
    must(await sb.from("app_config").upsert([{ key: "projects_auto_max_per_run", value: String(perRun) }, { key: "projects_auto_max_per_day", value: String(perDay) }], { onConflict: "key" }));
    return { ok: true };
  },
  /** Schalter „Schreiben nach HERO“. Aus = Schattenmodus. */
  async save_write_enabled({ sb, user, body }) {
    const on = body.enabled === true;
    must(await sb.from("app_config").upsert({ key: "projects_write_enabled", value: on ? "true" : "false" }, { onConflict: "key" }));
    await log(sb, user, "set_write_enabled", null, { enabled: on });
    return { writeEnabled: on };
  },
  async save_bundle_days({ sb, body }) {
    const n = Math.round(Number(body.days));
    if (!(n >= 7 && n <= 730)) throw new Error("Aufräum-Schwelle: 7 bis 730 Tage.");
    must(await sb.from("app_config").upsert({ key: "projects_bundle_after_days", value: String(n) }, { onConflict: "key" }));
    return { ok: true };
  },
};

/** Nur Admins. */
const ADMIN_ONLY = new Set(["settings", "save_step", "save_rule", "save_bundle_days", "save_write_enabled", "save_template", "save_window", "save_limits", "save_checklist"]);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user = await requireMailUser(req, sb);
  if (!user) return fail("Nicht angemeldet oder kein Zugang zur Mail-App.", { code: "unauthorized" });
  const body = await readJson(req);
  const action = String(body.action || "");
  const h = handlers[action];
  if (!h) return fail("Unbekannte Aktion.");
  if (ADMIN_ONLY.has(action) && !isAdmin(user)) return fail("Nur für Admins.", { code: "forbidden" });
  try {
    return ok(await h({ sb, user, body }));
  } catch (e) {
    return fail(String((e as Error)?.message || e).slice(0, 300));
  }
});
