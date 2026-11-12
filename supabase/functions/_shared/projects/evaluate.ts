// project-evaluate: Regeln anwenden, Karten anlegen/aktualisieren/schliessen, faellige Wiedervorlagen wecken.
// Rein lesend gegenueber HERO (nur eigene Tabellen).

import { evaluateProject, outsideTarget, priorityOf, type EvalContext, type ProjectRow, type RuleRow, type Signal, type StepSetting } from "./rules.ts";

const LIVE = ["open", "in_hero", "snoozed", "muted", "auto"];
const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export interface EvalStats {
  projects: number; created: number; updated: number; closed: number; woken: number; bundled: number; orphans: number; cards: number;
}

function must<T extends { error: any }>(r: T, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r;
}

export async function evaluateAll(sb: any, now = new Date()): Promise<EvalStats> {
  const [projects, steps, rules, cards, followups, mutes, cfg] = await Promise.all([
    sb.from("hero_projects").select("hero_id, project_nr, name, step_id, step_name, step_key, step_since, hero_created, documents"),
    sb.from("project_step_settings").select("*"),
    sb.from("project_rules").select("*"),
    sb.from("project_cards").select("id, hero_id, rule_key, state, reasons, priority, bundled, category").in("state", LIVE),
    sb.from("followups").select("id, hero_id, due_at, reason").eq("target_type", "project").is("done_at", null),
    sb.from("project_rule_mutes").select("hero_id, rule_key, until").gt("until", now.toISOString()),
    sb.from("app_config").select("value").eq("key", "projects_bundle_after_days").maybeSingle(),
  ]);
  for (const [r, w] of [[projects, "hero_projects"], [steps, "project_step_settings"], [rules, "project_rules"], [cards, "project_cards"], [followups, "followups"], [mutes, "project_rule_mutes"]] as const) must(r as any, w);

  const ctx: EvalContext = {
    now,
    bundleAfterDays: Number(cfg.data?.value) > 0 ? Number(cfg.data.value) : 60,
    rules: new Map((rules.data as RuleRow[]).map((r) => [r.key, r])),
    steps: new Map((steps.data as StepSetting[]).map((s) => [Number(s.step_id), s])),
  };
  const projList = (projects.data || []) as ProjectRow[];
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
  const mutedFor = (heroId: number, ruleKey: string) =>
    (mutes.data || []).some((m: any) => Number(m.hero_id) === heroId && (m.rule_key === ruleKey || m.rule_key === "*"));

  const dueFollowupIds: string[] = [];
  const covered = new Set<number>(); // hat Karte, Wiedervorlage oder Stummschaltung

  for (const p of projList) {
    const id = Number(p.hero_id);
    const signal: Signal | null = evaluateProject(p, ctx);
    const card = liveByHero.get(id);
    const fus = openFollowups.get(id) || [];
    const due = fus.filter((f) => Date.parse(f.due_at) <= now.getTime());
    const future = fus.filter((f) => Date.parse(f.due_at) > now.getTime());

    // 2. Faellige Wiedervorlage weckt die Karte (auch wenn gerade kein Signal besteht).
    if (due.length) {
      due.forEach((f) => dueFollowupIds.push(f.id));
      stats.woken++;
      const why = due.map((f) => f.reason).filter(Boolean).join("; ");
      const text = `Wiedervorlage fällig${why ? `: ${why}` : ""}.`;
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
      if (!signal) {
        if (card.reasons?.manual) continue; // durch Wiedervorlage geweckt: bleibt bis jemand sie bearbeitet
        toClose.push({ id: card.id, reason: "Signal erledigt" });
        covered.delete(id);
        continue;
      }
      const reasons = { ...signal.reasons };
      if (card.rule_key !== signal.ruleKey || Number(card.priority) !== signal.priority || card.bundled !== signal.bundled
        || JSON.stringify(card.reasons) !== JSON.stringify(reasons)) {
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
  return stats;
}
