// Nachfass-Kette pflegen (laeuft am Ende jeder Auswertung, rein lokal – nichts nach HERO, keine Mail):
//  1. Antwortet der Kunde (eingehende Mail, die die Mail-App dem Projekt zuordnet), stoppt die Kette: offene Entwuerfe
//     werden „stopped“, die Karte wird zu „Kunde hat geantwortet“.
//  2. Fuer Karten mit Mailweg (Autopilot „suggest“ oder „auto“) liegt ein Entwurf bereit; ueberholte Entwuerfe werden beendet.

import { confirmations as _c, latest, normalizeDocuments, sentOffers } from "./docs.ts";
import { effectiveAutopilot, fmtDateDe, pickRecipient, renderTemplate } from "./followup.ts";
import { priorityOf } from "./rules.ts";

void _c;
const LIVE = ["open", "in_hero", "snoozed", "muted", "auto"];
const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const DAY = 86_400_000;

export interface ChainStats { drafts: number; stopped: number; replies: number; noRecipient: number }

function must<T extends { error: any }>(r: T, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r;
}

/** Eingehende Mails je Projekt (neueste zuerst). */
async function incomingByHero(sb: any, heroIds: number[]): Promise<Map<number, { from_addr: string; sent_at: string }[]>> {
  const out = new Map<number, { from_addr: string; sent_at: string }[]>();
  for (const part of chunk(heroIds, 100)) {
    const { data, error } = await sb.from("email_messages").select("hero_project_match_id, from_addr, sent_at")
      .eq("direction", "in").in("hero_project_match_id", part).is("trashed_at", null);
    must({ error }, "email_messages");
    for (const m of data || []) {
      if (!m.sent_at) continue;
      const id = Number(m.hero_project_match_id);
      (out.get(id) || out.set(id, []).get(id)!).push({ from_addr: String(m.from_addr || ""), sent_at: m.sent_at });
    }
  }
  for (const list of out.values()) list.sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at));
  return out;
}

export async function maintainFollowups(sb: any, now = new Date()): Promise<ChainStats> {
  const iso = now.toISOString();
  const stats: ChainStats = { drafts: 0, stopped: 0, replies: 0, noRecipient: 0 };

  const [rulesR, tplR, apR, accR] = await Promise.all([
    sb.from("project_rules").select("*"),
    sb.from("project_followup_templates").select("rule_key, stage, subject, body"),
    sb.from("project_autopilot").select("hero_id, rule_key, mode"),
    sb.from("email_accounts").select("address, username"),
  ]);
  must(rulesR, "project_rules"); must(tplR, "project_followup_templates"); must(apR, "project_autopilot");
  const rules = new Map<string, any>((rulesR.data || []).map((r: any) => [r.key, r]));
  const own = (accR.data || []).flatMap((a: any) => [a.address, a.username]).filter((x: string) => x && x.includes("@"));

  // ------------------------------------------------------------------ 1. Kunde hat geantwortet
  const sentR = await sb.from("project_followup_mails").select("id, hero_id, sent_at")
    .eq("state", "sent").is("reply_seen_at", null).gt("sent_at", new Date(now.getTime() - 90 * DAY).toISOString());
  must(sentR, "project_followup_mails");
  const lastSentByHero = new Map<number, number>();
  for (const r of sentR.data || []) {
    const t = Date.parse(r.sent_at);
    if (!Number.isNaN(t)) lastSentByHero.set(Number(r.hero_id), Math.max(lastSentByHero.get(Number(r.hero_id)) ?? 0, t));
  }
  if (lastSentByHero.size) {
    const incoming = await incomingByHero(sb, [...lastSentByHero.keys()]);
    const replied = new Map<number, string>(); // hero_id -> Zeitpunkt der Antwort
    for (const [hero, sentAt] of lastSentByHero) {
      const reply = (incoming.get(hero) || []).find((m) => Date.parse(m.sent_at) > sentAt);
      if (reply) replied.set(hero, reply.sent_at);
    }
    if (replied.size) {
      const ids = [...replied.keys()];
      const rule = rules.get("kunde_antwort");
      const [projR, cardR] = await Promise.all([
        sb.from("hero_projects").select("hero_id, step_name").in("hero_id", ids),
        sb.from("project_cards").select("id, hero_id, rule_key, state").in("hero_id", ids).in("state", LIVE),
      ]);
      const stepOf = new Map<number, string>((projR.data || []).map((p: any) => [Number(p.hero_id), String(p.step_name || "")]));
      const liveOf = new Map<number, any>((cardR.data || []).map((c: any) => [Number(c.hero_id), c]));
      for (const hero of ids) {
        stats.replies++;
        must(await sb.from("project_followup_mails").update({ reply_seen_at: iso }).eq("hero_id", hero).eq("state", "sent").is("reply_seen_at", null), "Antwort merken");
        must(await sb.from("project_followup_mails").update({ state: "stopped", stopped_reason: "Kunde hat geantwortet" }).eq("hero_id", hero).eq("state", "draft"), "Entwuerfe stoppen");
        if (!rule?.active || !stepOf.has(hero)) continue; // Projekt nicht (mehr) im Spiegel
        const reasons = { text: `Kunde hat am ${fmtDateDe(replied.get(hero))} geantwortet – die Nachfass-Kette ist gestoppt.`, days: 0, stepName: stepOf.get(hero), manual: true };
        const live = liveOf.get(hero);
        const patch = { rule_key: "kunde_antwort", category: "kunde", state: "open", bundled: false, priority: priorityOf("kunde", 0, 0), reasons };
        if (live && live.rule_key === "kunde_antwort") continue;
        if (live) must(await sb.from("project_cards").update(patch).eq("id", live.id), "Karte aktualisieren");
        else must(await sb.from("project_cards").insert({ hero_id: hero, ...patch }), "Karte anlegen");
      }
    }
  }

  // ------------------------------------------------------------------ 2. Entwuerfe
  const cardsR = await sb.from("project_cards").select("hero_id, rule_key").eq("state", "open").eq("bundled", false);
  must(cardsR, "project_cards");
  const override = new Map<string, string>((apR.data || []).map((a: any) => [`${a.hero_id}:${a.rule_key}`, a.mode]));
  const wanted = new Map<string, { hero: number; rule: string }>();
  for (const c of cardsR.data || []) {
    const rule = rules.get(c.rule_key);
    if (!rule?.active || rule.channel !== "mail") continue;
    if (effectiveAutopilot(rule.autopilot, override.get(`${c.hero_id}:${c.rule_key}`)) === "off") continue;
    wanted.set(`${c.hero_id}:${c.rule_key}`, { hero: Number(c.hero_id), rule: c.rule_key });
  }

  const draftsR = await sb.from("project_followup_mails").select("id, hero_id, rule_key, stage, state").in("state", ["draft", "sending"]);
  must(draftsR, "project_followup_mails");
  const have = new Set<string>();
  const stale: string[] = [];
  for (const d of draftsR.data || []) {
    const key = `${d.hero_id}:${d.rule_key}`;
    if (d.state === "draft" && !wanted.has(key)) stale.push(d.id);
    else have.add(key);
  }
  for (const part of chunk(stale, 100)) {
    must(await sb.from("project_followup_mails").update({ state: "stopped", stopped_reason: "Signal erledigt" }).in("id", part).eq("state", "draft"), "Entwuerfe beenden");
  }
  stats.stopped = stale.length;

  const todo = [...wanted.entries()].filter(([k]) => !have.has(k)).map(([, v]) => v);
  if (!todo.length) return stats;
  const templates = new Map<string, any>((tplR.data || []).filter((t: any) => Number(t.stage) === 1).map((t: any) => [t.rule_key, t]));
  const heroIds = [...new Set(todo.map((t) => t.hero))];
  const projects = new Map<number, any>();
  for (const part of chunk(heroIds, 100)) {
    const r = await sb.from("hero_projects").select("hero_id, name, kunde, kunde_email, documents").in("hero_id", part);
    must(r, "hero_projects");
    for (const p of r.data || []) projects.set(Number(p.hero_id), p);
  }
  const incoming = await incomingByHero(sb, heroIds);

  for (const t of todo) {
    const tpl = templates.get(t.rule);
    const p = projects.get(t.hero);
    if (!tpl || !p) continue;
    const to = pickRecipient(incoming.get(t.hero)?.[0]?.from_addr, p.kunde_email, own);
    if (!to) { stats.noRecipient++; continue; }
    const offer = latest(sentOffers(normalizeDocuments(p.documents)));
    const vars = { kunde: p.kunde || "", projekt: p.name || "", angebot_nr: offer?.nr || "", angebot_datum: fmtDateDe(offer?.created) };
    const { error } = await sb.from("project_followup_mails").insert({
      hero_id: t.hero, rule_key: t.rule, stage: 1, subject: renderTemplate(tpl.subject, vars), body: renderTemplate(tpl.body, vars), to_email: to, state: "draft",
    });
    if (error && error.code !== "23505") throw new Error(`Entwurf anlegen: ${error.message}`);
    if (!error) stats.drafts++;
  }
  return stats;
}
