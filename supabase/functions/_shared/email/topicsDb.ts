// Themen aus der Datenbank lesen und entscheiden (Logik in topics.ts). Nur service_role.

import { getConfig } from "./config.ts";
import { berlinToIso, berlinToday } from "./instruct.ts";
import {
  isCustomerCategory, isRelevant, normalizeTopicConfig, reasonText, topicStatus, validSnoozeDate,
  type TopicConfig, type TopicFacts, type TopicStatus,
} from "./topics.ts";
import type { TopicDecision, TopicReason, TopicState } from "./types.ts";

export interface TopicMail {
  id: string; direction: "in" | "out"; from_name: string; from_addr: string; subject: string; sent_at: string | null;
  summary: string | null; category: string | null; has_attachments: boolean; decided_at: string | null;
}

export interface Topic {
  id: string;
  subject: string;
  state: TopicState;
  due: boolean;
  reason: TopicReason | null;
  reasonText: string;
  nextCheck: string | null;
  snoozedUntil: string | null;
  note: string | null;
  closedAt: string | null;
  projectId: number | null;
  lastActivity: string | null;
  /** Gegenueber: Absender der juengsten eingehenden Mail */
  from: string;
  /** juengste Mail im Thema (Link) */
  latestId: string;
  /** Kurzfassung der juengsten Mail (fuer Themen ohne neue Mail: woran haengt es?) */
  lastMail: { direction: "in" | "out"; from: string; sent_at: string | null; summary: string | null } | null;
  messageCount: number;
  /** relevante eingehende Mails ohne Entscheidung (die werden vorgelegt) */
  newMessages: TopicMail[];
  suggestionIds: string[];
}

export type TopicView = "entscheiden" | "laufend" | "wiedervorlage" | "erledigt";

const MSG_COLS = "id, thread_id, direction, from_name, from_addr, subject, sent_at, created_at, summary, category, status, beleg_state, has_attachments, decided_at, hero_project_match_id";
const CHUNK = 80;

function must<T>(r: { data: T; error: any }): T {
  if (r.error) throw new Error(r.error.message || String(r.error));
  return r.data;
}

const chunks = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

export async function loadTopicConfig(sb: any): Promise<TopicConfig> {
  return normalizeTopicConfig(await getConfig<unknown>(sb, "topics", {}));
}

/** Kategorie-Filter (PostgREST) fuer „koennte relevant sein“: ausgeschlossene Kategorien raus, unverarbeitete bleiben drin. */
const categoryFilter = (cfg: TopicConfig) =>
  cfg.skip_categories.length ? `category.is.null,category.not.in.(${cfg.skip_categories.join(",")})` : "category.is.null,category.not.is.null";

/** Offene Vorschlaege je Thema. */
async function openSuggestions(sb: any): Promise<Map<string, string[]>> {
  const rows = must(await sb.from("email_suggestions").select("id, email_messages!inner(thread_id)")
    .in("status", ["offen", "fehlgeschlagen"]).limit(500)) as any[];
  const out = new Map<string, string[]>();
  for (const r of rows || []) {
    const th = r.email_messages?.thread_id;
    if (th) (out.get(th) ?? out.set(th, []).get(th)!).push(r.id);
  }
  return out;
}

/** Themen zu den Thread-IDs aufbauen (Mails, Fakten, Status). Threads ohne relevante Mail und ohne Vorschlag fallen raus. */
async function buildTopics(sb: any, threadIds: string[], cfg: TopicConfig, sugg: Map<string, string[]>, now: Date): Promise<{ topics: Topic[]; irrelevant: string[] }> {
  const threads: any[] = [];
  const msgs: any[] = [];
  for (const ids of chunks(threadIds)) {
    const [th, ms] = await Promise.all([
      sb.from("email_threads").select("id, subject_norm, topic_state, snoozed_until, topic_note, reviewed_at, closed_at, hero_project_match_id, last_activity_at").in("id", ids),
      sb.from("email_messages").select(MSG_COLS).in("thread_id", ids).is("trashed_at", null).order("sent_at", { ascending: true, nullsFirst: true }).limit(2000),
    ]);
    threads.push(...must(th) as any[]);
    msgs.push(...must(ms) as any[]);
  }
  const byThread = new Map<string, any[]>();
  for (const m of msgs) (byThread.get(m.thread_id) ?? byThread.set(m.thread_id, []).get(m.thread_id)!).push(m);

  const topics: Topic[] = [];
  const irrelevant: string[] = [];
  for (const th of threads) {
    const all = byThread.get(th.id) ?? [];
    const rel = all.filter((m) => isRelevant(m, cfg));
    const sIds = sugg.get(th.id) ?? [];
    if (!rel.length && !sIds.length) { irrelevant.push(th.id); continue; }
    const when = (m: any) => m.sent_at ?? m.created_at ?? null;
    const lastOf = (xs: any[]) => xs.reduce<string | null>((a, m) => (when(m) && (!a || when(m) > a) ? when(m) : a), null);
    const outs = all.filter((m) => m.direction === "out");
    const undecided = rel.filter((m) => !m.decided_at);
    const facts: TopicFacts = {
      state: th.topic_state, snoozedUntil: th.snoozed_until, reviewedAt: th.reviewed_at,
      lastIn: lastOf(rel), lastOut: lastOf(outs), undecided: undecided.length, hadDecided: rel.some((m) => !!m.decided_at),
      openSuggestions: sIds.length, customer: rel.some((m) => isCustomerCategory(m.category)),
    };
    const st: TopicStatus = topicStatus(facts, cfg, now);
    const latest = all[all.length - 1] ?? rel[rel.length - 1];
    const lastInMail = [...rel].reverse()[0] ?? all.find((m) => m.direction === "in");
    topics.push({
      id: th.id,
      subject: (lastInMail ?? latest)?.subject || th.subject_norm || "(ohne Betreff)",
      state: th.topic_state, due: st.due, reason: st.reason, reasonText: reasonText(st, th.topic_note),
      nextCheck: st.nextCheck, snoozedUntil: th.snoozed_until, note: th.topic_note, closedAt: th.closed_at,
      projectId: th.hero_project_match_id ?? [...all].reverse().find((m) => m.hero_project_match_id)?.hero_project_match_id ?? null,
      lastActivity: lastOf(all),
      from: lastInMail ? (lastInMail.from_name || lastInMail.from_addr) : "",
      latestId: latest?.id ?? "",
      lastMail: latest ? { direction: latest.direction, from: latest.from_name || latest.from_addr, sent_at: latest.sent_at, summary: latest.summary ?? latest.subject ?? null } : null,
      messageCount: all.length,
      newMessages: undecided.map((m) => ({
        id: m.id, direction: m.direction, from_name: m.from_name, from_addr: m.from_addr, subject: m.subject, sent_at: m.sent_at,
        summary: m.summary, category: m.category, has_attachments: m.has_attachments, decided_at: m.decided_at,
      })),
      suggestionIds: sIds,
    });
  }
  return { topics, irrelevant };
}

/** Alle nicht abgeschlossenen Themen + abgeschlossene mit neuer Mail. Raeumt Threads ohne relevante Mail ab (abgeschlossen). */
async function currentTopics(sb: any, cfg: TopicConfig, now: Date): Promise<Topic[]> {
  const [open, undecided, sugg] = await Promise.all([
    sb.from("email_threads").select("id, last_activity_at").neq("topic_state", "erledigt").limit(3000),
    sb.from("email_messages").select("thread_id").eq("direction", "in").is("decided_at", null).is("trashed_at", null)
      .not("thread_id", "is", null).or(categoryFilter(cfg)).limit(3000),
    openSuggestions(sb),
  ]);
  const openRows = must(open) as any[];
  const ids = new Set<string>([
    ...openRows.map((r) => r.id),
    ...(must(undecided) as any[]).map((r) => r.thread_id),
    ...sugg.keys(),
  ]);
  const { topics, irrelevant } = await buildTopics(sb, [...ids], cfg, sugg, now);

  // Aufraeumen: Werbung, Newsletter, nur ausgehende Mails – nach einem Tag ohne Bewegung abgeschlossen (ohne closed_at:
  // erscheint nicht unter „Abgeschlossen“). Wird eine Mail spaeter umsortiert, legt sie sich als neue Mail wieder vor.
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const lastAct = new Map(openRows.map((r) => [r.id, r.last_activity_at as string | null]));
  const stale = irrelevant.filter((id) => lastAct.has(id) && (lastAct.get(id) ?? "") < dayAgo);
  for (const c of chunks(stale)) await sb.from("email_threads").update({ topic_state: "erledigt" }).in("id", c).neq("topic_state", "erledigt");
  return topics;
}

const byActivityDesc = (a: Topic, b: Topic) => String(b.lastActivity ?? "").localeCompare(String(a.lastActivity ?? ""));

export async function listTopics(sb: any, view: TopicView, now = new Date()): Promise<Topic[]> {
  const cfg = await loadTopicConfig(sb);
  if (view === "erledigt") {
    const rows = must(await sb.from("email_threads").select("id").eq("topic_state", "erledigt").not("closed_at", "is", null)
      .order("closed_at", { ascending: false }).limit(150)) as any[];
    const { topics } = await buildTopics(sb, rows.map((r) => r.id), cfg, new Map(), now);
    return topics.filter((x) => !x.due).sort((a, b) => String(b.closedAt ?? "").localeCompare(String(a.closedAt ?? ""))).slice(0, 100);
  }
  const all = await currentTopics(sb, cfg, now);
  if (view === "entscheiden") return all.filter((x) => x.due).sort(byActivityDesc);
  if (view === "wiedervorlage") {
    return all.filter((x) => !x.due && x.state === "wiedervorlage").sort((a, b) => String(a.snoozedUntil).localeCompare(String(b.snoozedUntil)));
  }
  return all.filter((x) => !x.due && x.state === "aktiv").sort((a, b) => String(a.nextCheck ?? "").localeCompare(String(b.nextCheck ?? "")));
}

export async function topicCounts(sb: any, now = new Date()): Promise<{ entscheiden: number; laufend: number; wiedervorlage: number }> {
  const all = await currentTopics(sb, await loadTopicConfig(sb), now);
  return {
    entscheiden: all.filter((x) => x.due).length,
    laufend: all.filter((x) => !x.due && x.state === "aktiv").length,
    wiedervorlage: all.filter((x) => !x.due && x.state === "wiedervorlage").length,
  };
}

/** Thema einer einzelnen Mail (Detailansicht). null, wenn die Mail zu keinem Thema gehoert. */
export async function topicOfThread(sb: any, threadId: string | null, now = new Date()): Promise<Topic | null> {
  if (!threadId) return null;
  const cfg = await loadTopicConfig(sb);
  const sugg = await openSuggestions(sb);
  const { topics } = await buildTopics(sb, [threadId], cfg, new Map([[threadId, sugg.get(threadId) ?? []]]), now);
  return topics[0] ?? null;
}

export interface TopicDecisionInput {
  decision: TopicDecision;
  /** Wiedervorlage: Datum YYYY-MM-DD (Berlin) */
  until?: string | null;
  note?: string | null;
  /** nur diese Mails als entschieden markieren (die gezeigten); sonst alle offenen des Themas */
  messageIds?: string[] | null;
  /** Wofuer die Mails entschieden wurden (Protokoll), Standard = decision */
  label?: string;
}

const DECISION_LABEL: Record<TopicDecision, string> = {
  weiter: "weiter verfolgen", wiedervorlage: "wiedervorlage", erledigt: "abgeschlossen", oeffnen: "wieder geoeffnet",
};

/**
 * Thema entscheiden. „weiter“ und „erledigt“ verwerfen offen gebliebene Vorschlaege des Themas (es passiert dabei nichts
 * in HERO/Postfach); bei der Wiedervorlage bleiben sie und kommen mit dem Thema wieder.
 */
export async function decideTopic(sb: any, threadId: string, d: TopicDecisionInput, now = new Date()): Promise<{ state: TopicState; snoozedUntil: string | null }> {
  if (!threadId) throw new Error("Thema fehlt.");
  const { data: th } = await sb.from("email_threads").select("id, topic_state").eq("id", threadId).maybeSingle();
  if (!th) throw new Error("Thema nicht gefunden.");
  const nowIso = now.toISOString();
  let snoozedUntil: string | null = null;
  if (d.decision === "wiedervorlage") {
    const date = validSnoozeDate(d.until, berlinToday(now));
    if (!date) throw new Error("Wiedervorlage: Datum ab morgen angeben (höchstens zwei Jahre).");
    snoozedUntil = berlinToIso(date, "06:00");
  }

  // 1. vorgelegte Mails entscheiden
  let q = sb.from("email_messages").update({ decided_at: nowIso, decision: d.label ?? DECISION_LABEL[d.decision] })
    .eq("thread_id", threadId).eq("direction", "in").is("decided_at", null);
  if (d.messageIds?.length && d.decision !== "erledigt") q = q.in("id", d.messageIds.slice(0, 200));
  must(await q);

  // 2. offen gebliebene Vorschlaege
  if (d.decision === "weiter" || d.decision === "erledigt") {
    const ids = (must(await sb.from("email_messages").select("id").eq("thread_id", threadId)) as any[]).map((r) => r.id);
    for (const c of chunks(ids)) {
      must(await sb.from("email_suggestions")
        .update({ status: "abgelehnt", decided_at: nowIso, result: { reason: d.decision === "erledigt" ? "Thema abgeschlossen" : "Thema weiter verfolgt ohne diesen Vorschlag" } })
        .in("message_id", c).in("status", ["offen", "fehlgeschlagen"]));
    }
  }

  // 3. Thema
  const note = d.note == null ? null : String(d.note).trim().slice(0, 300) || null;
  const patch: Record<string, unknown> = { reviewed_at: nowIso };
  if (d.decision === "erledigt") Object.assign(patch, { topic_state: "erledigt", closed_at: nowIso, snoozed_until: null, topic_note: note });
  else if (d.decision === "wiedervorlage") Object.assign(patch, { topic_state: "wiedervorlage", snoozed_until: snoozedUntil, closed_at: null, topic_note: note });
  else Object.assign(patch, { topic_state: "aktiv", snoozed_until: null, closed_at: null, topic_note: note });
  must(await sb.from("email_threads").update(patch).eq("id", threadId));
  return { state: patch.topic_state as TopicState, snoozedUntil };
}
