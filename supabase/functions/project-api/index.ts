// Schnittstelle des Bereichs „Projekte“ der Mail-App. Die Oberflaeche greift NUR hierueber zu.
// Phase 1 = Schattenmodus: nichts geht nach HERO, keine Mail wird versendet. Die einzige Aktion ist die
// lokale Wiedervorlage (followups). Admin-Einstellungen nur fuer Admins.
//
//   POST { action: "...", ...parameter }  ->  { ok: true, data } | { ok: false, error }

import { createClient } from "@supabase/supabase-js";
import { fail, ok, preflight, readJson, type MailUser } from "../_shared/email/http.ts";
import { requireMailUser } from "../_shared/email/http.ts";
import { evaluateAll } from "../_shared/projects/evaluate.ts";
import { daysBetween } from "../_shared/projects/rules.ts";
import { normalizeDocuments } from "../_shared/projects/docs.ts";

type Ctx = { sb: any; user: MailUser; body: Record<string, any> };

const must = <T extends { error: any }>(r: T): T => {
  if (r.error) throw new Error(r.error.message);
  return r;
};
const isAdmin = (u: MailUser) => u.role === "admin";
const DOC_LABEL: Record<string, string> = { offer: "Angebot", confirmation: "Auftragsbestätigung", delivery_note: "Lieferschein", measurement: "Aufmaß", calculation: "Kalkulation", letter: "Brief" };

/** Mitarbeiter sehen Projekte, bei denen sie Bearbeiter sind oder noch niemand zugewiesen ist; Admin sieht alle. */
const canSee = (u: MailUser, p: { assignee_emails: string[] }) =>
  isAdmin(u) || !p.assignee_emails?.length || (!!u.email && p.assignee_emails.includes(u.email.toLowerCase()));

async function shadowMode(sb: any): Promise<boolean> {
  const { data } = await sb.from("app_config").select("value").eq("key", "projects_write_enabled").maybeSingle();
  return data?.value !== "true";
}

async function log(sb: any, user: MailUser, action: string, heroId: number | null, payload: Record<string, unknown>) {
  await sb.from("project_actions_log").insert({ user: user.name || user.email || user.id, action, hero_id: heroId, payload, shadow: await shadowMode(sb) });
}

const PROJECT_COLS = "hero_id, project_nr, name, kunde, ort, gewerk, step_id, step_name, step_since, assignee_emails, hero_created";

function projectView(p: any, now: Date) {
  return {
    heroId: Number(p.hero_id), nr: p.project_nr, name: p.name, kunde: p.kunde, ort: p.ort, gewerk: p.gewerk,
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
    const [cards, fus, run, sync] = await Promise.all([
      sb.from("project_cards").select("hero_id, bundled").eq("state", "open"),
      sb.from("followups").select("hero_id").eq("target_type", "project").is("done_at", null),
      sb.from("project_runs").select("created_at, ok, error, stats").eq("kind", "evaluate").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("project_runs").select("created_at, ok, error, stats").eq("kind", "sync").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const ids = [...new Set([...(cards.data || []), ...(fus.data || [])].map((r: any) => Number(r.hero_id)))];
    const projects = await loadProjects(sb, ids);
    const visible = (id: number) => { const p = projects.get(id); return !!p && canSee(user, p); };
    return {
      shadow: await shadowMode(sb),
      cards: (cards.data || []).filter((c: any) => !c.bundled && visible(Number(c.hero_id))).length,
      cleanup: (cards.data || []).filter((c: any) => c.bundled && visible(Number(c.hero_id))).length,
      followups: (fus.data || []).filter((f: any) => visible(Number(f.hero_id))).length,
      lastSync: sync.data || null, lastEvaluate: run.data || null, now: now.toISOString(),
    };
  },

  /** Stapel, Aufraeum-Karte und Wiedervorlagen in einem Aufruf. */
  async list({ sb, user }) {
    const now = new Date();
    const [cards, fus, rules, cfg] = await Promise.all([
      sb.from("project_cards").select("id, hero_id, rule_key, category, priority, state, bundled, reasons, created_at").eq("state", "open").order("priority", { ascending: true }),
      sb.from("followups").select("id, hero_id, due_at, reason, stage").eq("target_type", "project").is("done_at", null).order("due_at", { ascending: true }),
      sb.from("project_rules").select("key, label, suggestion, channel, followup_days, followup_reason"),
      sb.from("app_config").select("value").eq("key", "projects_bundle_after_days").maybeSingle(),
    ]);
    must(cards); must(fus); must(rules);
    const ids = [...new Set([...(cards.data || []), ...(fus.data || [])].map((r: any) => Number(r.hero_id)))];
    const projects = await loadProjects(sb, ids);
    const ruleBy = new Map<string, any>((rules.data || []).map((r: any) => [r.key, r]));
    const card = (c: any) => {
      const p = projects.get(Number(c.hero_id));
      const r = ruleBy.get(c.rule_key);
      return p && canSee(user, p)
        ? { id: c.id, ruleKey: c.rule_key, ruleLabel: r?.label ?? c.rule_key, suggestion: r?.suggestion ?? "", channel: r?.channel ?? "api", followupDays: r?.followup_days ?? null, followupReason: r?.followup_reason ?? "", category: c.category, reasons: c.reasons, project: projectView(p, now) }
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
    const docs = normalizeDocuments(p.documents).filter((d) => d.type !== "invoice");
    const events: { at: string; text: string }[] = [];
    if (p.step_since) events.push({ at: p.step_since, text: `Status „${p.step_name.replace(/^[^\p{L}\p{N}]+/u, "")}“ gesetzt` });
    for (const d of docs) if (d.created) events.push({ at: d.created, text: `${DOC_LABEL[d.type] ?? "Dokument"} ${d.nr} – ${d.status}` });
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

  // ------------------------------------------------------------------ Einstellungen (nur Admin)
  async settings({ sb }) {
    const [steps, rules, cfg] = await Promise.all([
      sb.from("project_step_settings").select("*").order("closeness", { ascending: true }),
      sb.from("project_rules").select("*").order("sort", { ascending: true }),
      sb.from("app_config").select("key, value").in("key", ["projects_bundle_after_days", "projects_write_enabled"]),
    ]);
    must(steps); must(rules);
    const c = new Map((cfg.data || []).map((r: any) => [r.key, r.value]));
    return { steps: steps.data, rules: rules.data, bundleAfterDays: Number(c.get("projects_bundle_after_days")) || 60, writeEnabled: c.get("projects_write_enabled") === "true" };
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
  async save_bundle_days({ sb, body }) {
    const n = Math.round(Number(body.days));
    if (!(n >= 7 && n <= 730)) throw new Error("Aufräum-Schwelle: 7 bis 730 Tage.");
    must(await sb.from("app_config").upsert({ key: "projects_bundle_after_days", value: String(n) }, { onConflict: "key" }));
    return { ok: true };
  },
};

/** Nur Admins. */
const ADMIN_ONLY = new Set(["settings", "save_step", "save_rule", "save_bundle_days"]);

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
