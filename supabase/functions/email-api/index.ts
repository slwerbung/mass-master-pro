// Schnittstelle der Mail-App. Die Oberflaeche greift NUR hierueber zu: alle
// E-Mail-Tabellen sind nur fuer service_role lesbar. Jede Anfrage verlangt eine
// Supabase-Auth-Sitzung: Admin sieht alles, ein Mitarbeiter nur die ihm zugeordneten Postfaecher
// (access.ts); Einstellungen (ADMIN_ONLY) nur fuer Admins.
//
//   POST { action: "...", ...parameter }  ->  { ok: true, data } | { ok: false, error }

import { createClient } from "@supabase/supabase-js";
import { fail, ok, preflight, readJson, requireMailUser, type MailUser } from "../_shared/email/http.ts";
import { AccessError, assertAccount, assertMessages, assertThread, isMailAdmin, scopeAccounts } from "../_shared/email/access.ts";
import { listMailUsers, mailAudience, saveMailUser } from "../_shared/email/users.ts";
import { encryptSecret } from "../_shared/email/crypto.ts";
import { encryptionKey, getConfig, setConfig } from "../_shared/email/config.ts";
import { normalizeAutopilot } from "../_shared/email/autopilot.ts";
import { AI_TASKS, CATEGORIES, INBOX_CATEGORIES } from "../_shared/email/types.ts";
import * as H from "../_shared/email/hero.ts";
import { learnRule } from "../_shared/email/learn.ts";
import { mapDocumentTypes, mapSteps } from "../_shared/email/heroReload.ts";
import { matchesPattern } from "../_shared/email/mail.ts";
import { normalizeTopicConfig } from "../_shared/email/topics.ts";
import { decideTopic, listTopics, topicCounts, topicOfThread, type Topic, type TopicView, type Viewer } from "../_shared/email/topicsDb.ts";
import { KNOWLEDGE_TEXT_MAX, normalizePattern, patternForScope, type KnowledgeScope } from "../_shared/email/knowledge.ts";

// Nur diese Schluessel darf die Oberflaeche in email_config schreiben – der
// Admin-Zugang ist kein Generalschluessel fuer die Tabelle.
const CONFIG_KEYS = [
  "folders", "gewerke", "hero", "company_knowledge", "reply_rules", "lexoffice", "budget", "retention_days", "llm_prices", "topics",
] as const;

const MESSAGE_LIST_COLUMNS =
  "id, account_id, thread_id, direction, from_addr, from_name, subject, sent_at, status, category, confidence, summary, " +
  "hero_project_match_id, match_method, has_attachments, draft_message_id, current_folder, error, hero_logged_at, beleg_state, beleg_vendor, correction_note, trashed_at, answered_at, user_forwarded_at";

const BELEG_STATES = ["weiterleiten_offen", "weitergeleitet", "portal_offen", "portal_erledigt"];

/** Schnellansichten der Mail-Liste (Reiter oben); „alle" = keine Einschraenkung. */
const VIEWS: Record<string, (q: any) => any> = {
  kunden: (q) => q.eq("direction", "in").in("category", INBOX_CATEGORIES),
  ohne_projekt: (q) => q.eq("direction", "in").in("category", INBOX_CATEGORIES).is("hero_project_match_id", null),
  unsicher: (q) => q.eq("direction", "in").lt("confidence", 0.7),
  belege: (q) => q.eq("category", "beleg"),
  korrigiert: (q) => q.not("correction_note", "is", null),
  fehler: (q) => q.eq("status", "fehler"),
};

/** Einstellungen und Betrieb: nur fuer Admins (Mitarbeiter arbeiten nur mit den Mails ihrer Postfaecher). */
const ADMIN_ONLY = new Set([
  "list_knowledge", "save_knowledge", "delete_knowledge", "save_account", "list_rules", "save_rule", "delete_rule", "save_config",
  "list_ai", "save_provider", "save_ai_setting", "hero_reload", "hero_probe", "list_reference_docs", "save_reference_doc",
  "delete_reference_doc", "list_runs", "list_users", "save_user",
]);

/** Filter der Mail-Liste; `skipCategory` fuer die Zaehler je Kategorie. */
function applyMessageFilters(q: any, body: Record<string, any>, user: MailUser, opts: { skipCategory?: boolean } = {}) {
  q = scopeAccounts(q, user);
  // Papierkorb: eigene Ansicht, sonst immer ausgeblendet.
  if (body.view === "papierkorb") q = q.not("trashed_at", "is", null);
  else q = q.is("trashed_at", null);
  const view = VIEWS[String(body.view || "")];
  if (view) q = view(q);
  if (body.accountId) q = q.eq("account_id", body.accountId);
  if (body.category && !opts.skipCategory) q = q.eq("category", body.category);
  if (body.status) q = q.eq("status", body.status);
  if (body.direction) q = q.eq("direction", body.direction);
  if (BELEG_STATES.includes(body.belegState)) q = q.eq("beleg_state", body.belegState);
  if (body.hero === "mit") q = q.not("hero_project_match_id", "is", null);
  if (body.hero === "ohne") q = q.is("hero_project_match_id", null);
  if (body.attachments === "ja") q = q.eq("has_attachments", true);
  if (body.from) q = q.gte("sent_at", String(body.from));
  if (body.to) q = q.lte("sent_at", String(body.to));
  const s = likeSafe(String(body.q || ""));
  if (s) q = q.or(`subject.ilike.%${s}%,from_addr.ilike.%${s}%,summary.ilike.%${s}%,from_name.ilike.%${s}%`);
  return q;
}

type Ctx = { sb: any; user: MailUser; body: Record<string, any> };

/** Betrachter fuer die Themen: seine Postfaecher, und vorgelegt wird nur, was an ihn (oder an alle) gerichtet ist. */
async function viewerOf(sb: any, user: MailUser): Promise<Viewer> {
  return { accountIds: user.accountIds, userId: user.id, audience: await mailAudience(sb).catch(() => undefined) };
}

/** Anhaenge der vorgelegten Mails mit kurzlebigen Links (10 Minuten), damit sie direkt in „Zu entscheiden“ aufgehen. */
async function withAttachments(sb: any, topics: Topic[]): Promise<Topic[]> {
  const ids = topics.flatMap((t) => t.newMessages.filter((m) => m.has_attachments).map((m) => m.id));
  if (!ids.length) return topics;
  const { data } = await sb.from("email_attachments").select("id, message_id, filename, mime, size, storage_path")
    .in("message_id", ids).eq("is_ignored", false).order("created_at");
  const rows = (data || []) as any[];
  const paths = rows.map((r) => r.storage_path).filter(Boolean);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await sb.storage.from("email-attachments").createSignedUrls(paths, 600);
    for (const x of signed || []) if (x?.path && x.signedUrl) urls.set(x.path, x.signedUrl);
  }
  const byMsg = new Map<string, NonNullable<Topic["newMessages"][number]["attachments"]>>();
  for (const r of rows) {
    (byMsg.get(r.message_id) ?? byMsg.set(r.message_id, []).get(r.message_id)!)
      .push({ id: r.id, filename: r.filename, mime: r.mime, size: r.size, url: r.storage_path ? urls.get(r.storage_path) ?? null : null });
  }
  for (const t of topics) for (const m of t.newMessages) if (byMsg.has(m.id)) m.attachments = byMsg.get(m.id);
  return topics;
}
type Handler = (c: Ctx) => Promise<unknown>;

const must = <T>(r: { data: T; error: any }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

/** Suchtext fuer PostgREST-`or` entschaerfen (Kommas, Klammern, Platzhalter). */
const likeSafe = (q: string) => q.replace(/[%_,()\\]/g, " ").trim().slice(0, 80);

const handlers: Record<string, Handler> = {
  async me({ user }) {
    return { name: user.name, email: user.email, role: user.role, admin: isMailAdmin(user), accountIds: user.accountIds };
  },

  async overview({ sb, user }) {
    const statuses = ["neu", "klassifiziert", "zugeordnet", "ohne_bezug", "erledigt", "wartet", "fehler"];
    const counts: Record<string, number> = {};
    await Promise.all(statuses.map(async (s) => {
      const { count } = await scopeAccounts(sb.from("email_messages").select("id", { count: "exact", head: true }), user).eq("status", s);
      counts[s] = count ?? 0;
    }));
    const { count: open } = await scopeAccounts(
      sb.from("email_suggestions").select("id, email_messages!inner(account_id)", { count: "exact", head: true }), user, "email_messages.account_id",
    ).eq("status", "offen");
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const { data: today } = await sb.from("email_ai_calls").select("neurons").eq("provider_type", "cloudflare").gte("created_at", start.toISOString());
    const { data: month } = await sb.from("email_ai_calls").select("cost_usd, neurons").gte("created_at", monthStart.toISOString());
    const prices = await getConfig<any>(sb, "llm_prices", {});
    const budget = await getConfig<any>(sb, "budget", {});
    const neuronsMonth = (month || []).reduce((n: number, r: any) => n + Number(r.neurons || 0), 0);
    const cost = (month || []).reduce((n: number, r: any) => n + Number(r.cost_usd || 0), 0) +
      (neuronsMonth / 1000) * Number(prices?._neuron_usd_per_1000 ?? 0.011);
    const topics = await topicCounts(sb, undefined, await viewerOf(sb, user)).catch(() => null);
    return {
      statusCounts: counts,
      openSuggestions: open ?? 0,
      topics,
      neuronsToday: (today || []).reduce((n: number, r: any) => n + Number(r.neurons || 0), 0),
      costMonthUsd: Math.round(cost * 10000) / 10000,
      budgetUsd: budget?.monthly_usd ?? null,
      budgetExceeded: budget?.monthly_usd != null && Number(budget.monthly_usd) > 0 && cost >= Number(budget.monthly_usd),
    };
  },

  async list_messages({ sb, user, body }) {
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const offset = Math.max(Number(body.offset) || 0, 0);
    const q = applyMessageFilters(sb.from("email_messages").select(MESSAGE_LIST_COLUMNS, { count: "exact" }), body, user);
    const { data, error, count } = await q.order("sent_at", { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { messages: data || [], total: count ?? 0 };
  },

  /** Anzahl je Kategorie unter den uebrigen Filtern (fuer die Kategorie-Chips). */
  async message_facets({ sb, user, body }) {
    const categories: Record<string, number> = {};
    await Promise.all(CATEGORIES.map(async (c) => {
      const q = applyMessageFilters(sb.from("email_messages").select("id", { count: "exact", head: true }), body, user, { skipCategory: true });
      const { count } = await q.eq("category", c);
      categories[c] = count ?? 0;
    }));
    return { categories };
  },

  async get_message({ sb, user, body }) {
    const id = String(body.id || "");
    const { data: msg } = await sb.from("email_messages").select("*").eq("id", id).maybeSingle();
    if (!msg) throw new Error("Mail nicht gefunden.");
    assertAccount(user, msg.account_id);
    const topicP = topicOfThread(sb, msg.thread_id).catch(() => null);
    const [{ data: thread }, { data: atts }, { data: shadow }, { data: suggestions }, { data: calls }] = await Promise.all([
      msg.thread_id
        ? sb.from("email_messages").select("id, direction, from_addr, from_name, subject, sent_at, summary, category, body_text, status, decided_at, decision")
            .eq("thread_id", msg.thread_id).order("sent_at", { ascending: true })
        : Promise.resolve({ data: [] }),
      sb.from("email_attachments").select("*").eq("message_id", id).order("created_at"),
      sb.from("email_ai_shadow").select("*").eq("message_id", id),
      sb.from("email_suggestions").select("*").eq("message_id", id).order("created_at", { ascending: false }),
      sb.from("email_ai_calls").select("task, provider_type, model, tokens_in, tokens_out, neurons, cost_usd, ok, fallback, error, created_at")
        .eq("message_id", id).order("created_at"),
    ]);
    // Anhaenge nur ueber kurzlebige Signed URLs (10 Minuten).
    const attachments = [];
    for (const a of atts || []) {
      let url: string | null = null;
      if (a.storage_path) {
        const { data: s } = await sb.storage.from("email-attachments").createSignedUrl(a.storage_path, 600);
        url = s?.signedUrl ?? null;
      }
      attachments.push({ ...a, storage_path: undefined, url });
    }
    // Wissen, das fuer diesen Absender gilt (allgemeine Eintraege nur als Anzahl).
    const { data: kn } = await sb.from("email_knowledge").select("id, text, from_pattern, source, created_at").eq("active", true)
      .order("created_at", { ascending: false }).limit(300);
    const knowledge = {
      sender: (kn || []).filter((k: any) => k.from_pattern && matchesPattern(msg.from_addr, k.from_pattern)),
      general: (kn || []).filter((k: any) => !k.from_pattern).length,
    };
    return { message: { ...msg, body_html: undefined }, thread: thread || [], attachments, shadow: shadow || [], suggestions: suggestions || [], calls: calls || [], knowledge, topic: await topicP };
  },

  /** Korrektur eines Menschen: wird gespeichert und fliesst als Beispiel in kuenftige Laeufe. */
  async correct_message({ sb, user, body }) {
    const id = String(body.id || "");
    await assertMessages(sb, user, [id]);
    const { data: msg } = await sb.from("email_messages").select("id, from_addr, category, summary, extracted").eq("id", id).maybeSingle();
    if (!msg) throw new Error("Mail nicht gefunden.");
    const patch: Record<string, unknown> = {};
    const feedback: { field: string; old_value: string | null; new_value: string | null }[] = [];
    if (body.category !== undefined) {
      if (!(CATEGORIES as readonly string[]).includes(body.category)) throw new Error("Unbekannte Kategorie.");
      if (body.category !== msg.category) {
        patch.category = body.category;
        feedback.push({ field: "category", old_value: msg.category, new_value: body.category });
      }
    }
    if (body.summary !== undefined && body.summary !== msg.summary) {
      patch.summary = String(body.summary).slice(0, 1000);
      feedback.push({ field: "summary", old_value: msg.summary, new_value: patch.summary as string });
    }
    if (body.extracted && typeof body.extracted === "object") {
      const next = { ...(msg.extracted || {}) };
      for (const [group, fields] of Object.entries(body.extracted as Record<string, any>)) {
        if (group.startsWith("_") || !fields || typeof fields !== "object") continue;
        const cur = { ...((next as any)[group] || {}) };
        for (const [k, v] of Object.entries(fields)) {
          if (JSON.stringify(cur[k] ?? null) !== JSON.stringify(v ?? null)) {
            feedback.push({ field: `${group}.${k}`, old_value: cur[k] == null ? null : String(cur[k]), new_value: v == null ? null : String(v) });
            cur[k] = v;
          }
        }
        (next as any)[group] = cur;
      }
      patch.extracted = next;
    }
    if (!Object.keys(patch).length) return { changed: 0 };
    must(await sb.from("email_messages").update(patch).eq("id", id));
    must(await sb.from("email_feedback").insert(feedback.map((f) => ({ ...f, message_id: id, from_addr: msg.from_addr }))));
    // Zweimal dieselbe Kategorie-Korrektur fuer einen Absender -> gelernte Regel.
    let learned = null;
    if (feedback.some((f) => f.field === "category")) {
      learned = await learnRule(msg.from_addr, {
        async recentCategoryFeedback(addr, n) {
          const { data } = await sb.from("email_feedback").select("new_value, created_at").eq("field", "category").eq("from_addr", addr)
            .order("created_at", { ascending: false }).limit(n);
          return data || [];
        },
        async existingRule(pattern) {
          const { data } = await sb.from("email_rules").select("source, category").eq("pattern", pattern).maybeSingle();
          return data ?? null;
        },
        async saveRule(pattern, category) {
          must(await sb.from("email_rules").upsert({ pattern, category, source: "gelernt", protect: false }, { onConflict: "pattern" }));
        },
      });
    }
    return { changed: feedback.length, learned };
  },

  /** Beleg-Stand von Hand setzen, z. B. „Im Portal abgeholt und verbucht“. */
  async set_beleg_state({ sb, user, body }) {
    await assertMessages(sb, user, [body.id]);
    const state = String(body.state || "");
    if (!BELEG_STATES.includes(state)) throw new Error("Unbekannter Stand.");
    must(await sb.from("email_messages").update({ beleg_state: state, ...(state === "weitergeleitet" ? { forwarded_at: new Date().toISOString() } : {}) }).eq("id", String(body.id || "")));
    return { ok: true };
  },

  /** Mail noch einmal durch die Pipeline schicken. */
  async reprocess_message({ sb, user, body }) {
    await assertMessages(sb, user, [body.id]);
    must(await sb.from("email_messages").update({ status: "neu", attempts: 0, error: null }).eq("id", String(body.id || "")));
    return { ok: true };
  },

  /** Mehrfachauswahl in der Liste: Kategorie setzen (wie einzeln korrigiert, mit Lernen) oder neu verarbeiten. */
  async bulk_messages({ sb, user, body }) {
    const ids: string[] = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 200);
    if (!ids.length) throw new Error("Keine Mails ausgewählt.");
    await assertMessages(sb, user, ids);
    if (body.op === "reprocess") {
      must(await sb.from("email_messages").update({ status: "neu", attempts: 0, error: null }).in("id", ids).is("trashed_at", null));
      return { changed: ids.length };
    }
    if (body.op === "category") {
      if (!(CATEGORIES as readonly string[]).includes(body.category)) throw new Error("Unbekannte Kategorie.");
      let changed = 0;
      const learned: string[] = [];
      for (const id of ids) {
        const r = await handlers.correct_message({ sb, user, body: { id, category: body.category } }) as { changed: number; learned?: { pattern: string } | null };
        changed += r.changed ? 1 : 0;
        if (r.learned) learned.push(r.learned.pattern);
      }
      return { changed, learned };
    }
    throw new Error("Unbekannte Aktion.");
  },

  /**
   * „Das ist falsch – richtig waere …": Freitext zu genau dieser Mail. Offene Vorschlaege werden
   * verworfen, die Mail laeuft mit dem Hinweis neu durch, und auf Wunsch entsteht ein Eintrag in
   * der Wissensdatei (fuer den Absender, die Domain oder alle Mails).
   */
  async teach({ sb, user, body }) {
    const id = String(body.id || "");
    await assertMessages(sb, user, [id]);
    const note = String(body.text || "").trim();
    if (note.length < 3) throw new Error("Bitte kurz beschreiben, was richtig wäre.");
    if (note.length > KNOWLEDGE_TEXT_MAX) throw new Error(`Höchstens ${KNOWLEDGE_TEXT_MAX} Zeichen.`);
    const scope = (["keine", "absender", "domain", "alle"].includes(body.remember) ? body.remember : "keine") as KnowledgeScope;
    const { data: msg } = await sb.from("email_messages").select("id, account_id, from_addr, correction_note").eq("id", id).maybeSingle();
    if (!msg) throw new Error("Mail nicht gefunden.");

    let knowledgeId: string | null = null;
    const pattern = patternForScope(scope, msg.from_addr);
    if (pattern !== undefined) {
      const text = String(body.knowledgeText || note).trim().slice(0, KNOWLEDGE_TEXT_MAX);
      if (text.length < 3) throw new Error("Der Wissenseintrag ist leer.");
      const k = must(await sb.from("email_knowledge").insert({ text, from_pattern: pattern, source: "korrektur", message_id: id }).select("id").single()) as any;
      knowledgeId = k.id;
    }

    const now = new Date().toISOString();
    const { data: open } = await sb.from("email_suggestions").update({ status: "abgelehnt", decided_at: now, result: { reason: "korrigiert" } })
      .eq("message_id", id).eq("status", "offen").select("type");
    must(await sb.from("email_feedback").insert([
      { message_id: id, field: "hinweis", old_value: msg.correction_note, new_value: note, from_addr: msg.from_addr },
      ...(open || []).map((r: any) => ({ message_id: id, field: `suggestion.${r.type}`, old_value: "vorgeschlagen", new_value: "abgelehnt", from_addr: msg.from_addr })),
    ]));
    must(await sb.from("email_messages").update({ correction_note: note, status: "neu", attempts: 0, error: null }).eq("id", id));
    return { accountId: msg.account_id, knowledgeId, rejected: (open || []).length };
  },

  // ------------------------------------------------------------------ Wissensdatei
  async list_knowledge({ sb }) {
    const rows = must(await sb.from("email_knowledge").select("id, text, from_pattern, source, message_id, active, created_at, updated_at")
      .order("created_at", { ascending: false }).limit(500)) as any[];
    // Betreff der Ursprungsmail mitgeben, damit man sieht, woher ein Eintrag stammt.
    const ids = [...new Set(rows.map((r) => r.message_id).filter(Boolean))];
    const subjects: Record<string, string> = {};
    if (ids.length) {
      const { data } = await sb.from("email_messages").select("id, subject").in("id", ids);
      for (const m of data || []) subjects[m.id] = m.subject;
    }
    return rows.map((r) => ({ ...r, message_subject: r.message_id ? subjects[r.message_id] ?? null : null }));
  },
  async save_knowledge({ sb, body }) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.text !== undefined) {
      const text = String(body.text).trim();
      if (text.length < 3 || text.length > KNOWLEDGE_TEXT_MAX) throw new Error(`Text: 3 bis ${KNOWLEDGE_TEXT_MAX} Zeichen.`);
      row.text = text;
    }
    if (body.from_pattern !== undefined) row.from_pattern = normalizePattern(body.from_pattern);
    if (body.active !== undefined) row.active = !!body.active;
    if (body.id) {
      must(await sb.from("email_knowledge").update(row).eq("id", String(body.id)));
      return { id: body.id };
    }
    if (!row.text) throw new Error("Text fehlt.");
    return must(await sb.from("email_knowledge").insert({ ...row, source: "manuell" }).select("id").single());
  },
  async delete_knowledge({ sb, body }) {
    must(await sb.from("email_knowledge").delete().eq("id", String(body.id || "")));
    return { ok: true };
  },

  // ------------------------------------------------------------------ Postfaecher
  async list_accounts({ sb, user }) {
    const { data } = await scopeAccounts(sb.from("email_accounts")
      .select("id, label, address, imap_host, imap_port, smtp_host, smtp_port, username, password_enc, folder_map, signature, autopilot, shadow_mode, enabled, backfill, last_sync_at, last_error, locked_until"), user, "id")
      .order("created_at");
    // Mitarbeiter brauchen nur Name und Adresse (Filter, Absender) – Server, Benutzername und Automatik bleiben Admin-Sache.
    if (!isMailAdmin(user)) return (data || []).map((a: any) => ({ id: a.id, label: a.label, address: a.address, enabled: a.enabled }));
    return (data || []).map((a: any) => ({ ...a, password_enc: undefined, has_password: !!a.password_enc, autopilot: normalizeAutopilot(a.autopilot) }));
  },

  async save_account({ sb, body }) {
    const row: Record<string, unknown> = {};
    for (const k of ["label", "address", "imap_host", "smtp_host", "username", "signature"] as const) {
      if (body[k] !== undefined) row[k] = String(body[k]).trim();
    }
    if (body.imap_port !== undefined) row.imap_port = Math.min(Math.max(parseInt(body.imap_port, 10) || 993, 1), 65535);
    if (body.smtp_port !== undefined) row.smtp_port = Math.min(Math.max(parseInt(body.smtp_port, 10) || 465, 1), 65535);
    if (body.backfill !== undefined) row.backfill = Math.min(Math.max(parseInt(body.backfill, 10) || 0, 0), 500);
    if (body.shadow_mode !== undefined) row.shadow_mode = !!body.shadow_mode;
    if (body.enabled !== undefined) row.enabled = !!body.enabled;
    if (body.autopilot !== undefined) row.autopilot = normalizeAutopilot(body.autopilot);
    if (body.password) row.password_enc = await encryptSecret(String(body.password), encryptionKey());
    if (body.id) {
      must(await sb.from("email_accounts").update(row).eq("id", body.id));
      return { id: body.id };
    }
    if (!row.address || !row.imap_host || !row.username) throw new Error("Adresse, Server und Benutzername sind Pflicht.");
    row.label = row.label || row.address;
    const d = must(await sb.from("email_accounts").insert({ imap_port: 993, ...row }).select("id").single()) as any;
    return { id: d.id };
  },

  // ------------------------------------------------------------------ Regeln
  async list_rules({ sb }) {
    return must(await sb.from("email_rules").select("*").order("pattern"));
  },
  async save_rule({ sb, body }) {
    const pattern = String(body.pattern || "").trim().toLowerCase();
    if (!pattern || !/^@?[^\s@]+(\.[^\s@]+)*$|^[^\s@]+@[^\s@]+$/.test(pattern)) throw new Error("Muster: Adresse (a@b.de) oder Domain (@b.de).");
    if (!(CATEGORIES as readonly string[]).includes(body.category)) throw new Error("Unbekannte Kategorie.");
    const row = { pattern, category: body.category, target_folder: body.target_folder || null, protect: !!body.protect, source: "manuell" };
    must(await sb.from("email_rules").upsert(row, { onConflict: "pattern" }));
    return { ok: true };
  },
  async delete_rule({ sb, body }) {
    must(await sb.from("email_rules").delete().eq("id", String(body.id || "")));
    return { ok: true };
  },

  // ------------------------------------------------------------------ Konfiguration
  async get_config({ sb }) {
    const out: Record<string, unknown> = {};
    for (const k of CONFIG_KEYS) out[k] = await getConfig(sb, k, null);
    return out;
  },
  async save_config({ sb, body }) {
    const key = String(body.key || "");
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) throw new Error("Dieser Einstellungsschluessel ist nicht aenderbar.");
    if (body.value === undefined) throw new Error("Wert fehlt.");
    await setConfig(sb, key, key === "topics" ? normalizeTopicConfig(body.value) : body.value);
    return { ok: true };
  },

  // ------------------------------------------------------------------ KI
  async list_ai({ sb }) {
    const [{ data: providers }, { data: settings }] = await Promise.all([
      sb.from("email_ai_providers").select("id, name, type, base_url, account_id, api_key_enc, enabled").order("name"),
      sb.from("email_ai_settings").select("*").order("task"),
    ]);
    return {
      providers: (providers || []).map((p: any) => ({ ...p, api_key_enc: undefined, has_key: !!p.api_key_enc })),
      settings: settings || [],
      tasks: AI_TASKS,
    };
  },
  async save_provider({ sb, body }) {
    const row: Record<string, unknown> = {};
    for (const k of ["name", "base_url", "account_id"] as const) if (body[k] !== undefined) row[k] = body[k] ? String(body[k]).trim() : null;
    if (body.type !== undefined) {
      if (!["cloudflare", "anthropic", "openai"].includes(body.type)) throw new Error("Unbekannter Anbieter-Typ.");
      row.type = body.type;
    }
    if (body.enabled !== undefined) row.enabled = !!body.enabled;
    if (body.api_key) row.api_key_enc = await encryptSecret(String(body.api_key), encryptionKey());
    if (body.id) {
      must(await sb.from("email_ai_providers").update(row).eq("id", body.id));
      return { id: body.id };
    }
    if (!row.name || !row.type) throw new Error("Name und Typ sind Pflicht.");
    return must(await sb.from("email_ai_providers").insert(row).select("id").single());
  },
  async save_ai_setting({ sb, body }) {
    if (!(AI_TASKS as readonly string[]).includes(body.task)) throw new Error("Unbekannte Aufgabe.");
    const row: Record<string, unknown> = { task: body.task };
    for (const k of ["provider_id", "fallback_provider_id", "shadow_provider_id"] as const) if (body[k] !== undefined) row[k] = body[k] || null;
    for (const k of ["model", "fallback_model", "shadow_model"] as const) if (body[k] !== undefined) row[k] = body[k] ? String(body[k]).trim() : null;
    if (body.on_limit !== undefined) {
      if (!["ausweichen", "warten"].includes(body.on_limit)) throw new Error("on_limit: ausweichen oder warten.");
      row.on_limit = body.on_limit;
    }
    if (body.daily_neuron_limit !== undefined) row.daily_neuron_limit = Math.max(0, parseInt(body.daily_neuron_limit, 10) || 0);
    if (row.model !== undefined && !row.model) throw new Error("Modell darf nicht leer sein.");
    must(await sb.from("email_ai_settings").upsert(row, { onConflict: "task" }));
    return { ok: true };
  },

  // ------------------------------------------------------------------ Vorschlaege (Zu entscheiden)
  async list_suggestions({ sb, user, body }) {
    const status = ["offen", "angenommen", "abgelehnt", "fehlgeschlagen"].includes(body.status) ? body.status : "offen";
    const { data, error } = await scopeAccounts(sb.from("email_suggestions")
      .select("id, type, payload, status, result, created_at, decided_at, email_messages!inner(id, account_id, subject, from_addr, from_name, summary, category, confidence, sent_at, direction, hero_project_match_id, match_info, has_attachments, extracted)"), user, "email_messages.account_id")
      .eq("status", status).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    const ids = [...new Set((data || []).map((r: any) => r.email_messages.id))];
    const atts: Record<string, any[]> = {};
    if (ids.length) {
      const { data: a } = await sb.from("email_attachments").select("id, message_id, filename, mime, size, role, storage_path, is_ignored").in("message_id", ids);
      for (const x of a || []) {
        let url: string | null = null;
        if (x.storage_path && /^image\//.test(x.mime)) {
          const { data: sg } = await sb.storage.from("email-attachments").createSignedUrl(x.storage_path, 600);
          url = sg?.signedUrl ?? null;
        }
        (atts[x.message_id] ||= []).push({ id: x.id, filename: x.filename, mime: x.mime, size: x.size, role: x.role, is_ignored: x.is_ignored, url });
      }
    }
    return (data || []).map((r: any) => ({ ...r, message: r.email_messages, email_messages: undefined, attachments: atts[r.email_messages.id] || [] }));
  },

  // ------------------------------------------------------------------ Themen
  /** Themen einer Ansicht: entscheiden | laufend | wiedervorlage | erledigt (topics.ts). */
  async list_topics({ sb, user, body }) {
    const views: TopicView[] = ["entscheiden", "laufend", "wiedervorlage", "erledigt"];
    const view = views.includes(body.view) ? body.view as TopicView : "entscheiden";
    const topics = await listTopics(sb, view, undefined, await viewerOf(sb, user));
    return view === "entscheiden" ? await withAttachments(sb, topics) : topics;
  },

  /** Thema entscheiden: weiter verfolgen, Wiedervorlage (until = YYYY-MM-DD, note), abschliessen, wieder oeffnen. */
  async topic_decide({ sb, user, body }) {
    const decision = String(body.decision || "");
    if (!["weiter", "wiedervorlage", "erledigt", "oeffnen"].includes(decision)) throw new Error("decision: weiter, wiedervorlage, erledigt oder oeffnen.");
    let threadId = String(body.threadId || "");
    if (!threadId && body.messageId) {
      const { data } = await sb.from("email_messages").select("thread_id").eq("id", String(body.messageId)).maybeSingle();
      threadId = data?.thread_id ?? "";
    }
    await assertThread(sb, user, threadId);
    return await decideTopic(sb, threadId, {
      decision: decision as any, until: body.until ?? null, note: body.note ?? null,
      messageIds: Array.isArray(body.messageIds) ? body.messageIds.map(String) : null,
    });
  },

  /** Kurzuebersicht (fuer die Startseite und die optionale 7-Uhr-Push-Meldung). */
  async digest({ sb, user }) {
    const twoDays = new Date(Date.now() - 2 * 86400_000).toISOString();
    const { count: open } = await scopeAccounts(
      sb.from("email_suggestions").select("id, email_messages!inner(account_id)", { count: "exact", head: true }), user, "email_messages.account_id",
    ).eq("status", "offen");
    const customerCats = ["anfrage_neu", "projekt_kommunikation", "layout_freigabe", "auftrag", "reklamation"];
    const { data: unanswered } = await scopeAccounts(sb.from("email_messages")
      .select("id, subject, from_name, from_addr, sent_at, category, email_threads!inner(answered)"), user)
      .eq("direction", "in").in("category", customerCats).eq("email_threads.answered", false).lt("sent_at", twoDays).is("trashed_at", null)
      .order("sent_at", { ascending: true }).limit(20);
    const { data: claims } = await scopeAccounts(sb.from("email_messages")
      .select("id, subject, from_name, from_addr, sent_at, email_threads!inner(answered)"), user)
      .eq("direction", "in").eq("category", "reklamation").eq("email_threads.answered", false).is("trashed_at", null)
      .order("sent_at", { ascending: true }).limit(20);
    const { data: portal } = await scopeAccounts(sb.from("email_messages")
      .select("id, subject, from_name, from_addr, sent_at, beleg_vendor"), user).eq("beleg_state", "portal_offen").is("trashed_at", null)
      .order("sent_at", { ascending: true }).limit(50);
    const lines: string[] = [];
    if (portal?.length) lines.push(`${portal.length} Rechnung(en) im Portal abzuholen.`);
    if (open) lines.push(`${open} Vorschlag/Vorschläge warten auf dich.`);
    if (unanswered?.length) lines.push(`${unanswered.length} Kundenmail(s) seit über 2 Tagen unbeantwortet.`);
    if (claims?.length) lines.push(`${claims.length} offene Reklamation(en).`);
    return {
      openSuggestions: open ?? 0,
      unanswered: (unanswered || []).map((r: any) => ({ id: r.id, subject: r.subject, from: r.from_name || r.from_addr, sent_at: r.sent_at, category: r.category })),
      portalOpen: (portal || []).map((r: any) => ({ id: r.id, subject: r.subject, from: r.beleg_vendor || r.from_name || r.from_addr, sent_at: r.sent_at })),
      claims: (claims || []).map((r: any) => ({ id: r.id, subject: r.subject, from: r.from_name || r.from_addr, sent_at: r.sent_at })),
      text: lines.length ? `Mail-Assistent: ${lines.join(" ")}` : "Mail-Assistent: nichts offen.",
    };
  },

  // ------------------------------------------------------------------ HERO (lesend)
  /** Aktueller Status eines HERO-Projekts und die Schritte des Ablaufs (fuer „Projektstatus“ in Zu entscheiden). Nur lesend. */
  async project_status({ sb, body }) {
    const key = await H.loadHeroKey(sb);
    if (!key) throw new Error("HERO ist nicht aktiviert.");
    const id = Number(body.projectId);
    if (!Number.isFinite(id) || id <= 0) throw new Error("Projekt fehlt.");
    const cfg = (await getConfig<any>(sb, "hero", {})) ?? {};
    const [p, steps] = await Promise.all([H.projectById(key, id), H.projectSteps(key, cfg.project_type_id ?? null)]);
    if (!p) throw new Error("Projekt in HERO nicht gefunden.");
    return { projectId: p.id, nr: p.nr, name: p.name, stepId: p.stepId, stepName: p.stepName, steps };
  },

  async search_projects({ sb, body }) {
    const key = await H.loadHeroKey(sb);
    if (!key) throw new Error("HERO ist nicht aktiviert.");
    const term = String(body.q || "").trim();
    if (term.length < 2) return [];
    return await H.searchProjects(key, term);
  },

  /** Pipeline-Schritte und Dokumenttypen anhand ihrer Namen aus HERO neu zuordnen. */
  async hero_reload({ sb }) {
    const key = await H.loadHeroKey(sb);
    if (!key) throw new Error("HERO ist nicht aktiviert.");
    const cfg = (await getConfig<any>(sb, "hero", {})) ?? {};
    const data = await H.heroGraphql(key, "query { project_types { id name project_status_steps { id name } } document_types { id name } }");
    const types: any[] = data?.project_types || [];
    const type = types.find((t) => Number(t.id) === Number(cfg.project_type_id)) ?? types.find((t) => /^projekt$/i.test(String(t.name).trim()));
    if (!type) throw new Error("Projekttyp in HERO nicht gefunden – bitte die Projekttyp-ID prüfen.");
    const steps = mapSteps(type.project_status_steps || []);
    const docs = mapDocumentTypes(data?.document_types || []);
    const next = {
      ...cfg,
      project_type_id: Number(type.id),
      steps: { ...(cfg.steps ?? {}), ...steps.steps },
      excluded_steps: steps.excluded.length ? steps.excluded : cfg.excluded_steps ?? [],
      document_types: { ...(cfg.document_types ?? {}), ...docs.found },
      offer_document_type_id: docs.offerTypeId ?? cfg.offer_document_type_id,
      confirmation_document_type_id: docs.confirmationTypeId ?? cfg.confirmation_document_type_id,
    };
    await setConfig(sb, "hero", next);
    return { hero: next, missing: steps.missing, docTypesFound: Object.keys(docs.found) };
  },

  /** Nur lesen: Argumente einer HERO-Mutation per Introspection (z. B. create_document). */
  async hero_probe({ sb, body }) {
    const key = await H.loadHeroKey(sb);
    if (!key) throw new Error("HERO ist nicht aktiviert.");
    const name = String(body.mutation || "create_document");
    if (!/^[a-z_]{3,60}$/.test(name)) throw new Error("Ungültiger Name.");
    const data = await H.heroGraphql(key, "query { __type(name: \"Mutation\") { fields { name args { name type { name kind ofType { name kind } } } } } }");
    const f = (data?.__type?.fields || []).find((x: any) => x.name === name);
    const services = await H.heroGraphql(key, "query { supply_services { id } }").then((d) => (d?.supply_services || []).length).catch(() => null);
    return { mutation: name, found: !!f, args: f?.args ?? null, supplyServices: services };
  },

  /** Live-Stand eines HERO-Dokuments fuer die Karte „versenden": Status, PDF, passende Mailvorlagen. Nur lesend. */
  async document_info({ sb, body }) {
    const key = await H.loadHeroKey(sb);
    if (!key) throw new Error("HERO ist nicht aktiviert.");
    const kind: H.DocumentKind = body.kind === "offer" ? "offer" : "confirmation";
    const doc = await H.documentById(key, Number(body.documentId));
    if (!doc) throw new Error("Dokument nicht gefunden (in HERO gelöscht?).");
    const templates = await H.emailTemplates(key, H.DOCUMENT_MAIL_CONTEXT[kind]);
    return {
      id: doc.id, nr: doc.nr, statusCode: doc.statusCode, statusName: doc.statusName, value: doc.value, projectNr: doc.projectNr,
      hasPdf: !!doc.fileUuid && doc.statusCode >= 100, sent: doc.statusCode === 200,
      templates, suggestedTemplateId: H.pickTemplate(templates, body.formality === "du" ? "du" : body.formality === "sie" ? "sie" : null)?.id ?? null,
    };
  },

  // ------------------------------------------------------------------ Referenzwissen (Skill-Dateien, HERO-Doku)
  async list_reference_docs({ sb }) {
    return must(await sb.from("email_reference_docs").select("id, title, content, tasks, active, created_at, updated_at").order("created_at"));
  },
  async save_reference_doc({ sb, body }) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (t.length < 2 || t.length > 200) throw new Error("Titel: 2 bis 200 Zeichen.");
      row.title = t;
    }
    if (body.content !== undefined) {
      const c = String(body.content);
      if (c.length > 60000) throw new Error("Höchstens 60.000 Zeichen je Dokument – bitte aufteilen.");
      row.content = c;
    }
    if (body.tasks !== undefined) {
      const allowed = ["prepare_offer", "prepare_confirmation", "understand", "draft"];
      row.tasks = (Array.isArray(body.tasks) ? body.tasks : []).map(String).filter((t: string) => allowed.includes(t));
    }
    if (body.active !== undefined) row.active = !!body.active;
    if (body.id) {
      must(await sb.from("email_reference_docs").update(row).eq("id", String(body.id)));
      return { id: body.id };
    }
    if (!row.title) throw new Error("Titel fehlt.");
    return must(await sb.from("email_reference_docs").insert(row).select("id").single());
  },
  async delete_reference_doc({ sb, body }) {
    must(await sb.from("email_reference_docs").delete().eq("id", String(body.id || "")));
    return { ok: true };
  },

  // ------------------------------------------------------------------ Benutzer (nur Admin)
  async list_users({ sb, user }) {
    return await listMailUsers(sb, user);
  },
  async save_user({ sb, user, body }) {
    return await saveMailUser(sb, user, body);
  },

  // ------------------------------------------------------------------ Protokoll
  async list_runs({ sb, body }) {
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const { data } = await sb.from("email_runs").select("*").order("started_at", { ascending: false }).limit(limit);
    return data || [];
  },
};


Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user = await requireMailUser(req, sb);
  if (!user) return fail("Nicht angemeldet oder kein Zugang zur Mail-App (Admin oder Mitarbeiter mit Postfach).", { code: "unauthorized" });

  const body = await readJson(req);
  const action = String(body.action || "");
  const h = handlers[action];
  if (!h) return fail("Unbekannte Aktion.");
  if (ADMIN_ONLY.has(action) && !isMailAdmin(user)) return fail("Nur für Admins.", { code: "forbidden" });
  try {
    return ok(await h({ sb, user, body }));
  } catch (e) {
    return fail(String((e as Error)?.message || e).slice(0, 300), e instanceof AccessError ? { code: "forbidden" } : {});
  }
});
