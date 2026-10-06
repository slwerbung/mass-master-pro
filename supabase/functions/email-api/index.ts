// Schnittstelle der Mail-App. Die Oberflaeche greift NUR hierueber zu: alle
// E-Mail-Tabellen sind nur fuer service_role lesbar. Jede Anfrage verlangt eine
// Supabase-Auth-Sitzung mit Rolle `admin`.
//
//   POST { action: "...", ...parameter }  ->  { ok: true, data } | { ok: false, error }

import { createClient } from "@supabase/supabase-js";
import { fail, ok, preflight, readJson, requireAdmin, type AdminUser } from "../_shared/email/http.ts";
import { encryptSecret } from "../_shared/email/crypto.ts";
import { encryptionKey, getConfig, setConfig } from "../_shared/email/config.ts";
import { normalizeAutopilot } from "../_shared/email/autopilot.ts";
import { AI_TASKS, CATEGORIES } from "../_shared/email/types.ts";
import * as H from "../_shared/email/hero.ts";
import { learnRule } from "../_shared/email/learn.ts";
import { mapDocumentTypes, mapSteps } from "../_shared/email/heroReload.ts";

// Nur diese Schluessel darf die Oberflaeche in email_config schreiben – der
// Admin-Zugang ist kein Generalschluessel fuer die Tabelle.
const CONFIG_KEYS = [
  "folders", "gewerke", "hero", "company_knowledge", "reply_rules", "lexoffice", "budget", "retention_days", "llm_prices",
] as const;

const MESSAGE_LIST_COLUMNS =
  "id, account_id, thread_id, direction, from_addr, from_name, subject, sent_at, status, category, confidence, summary, " +
  "hero_project_match_id, match_method, has_attachments, draft_message_id, current_folder, error, hero_logged_at, beleg_state, beleg_vendor";

type Ctx = { sb: any; user: AdminUser; body: Record<string, any> };
type Handler = (c: Ctx) => Promise<unknown>;

const must = <T>(r: { data: T; error: any }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

/** Suchtext fuer PostgREST-`or` entschaerfen (Kommas, Klammern, Platzhalter). */
const likeSafe = (q: string) => q.replace(/[%_,()\\]/g, " ").trim().slice(0, 80);

const handlers: Record<string, Handler> = {
  async me({ user }) {
    return { name: user.name, email: user.email };
  },

  async overview({ sb }) {
    const statuses = ["neu", "klassifiziert", "zugeordnet", "ohne_bezug", "erledigt", "wartet", "fehler"];
    const counts: Record<string, number> = {};
    await Promise.all(statuses.map(async (s) => {
      const { count } = await sb.from("email_messages").select("id", { count: "exact", head: true }).eq("status", s);
      counts[s] = count ?? 0;
    }));
    const { count: open } = await sb.from("email_suggestions").select("id", { count: "exact", head: true }).eq("status", "offen");
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const { data: today } = await sb.from("email_ai_calls").select("neurons").eq("provider_type", "cloudflare").gte("created_at", start.toISOString());
    const { data: month } = await sb.from("email_ai_calls").select("cost_usd, neurons").gte("created_at", monthStart.toISOString());
    const prices = await getConfig<any>(sb, "llm_prices", {});
    const budget = await getConfig<any>(sb, "budget", {});
    const neuronsMonth = (month || []).reduce((n: number, r: any) => n + Number(r.neurons || 0), 0);
    const cost = (month || []).reduce((n: number, r: any) => n + Number(r.cost_usd || 0), 0) +
      (neuronsMonth / 1000) * Number(prices?._neuron_usd_per_1000 ?? 0.011);
    return {
      statusCounts: counts,
      openSuggestions: open ?? 0,
      neuronsToday: (today || []).reduce((n: number, r: any) => n + Number(r.neurons || 0), 0),
      costMonthUsd: Math.round(cost * 10000) / 10000,
      budgetUsd: budget?.monthly_usd ?? null,
      budgetExceeded: budget?.monthly_usd != null && Number(budget.monthly_usd) > 0 && cost >= Number(budget.monthly_usd),
    };
  },

  async list_messages({ sb, body }) {
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const offset = Math.max(Number(body.offset) || 0, 0);
    let q = sb.from("email_messages").select(MESSAGE_LIST_COLUMNS, { count: "exact" });
    if (body.accountId) q = q.eq("account_id", body.accountId);
    if (body.category) q = q.eq("category", body.category);
    if (body.status) q = q.eq("status", body.status);
    if (body.direction) q = q.eq("direction", body.direction);
    if (["weiterleiten_offen", "weitergeleitet", "portal_offen", "portal_erledigt"].includes(body.belegState)) q = q.eq("beleg_state", body.belegState);
    if (body.hero === "mit") q = q.not("hero_project_match_id", "is", null);
    if (body.hero === "ohne") q = q.is("hero_project_match_id", null);
    if (body.from) q = q.gte("sent_at", String(body.from));
    if (body.to) q = q.lte("sent_at", String(body.to));
    const s = likeSafe(String(body.q || ""));
    if (s) q = q.or(`subject.ilike.%${s}%,from_addr.ilike.%${s}%,summary.ilike.%${s}%,from_name.ilike.%${s}%`);
    const { data, error, count } = await q.order("sent_at", { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { messages: data || [], total: count ?? 0 };
  },

  async get_message({ sb, body }) {
    const id = String(body.id || "");
    const { data: msg } = await sb.from("email_messages").select("*").eq("id", id).maybeSingle();
    if (!msg) throw new Error("Mail nicht gefunden.");
    const [{ data: thread }, { data: atts }, { data: shadow }, { data: suggestions }, { data: calls }] = await Promise.all([
      msg.thread_id
        ? sb.from("email_messages").select("id, direction, from_addr, from_name, subject, sent_at, summary, category, body_text, status")
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
    return { message: msg, thread: thread || [], attachments, shadow: shadow || [], suggestions: suggestions || [], calls: calls || [] };
  },

  /** Korrektur eines Menschen: wird gespeichert und fliesst als Beispiel in kuenftige Laeufe. */
  async correct_message({ sb, body }) {
    const id = String(body.id || "");
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
  async set_beleg_state({ sb, body }) {
    const state = String(body.state || "");
    if (!["weiterleiten_offen", "weitergeleitet", "portal_offen", "portal_erledigt"].includes(state)) throw new Error("Unbekannter Stand.");
    must(await sb.from("email_messages").update({ beleg_state: state, ...(state === "weitergeleitet" ? { forwarded_at: new Date().toISOString() } : {}) }).eq("id", String(body.id || "")));
    return { ok: true };
  },

  /** Mail noch einmal durch die Pipeline schicken. */
  async reprocess_message({ sb, body }) {
    must(await sb.from("email_messages").update({ status: "neu", attempts: 0, error: null }).eq("id", String(body.id || "")));
    return { ok: true };
  },

  // ------------------------------------------------------------------ Postfaecher
  async list_accounts({ sb }) {
    const { data } = await sb.from("email_accounts")
      .select("id, label, address, imap_host, imap_port, username, password_enc, folder_map, signature, autopilot, shadow_mode, enabled, backfill, last_sync_at, last_error, locked_until")
      .order("created_at");
    return (data || []).map((a: any) => ({ ...a, password_enc: undefined, has_password: !!a.password_enc, autopilot: normalizeAutopilot(a.autopilot) }));
  },

  async save_account({ sb, body }) {
    const row: Record<string, unknown> = {};
    for (const k of ["label", "address", "imap_host", "username", "signature"] as const) {
      if (body[k] !== undefined) row[k] = String(body[k]).trim();
    }
    if (body.imap_port !== undefined) row.imap_port = Math.min(Math.max(parseInt(body.imap_port, 10) || 993, 1), 65535);
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
    await setConfig(sb, key, body.value);
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
  async list_suggestions({ sb, body }) {
    const status = ["offen", "angenommen", "abgelehnt", "fehlgeschlagen"].includes(body.status) ? body.status : "offen";
    const { data, error } = await sb.from("email_suggestions")
      .select("id, type, payload, status, result, created_at, decided_at, email_messages!inner(id, subject, from_addr, from_name, summary, category, confidence, sent_at, direction, hero_project_match_id, match_info, has_attachments, extracted)")
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

  /** Kurzuebersicht (fuer die Startseite und die optionale 7-Uhr-Push-Meldung). */
  async digest({ sb }) {
    const twoDays = new Date(Date.now() - 2 * 86400_000).toISOString();
    const { count: open } = await sb.from("email_suggestions").select("id", { count: "exact", head: true }).eq("status", "offen");
    const customerCats = ["anfrage_neu", "projekt_kommunikation", "layout_freigabe", "auftrag", "reklamation"];
    const { data: unanswered } = await sb.from("email_messages")
      .select("id, subject, from_name, from_addr, sent_at, category, email_threads!inner(answered)")
      .eq("direction", "in").in("category", customerCats).eq("email_threads.answered", false).lt("sent_at", twoDays)
      .order("sent_at", { ascending: true }).limit(20);
    const { data: claims } = await sb.from("email_messages")
      .select("id, subject, from_name, from_addr, sent_at, email_threads!inner(answered)")
      .eq("direction", "in").eq("category", "reklamation").eq("email_threads.answered", false)
      .order("sent_at", { ascending: true }).limit(20);
    const { data: portal } = await sb.from("email_messages")
      .select("id, subject, from_name, from_addr, sent_at, beleg_vendor").eq("beleg_state", "portal_offen")
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
  const user = await requireAdmin(req, sb);
  if (!user) return fail("Nicht angemeldet oder keine Admin-Rolle.", { code: "unauthorized" });

  const body = await readJson(req);
  const h = handlers[String(body.action || "")];
  if (!h) return fail("Unbekannte Aktion.");
  try {
    return ok(await h({ sb, user, body }));
  } catch (e) {
    return fail(String((e as Error)?.message || e).slice(0, 300));
  }
});
