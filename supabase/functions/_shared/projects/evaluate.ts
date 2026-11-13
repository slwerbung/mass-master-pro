// project-evaluate: Regeln anwenden, Karten anlegen/aktualisieren/schliessen, faellige Wiedervorlagen wecken.
// Rein lesend gegenueber HERO (nur eigene Tabellen).

import { maintainFollowups } from "./followupChain.ts";
import { evaluateProject, outsideTarget, priorityOf, type EvalContext, type OpenMail, type ProjectRow, type RuleRow, type Signal, type StepSetting } from "./rules.ts";

const LIVE = ["open", "in_hero", "snoozed", "muted", "auto"];
const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const DAY = 86_400_000;
/** Kundenmails, die eine Karte brauchen (wie die Morgenuebersicht der Mail-App). */
const CUSTOMER_CATEGORIES = ["anfrage_neu", "projekt_kommunikation", "layout_freigabe", "auftrag", "reklamation"];
/** Keine Kundenpost: Werbung, Systemmails, Belege wecken keine Wiedervorlage. */
const NOT_CUSTOMER = ["werbung_spam", "system", "beleg"];
/**
 * HERO schreibt Zeiten als Ortszeit mit „+00:00“ (bis zu 2 Stunden „zu spaet“). Ein Statuswechsel zaehlt deshalb erst, wenn er
 * mehr als diese Zeit NACH dem Anlegen der Wiedervorlage liegt – sonst wuerde jede frische Wiedervorlage sofort wieder wecken.
 */
export const STEP_WAKE_MARGIN_MS = 3 * 3_600_000;

export interface EvalStats {
  projects: number; created: number; updated: number; closed: number; woken: number; bundled: number; orphans: number; cards: number;
  drafts?: number; stoppedDrafts?: number; replies?: number;
}

/** JSON mit sortierten Schluesseln: jsonb liefert die Schluessel in anderer Reihenfolge zurueck, als wir sie schreiben. */
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : val));

function must<T extends { error: any }>(r: T, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r;
}

/** Aelteste unbeantwortete Kundenmail je Projekt: eingehend, Kundenkategorie, Thema nicht von Hand erledigt, noch keine Antwort. */
export async function loadOpenMails(sb: any, now: Date): Promise<Map<number, OpenMail>> {
  const m = await sb.from("email_messages").select("id, thread_id, subject, sent_at, hero_project_match_id, category")
    .eq("direction", "in").not("hero_project_match_id", "is", null).is("trashed_at", null).gt("sent_at", new Date(now.getTime() - 120 * DAY).toISOString()).order("sent_at", { ascending: true });
  must(m, "email_messages");
  const msgs = (m.data || []).filter((x: any) => x.sent_at && CUSTOMER_CATEGORIES.includes(String(x.category)));
  const open = new Set<string>();
  const threadIds = [...new Set<string>(msgs.map((x: any) => x.thread_id).filter(Boolean))];
  for (const part of chunk(threadIds, 100)) {
    const t = await sb.from("email_threads").select("id, answered, topic_state").in("id", part);
    must(t, "email_threads");
    for (const th of t.data || []) if (th.answered === false && th.topic_state !== "erledigt") open.add(th.id);
  }
  const out = new Map<number, OpenMail>();
  for (const x of msgs) {
    if (!open.has(x.thread_id)) continue;
    const id = Number(x.hero_project_match_id);
    const cur = out.get(id);
    if (!cur || Date.parse(x.sent_at) < Date.parse(cur.sentAt)) out.set(id, { id: x.id, subject: String(x.subject || "(ohne Betreff)").slice(0, 120), sentAt: x.sent_at }); // die aelteste gewinnt
  }
  return out;
}

/** Eingehende Kundenpost je Projekt seit einem Zeitpunkt (fuer das Wecken von Wiedervorlagen). */
async function loadIncomingSince(sb: any, heroIds: number[], sinceIso: string): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  for (const part of chunk(heroIds, 100)) {
    const r = await sb.from("email_messages").select("hero_project_match_id, sent_at, category").eq("direction", "in").in("hero_project_match_id", part).is("trashed_at", null).gt("sent_at", sinceIso);
    must(r, "email_messages");
    for (const x of r.data || []) {
      if (!x.sent_at || NOT_CUSTOMER.includes(String(x.category))) continue;
      const id = Number(x.hero_project_match_id);
      (out.get(id) || out.set(id, []).get(id)!).push(x.sent_at);
    }
  }
  return out;
}

/** Warum eine noch nicht faellige Wiedervorlage jetzt zurueckkommt: neue Kundenmail oder Statuswechsel in HERO. */
export function wakeTrigger(f: { created_at?: string }, p: { step_since: string | null }, mails: string[] | undefined): string | null {
  const created = Date.parse(f.created_at ?? "");
  if (Number.isNaN(created)) return null;
  if ((mails || []).some((s) => Date.parse(s) > created)) return "Kunde hat geschrieben";
  if (p.step_since && Date.parse(p.step_since) - STEP_WAKE_MARGIN_MS > created) return "Status in HERO geändert";
  return null;
}

export async function evaluateAll(sb: any, now = new Date()): Promise<EvalStats> {
  const [projects, steps, rules, cards, followups, mutes, cfg, sentMails] = await Promise.all([
    sb.from("hero_projects").select("hero_id, project_nr, name, step_id, step_name, step_key, step_since, hero_created, documents"),
    sb.from("project_step_settings").select("*"),
    sb.from("project_rules").select("*"),
    sb.from("project_cards").select("id, hero_id, rule_key, state, reasons, priority, bundled, category").in("state", LIVE),
    sb.from("followups").select("id, hero_id, due_at, reason, created_at").eq("target_type", "project").is("done_at", null),
    sb.from("project_rule_mutes").select("hero_id, rule_key, until").gt("until", now.toISOString()),
    sb.from("app_config").select("value").eq("key", "projects_bundle_after_days").maybeSingle(),
    sb.from("project_followup_mails").select("hero_id, rule_key, stage, sent_at").eq("state", "sent"),
  ]);
  for (const [r, w] of [[projects, "hero_projects"], [steps, "project_step_settings"], [rules, "project_rules"], [cards, "project_cards"], [followups, "followups"], [mutes, "project_rule_mutes"], [sentMails, "project_followup_mails"]] as const) must(r as any, w);

  const ctx: EvalContext = {
    now,
    bundleAfterDays: Number(cfg.data?.value) > 0 ? Number(cfg.data.value) : 60,
    rules: new Map((rules.data as RuleRow[]).map((r) => [r.key, r])),
    steps: new Map((steps.data as StepSetting[]).map((s) => [Number(s.step_id), s])),
  };
  const sentBy = new Map<number, { rule_key: string; stage: number; sent_at: string }[]>();
  for (const m of sentMails.data || []) (sentBy.get(Number(m.hero_id)) || sentBy.set(Number(m.hero_id), []).get(Number(m.hero_id))!).push({ rule_key: m.rule_key, stage: Number(m.stage), sent_at: m.sent_at });
  const openMailBy = await loadOpenMails(sb, now);
  const projList = ((projects.data || []) as ProjectRow[]).map((p) => ({ ...p, followups: sentBy.get(Number(p.hero_id)) ?? [], openMail: openMailBy.get(Number(p.hero_id)) ?? null }));
  const byId = new Map(projList.map((p) => [Number(p.hero_id), p]));
  const stats: EvalStats = { projects: projList.length, created: 0, updated: 0, closed: 0, woken: 0, bundled: 0, orphans: 0, cards: 0 };
  const iso = now.toISOString();

  const liveByHero = new Map<number, any>((cards.data || []).map((c: any) => [Number(c.hero_id), c]));
  const toClose: { id: string; reason: string }[] = [];
  const toUpdate: { id: string; patch: Record<string, unknown> }[] = [];
  const toInsert: Record<string, unknown>[] = [];

  // 1. Projekte, die nicht mehr offen sind: Karten schliessen, Wiedervorlagen erledigen.
  for (const c of liveByHero.values()) {
    if (!byId.has(Number(c.hero_id))) { toClose.push({ id: c.id, reason: "Projekt nicht mehr offen" }); liveByHero.delete(Number(c.hero_id)); }
  }
  const openFollowups = new Map<number, any[]>();
  for (const f of followups.data || []) {
    if (!byId.has(Number(f.hero_id))) continue;
    (openFollowups.get(Number(f.hero_id)) || openFollowups.set(Number(f.hero_id), []).get(Number(f.hero_id))!).push(f);
  }
  // Phase 5: Wiedervorlagen, die noch nicht faellig sind, kommen vorzeitig zurueck, wenn der Kunde schreibt oder der Status wechselt.
  const futureHeroes = [...openFollowups.entries()].filter(([, fs]) => fs.some((f) => Date.parse(f.due_at) > now.getTime())).map(([h]) => h);
  const minCreated = Math.min(...[...openFollowups.values()].flat().map((f) => Date.parse(f.created_at ?? "")).filter((t) => !Number.isNaN(t)));
  const incomingSince = futureHeroes.length && Number.isFinite(minCreated) ? await loadIncomingSince(sb, futureHeroes, new Date(minCreated).toISOString()) : new Map<number, string[]>();
  const mutedFor = (heroId: number, ruleKey: string) =>
    (mutes.data || []).some((m: any) => Number(m.hero_id) === heroId && (m.rule_key === ruleKey || m.rule_key === "*"));

  const dueFollowupIds: string[] = [];
  const covered = new Set<number>(); // hat Karte, Wiedervorlage oder Stummschaltung

  for (const p of projList) {
    const id = Number(p.hero_id);
    const signal: Signal | null = evaluateProject(p, ctx);
    const card = liveByHero.get(id);
    const fus = openFollowups.get(id) || [];
    const early = new Map<string, string>();
    for (const f of fus) if (Date.parse(f.due_at) > now.getTime()) { const why = wakeTrigger(f, p, incomingSince.get(id)); if (why) early.set(f.id, why); }
    const due = fus.filter((f) => Date.parse(f.due_at) <= now.getTime() || early.has(f.id));
    const future = fus.filter((f) => !due.includes(f));

    // 2. Faellige Wiedervorlage weckt die Karte (auch wenn gerade kein Signal besteht).
    if (due.length) {
      due.forEach((f) => dueFollowupIds.push(f.id));
      stats.woken++;
      const why = due.map((f) => early.get(f.id) ?? f.reason).filter(Boolean).join("; ");
      const text = early.size === due.length ? `Wiedervorlage vorgezogen: ${why}.` : `Wiedervorlage fällig${why ? `: ${why}` : ""}.`;
      if (card && card.state === "snoozed") {
        toUpdate.push({ id: card.id, patch: { state: "open", reasons: { ...(signal?.reasons ?? { text, days: 0, stepName: "" }), text: signal ? `${text} ${signal.reasons.text}` : text, manual: !signal }, ...(signal ? { rule_key: signal.ruleKey, category: signal.category, priority: signal.priority, bundled: signal.bundled } : {}) } });
        covered.add(id);
        continue;
      }
      if (!card) {
        const s = signal;
        const ruleKey = s?.ruleKey ?? "waise";
        const rule = ctx.rules.get(ruleKey);
        toInsert.push({
          hero_id: id, rule_key: ruleKey, category: s?.category ?? rule?.category ?? "pflege", state: "open",
          priority: s?.priority ?? priorityOf(rule?.category ?? "pflege", 0, 0), bundled: false,
          reasons: { ...(s?.reasons ?? { days: 0, stepName: "" }), text: s ? `${text} ${s.reasons.text}` : text, manual: !s },
        });
        covered.add(id);
        continue;
      }
    }

    if (card) {
      covered.add(id);
      if (card.state === "snoozed" && fus.length === 0) {
        // Wiedervorlage ist weg (z. B. von Hand erledigt): Karte wieder in den Stapel.
        toUpdate.push({ id: card.id, patch: { state: "open", reasons: { ...(signal?.reasons ?? { days: 0, stepName: "" }), text: signal?.reasons.text ?? "Wiedervorlage beendet.", manual: !signal } } });
        continue;
      }
      if (card.state !== "open") continue; // snoozed / in_hero / muted / auto: nicht anfassen
      if (card.rule_key === "kunde_antwort") continue; // „Kunde hat geantwortet“ bleibt, bis ein Mensch sie bearbeitet
      if (!signal) {
        if (card.reasons?.manual) continue; // durch Wiedervorlage geweckt: bleibt bis jemand sie bearbeitet
        toClose.push({ id: card.id, reason: "Signal erledigt" });
        covered.delete(id);
        continue;
      }
      const reasons = { ...signal.reasons };
      if (card.rule_key !== signal.ruleKey || Number(card.priority) !== signal.priority || card.bundled !== signal.bundled
        || canon(card.reasons) !== canon(reasons)) {
        toUpdate.push({ id: card.id, patch: { rule_key: signal.ruleKey, category: signal.category, priority: signal.priority, bundled: signal.bundled, reasons } });
      }
      continue;
    }

    // Keine Karte: Wiedervorlage in der Zukunft oder Stummschaltung = keine neue Karte.
    if (future.length) { covered.add(id); continue; }
    if (signal && mutedFor(id, signal.ruleKey)) { covered.add(id); continue; }
    if (!signal && mutedFor(id, "*")) { covered.add(id); continue; }
    if (signal) {
      toInsert.push({ hero_id: id, rule_key: signal.ruleKey, category: signal.category, state: "open", priority: signal.priority, bundled: signal.bundled, reasons: signal.reasons });
      covered.add(id);
    }
  }

  // Waisen-Check: ausserhalb der Sollzeit, aber weder Karte noch Wiedervorlage noch Stummschaltung.
  for (const p of projList) {
    const id = Number(p.hero_id);
    if (!covered.has(id) && outsideTarget(p, ctx)) stats.orphans++;
  }

  // Schreiben.
  for (const part of chunk(toInsert, 200)) must(await sb.from("project_cards").insert(part), "project_cards anlegen");
  stats.created = toInsert.length;
  for (const part of chunk(toUpdate, 20)) {
    await Promise.all(part.map(async (u) => must(await sb.from("project_cards").update(u.patch).eq("id", u.id), "project_cards ändern")));
  }
  stats.updated = toUpdate.length;
  for (const part of chunk(toClose, 20)) {
    await Promise.all(part.map(async (u) => must(await sb.from("project_cards").update({ state: "done", closed_at: iso, close_reason: u.reason }).eq("id", u.id), "project_cards schließen")));
  }
  stats.closed = toClose.length;
  for (const part of chunk(dueFollowupIds, 100)) must(await sb.from("followups").update({ done_at: iso }).in("id", part), "followups erledigen");
  // Wiedervorlagen verschwundener Projekte aufraeumen.
  const goneFus = (followups.data || []).filter((f: any) => !byId.has(Number(f.hero_id))).map((f: any) => f.id);
  for (const part of chunk(goneFus, 100)) must(await sb.from("followups").update({ done_at: iso }).in("id", part), "followups aufräumen");

  const { count } = await sb.from("project_cards").select("id", { count: "exact", head: true }).in("state", LIVE);
  stats.cards = count ?? 0;
  const { count: b } = await sb.from("project_cards").select("id", { count: "exact", head: true }).eq("state", "open").eq("bundled", true);
  stats.bundled = b ?? 0;

  // Nachfass-Kette: Kundenantworten, Entwuerfe (rein lokal).
  const chain = await maintainFollowups(sb, now);
  stats.drafts = chain.drafts; stats.stoppedDrafts = chain.stopped; stats.replies = chain.replies;
  return stats;
}
