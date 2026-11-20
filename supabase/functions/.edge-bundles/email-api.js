// supabase/functions/email-api/index.ts
var import_supabase_js = require("@supabase/supabase-js");

// supabase/functions/_shared/email/http.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function ok(data = null) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function fail(error, extra = {}) {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function preflight(req) {
  return req.method === "OPTIONS" ? new Response(null, { status: 204, headers: corsHeaders }) : null;
}
async function sessionProfile(req, sb) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: prof } = await sb.from("profiles").select("display_name, role, is_active").eq("id", data.user.id).maybeSingle();
  if (!prof || prof.is_active === false) return null;
  return { id: data.user.id, email: data.user.email ?? null, name: prof.display_name, role: String(prof.role) };
}
async function requireMailUser(req, sb) {
  const p = await sessionProfile(req, sb);
  if (!p) return null;
  if (p.role === "admin") return { id: p.id, email: p.email, name: p.name, role: "admin", accountIds: null, hiddenCategories: [] };
  if (p.role !== "mitarbeiter") return null;
  const [{ data: rows }, { data: prefs }] = await Promise.all([
    sb.from("email_account_users").select("account_id").eq("user_id", p.id),
    sb.from("email_user_prefs").select("hidden_categories").eq("user_id", p.id).maybeSingle()
  ]);
  const accountIds = (rows || []).map((r) => String(r.account_id));
  if (!accountIds.length) return null;
  const hiddenCategories = Array.isArray(prefs?.hidden_categories) ? prefs.hidden_categories.map(String) : [];
  return { id: p.id, email: p.email, name: p.name, role: "mitarbeiter", accountIds, hiddenCategories };
}
async function readJson(req) {
  try {
    const t2 = await req.text();
    return t2 ? JSON.parse(t2) : {};
  } catch {
    return {};
  }
}

// supabase/functions/_shared/email/access.ts
var AccessError = class extends Error {
};
var DENIED = "Kein Zugriff auf dieses Postfach.";
var HIDDEN = "Diese Kategorie ist f\xFCr dich gesperrt.";
var isMailAdmin = (u) => u.accountIds === null;
function seesCategory(u, category) {
  const h = u.hiddenCategories ?? [];
  return !category || !h.length || !h.includes(category);
}
function visibleTo(users, category) {
  return users.filter((x) => seesCategory(x, category));
}
function normalizeHidden(v, known) {
  return [...new Set((Array.isArray(v) ? v : []).map(String).filter((c) => known.includes(c)))];
}
function scopeCategories(q, u, table) {
  const h = u.hiddenCategories ?? [];
  if (!h.length) return q;
  const f = `category.is.null,category.not.in.(${h.join(",")})`;
  return table ? q.or(f, { referencedTable: table }) : q.or(f);
}
function canAccount(u, accountId) {
  return u.accountIds === null || !!accountId && u.accountIds.includes(String(accountId));
}
function assertAccount(u, accountId) {
  if (!canAccount(u, accountId)) throw new AccessError(DENIED);
}
function assertVisible(u, m) {
  assertAccount(u, m.account_id);
  if (u.accountIds !== null && !seesCategory(u, m.category)) throw new AccessError(HIDDEN);
}
function scopeAccounts(q, u, col = "account_id") {
  return u.accountIds === null ? q : q.in(col, u.accountIds);
}
async function assertMessages(sb, u, ids) {
  if (u.accountIds === null) return;
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return;
  const { data, error } = await sb.from("email_messages").select("id, account_id, category").in("id", list);
  if (error) throw new Error(error.message);
  for (const r of data || []) {
    assertAccount(u, r.account_id);
    if (!seesCategory(u, r.category)) throw new AccessError(HIDDEN);
  }
}
async function assertThread(sb, u, threadId) {
  if (u.accountIds === null || !threadId) return;
  const { data, error } = await sb.from("email_threads").select("account_id").eq("id", String(threadId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) assertAccount(u, data.account_id);
}

// supabase/functions/_shared/email/types.ts
var CATEGORIES = [
  "anfrage_neu",
  "projekt_kommunikation",
  "layout_freigabe",
  "auftrag",
  "reklamation",
  "lieferant",
  "beleg",
  "ausschreibung",
  "verwaltung",
  "newsletter",
  "system",
  "werbung_spam"
];
var INBOX_CATEGORIES = [
  "anfrage_neu",
  "projekt_kommunikation",
  "layout_freigabe",
  "auftrag",
  "reklamation"
];
var AI_TASKS = ["understand", "pick_project", "summarize_out", "draft", "prepare_offer", "prepare_confirmation"];
var AUTOPILOT_ACTIONS = [
  "move_folders",
  "move_discard",
  "move_answered",
  "keywords",
  "log_certain",
  "log_assumed",
  "attachments",
  "draft",
  "create_project",
  "prepare_offer",
  "create_confirmation",
  "status_change",
  "forward_beleg"
];
var AUTOPILOT_DEFAULTS = {
  move_folders: "auto",
  move_discard: "auto",
  move_answered: "auto",
  keywords: "auto",
  log_certain: "auto",
  log_assumed: "suggest",
  attachments: "suggest",
  draft: "auto",
  create_project: "suggest",
  prepare_offer: "suggest",
  // Neue Dokumente in HERO entstehen nur per Klick: „Automatisch" wirkt hier wie „Vorschlag".
  create_confirmation: "suggest",
  status_change: "suggest",
  forward_beleg: "auto"
};
var FREEMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "gmx.de",
  "gmx.net",
  "gmx.at",
  "gmx.ch",
  "web.de",
  "t-online.de",
  "outlook.com",
  "outlook.de",
  "hotmail.com",
  "hotmail.de",
  "live.com",
  "live.de",
  "yahoo.com",
  "yahoo.de",
  "icloud.com",
  "me.com",
  "aol.com",
  "aol.de",
  "freenet.de",
  "posteo.de",
  "mailbox.org",
  "arcor.de",
  "online.de",
  "proton.me",
  "protonmail.com"
];

// supabase/functions/_shared/email/users.ts
var PASSWORD_MIN = 10;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function parseUserInput(body) {
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== void 0 && body[k] !== null;
  const id = has("id") && String(body.id).trim() ? String(body.id).trim() : null;
  const name = has("name") ? String(body.name).trim().slice(0, 80) : null;
  if (name !== null && name.length < 2) throw new Error("Bitte einen Namen eintragen.");
  const email = has("email") ? String(body.email).trim().toLowerCase() : null;
  if (email !== null && !EMAIL_RE.test(email)) throw new Error("Die E-Mail-Adresse ist ung\xFCltig.");
  const password = has("password") && String(body.password) ? String(body.password) : null;
  if (password !== null && password.length < PASSWORD_MIN) throw new Error(`Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`);
  const role = has("role") ? String(body.role) : null;
  if (role !== null && role !== "admin" && role !== "mitarbeiter") throw new Error("Rolle: admin oder mitarbeiter.");
  const active = has("active") ? body.active === true : null;
  const accountIds = has("accountIds") ? [...new Set((Array.isArray(body.accountIds) ? body.accountIds : []).map(String).filter(Boolean))] : null;
  const hiddenCategories = has("hiddenCategories") ? normalizeHidden(body.hiddenCategories, CATEGORIES) : null;
  if (!id) {
    if (!name) throw new Error("Bitte einen Namen eintragen.");
    if (!email) throw new Error("Bitte die E-Mail-Adresse f\xFCr die Anmeldung eintragen.");
    if (!password) throw new Error(`Bitte ein Passwort mit mindestens ${PASSWORD_MIN} Zeichen vergeben.`);
  }
  return { id, name, email: id ? null : email, password, role, active, accountIds, hiddenCategories };
}
function checkUpdate(input, target, self, activeAdmins) {
  if (target.role !== "admin" && target.role !== "mitarbeiter") throw new Error("Dieses Konto ist kein Mitarbeiter-Konto.");
  const isSelf = target.id === self.id;
  if (isSelf && input.role && input.role !== target.role) throw new Error("Die eigene Rolle l\xE4sst sich nicht \xE4ndern.");
  if (isSelf && input.active === false) throw new Error("Das eigene Konto l\xE4sst sich nicht deaktivieren.");
  if (target.employee_id && input.password) throw new Error("Das Passwort dieses Mitarbeiters wird in CaptFix verwaltet.");
  if (target.employee_id && input.active !== null && input.active !== target.is_active) {
    throw new Error("Dieser Mitarbeiter wird in CaptFix aktiviert/deaktiviert. F\xFCr die Mail-App reicht es, die Postf\xE4cher abzuw\xE4hlen.");
  }
  const losesAdmin = target.role === "admin" && target.is_active && (input.role && input.role !== "admin" || input.active === false);
  if (losesAdmin && activeAdmins <= 1) throw new Error("Es muss mindestens ein aktiver Admin bleiben.");
}
function must(r) {
  if (r.error) throw new Error(r.error.message || String(r.error));
  return r.data;
}
async function authEmails(sb) {
  const out = /* @__PURE__ */ new Map();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data?.users || [];
    for (const u of users) out.set(u.id, u.email ?? null);
    if (users.length < 200) break;
  }
  return out;
}
async function listMailUsers(sb, self) {
  const [profiles, links, emails, prefs] = await Promise.all([
    sb.from("profiles").select("id, display_name, role, is_active, employee_id").in("role", ["admin", "mitarbeiter"]).order("display_name"),
    sb.from("email_account_users").select("account_id, user_id"),
    authEmails(sb),
    sb.from("email_user_prefs").select("user_id, hidden_categories")
  ]);
  const hidden = new Map(must(prefs).map((r) => [r.user_id, (r.hidden_categories ?? []).map(String)]));
  const byUser = /* @__PURE__ */ new Map();
  for (const l of must(links)) (byUser.get(l.user_id) ?? byUser.set(l.user_id, []).get(l.user_id)).push(String(l.account_id));
  return must(profiles).map((p) => ({
    id: p.id,
    name: p.display_name,
    email: emails.get(p.id) ?? null,
    role: p.role,
    active: p.is_active !== false,
    captfix: !!p.employee_id,
    accountIds: byUser.get(p.id) ?? [],
    hiddenCategories: hidden.get(p.id) ?? [],
    self: p.id === self.id
  }));
}
async function setAccounts(sb, userId, accountIds) {
  if (accountIds.length) {
    const known = must(await sb.from("email_accounts").select("id").in("id", accountIds)).map((r) => String(r.id));
    if (known.length !== accountIds.length) throw new Error("Unbekanntes Postfach.");
  }
  const current = must(await sb.from("email_account_users").select("account_id").eq("user_id", userId)).map((r) => String(r.account_id));
  const drop = current.filter((a) => !accountIds.includes(a));
  const add = accountIds.filter((a) => !current.includes(a));
  if (drop.length) must(await sb.from("email_account_users").delete().eq("user_id", userId).in("account_id", drop));
  if (add.length) must(await sb.from("email_account_users").insert(add.map((account_id) => ({ account_id, user_id: userId }))));
}
async function setHidden(sb, userId, hiddenCategories) {
  must(await sb.from("email_user_prefs").upsert({ user_id: userId, hidden_categories: hiddenCategories, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "user_id" }));
  audienceCache = null;
}
async function saveMailUser(sb, self, body) {
  const input = parseUserInput(body);
  if (!input.id) {
    const { data, error } = await sb.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { display_name: input.name }
    });
    if (error || !data?.user) {
      const msg = String(error?.message || "");
      throw new Error(/already|registered|exists/i.test(msg) ? "F\xFCr diese E-Mail-Adresse gibt es schon ein Konto." : `Konto anlegen: ${msg || "unbekannter Fehler"}`);
    }
    const id = data.user.id;
    must(await sb.from("profiles").upsert({ id, display_name: input.name, role: input.role ?? "mitarbeiter", is_active: true }, { onConflict: "id" }));
    if (input.accountIds) await setAccounts(sb, id, input.accountIds);
    if (input.hiddenCategories) await setHidden(sb, id, input.hiddenCategories);
    return { id, created: true };
  }
  const target = must(await sb.from("profiles").select("id, role, is_active, employee_id").eq("id", input.id).maybeSingle());
  if (!target) throw new Error("Benutzer nicht gefunden.");
  const { count } = await sb.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("is_active", true);
  checkUpdate(input, target, self, count ?? 0);
  const patch = {};
  if (input.name) patch.display_name = input.name;
  if (input.role) patch.role = input.role;
  if (input.active !== null && !target.employee_id) patch.is_active = input.active;
  if (Object.keys(patch).length) must(await sb.from("profiles").update(patch).eq("id", input.id));
  if (input.password) {
    const { error } = await sb.auth.admin.updateUserById(input.id, { password: input.password });
    if (error) throw new Error(`Passwort: ${error.message}`);
  }
  if (input.accountIds) await setAccounts(sb, input.id, input.accountIds);
  if (input.hiddenCategories) await setHidden(sb, input.id, input.hiddenCategories);
  return { id: input.id, created: false };
}
var audienceCache = null;
var GENERIC_LOCAL = /^(info|kontakt|contact|office|post|mail|service|team|hallo|hello|buero|buchhaltung|rechnung|rechnungen|einkauf|verkauf|anfrage|anfragen|auftrag|bestellung|support|noreply|no-reply)$/;
function personalEmails(userId, emails, mailboxes) {
  const out = /* @__PURE__ */ new Set();
  for (const raw of emails) {
    const e = String(raw || "").trim().toLowerCase();
    if (!e.includes("@") || GENERIC_LOCAL.test(e.split("@")[0])) continue;
    const box = mailboxes.find((b) => b.address.toLowerCase() === e);
    if (box && !(box.assignees.length === 1 && box.assignees[0] === userId)) continue;
    out.add(e);
  }
  return [...out];
}
async function mailAudience(sb) {
  if (audienceCache && Date.now() - audienceCache.at < 3e5) return audienceCache.value;
  const [profiles, links, accounts, emails, prefs] = await Promise.all([
    sb.from("profiles").select("id, display_name, role, is_active, employees(email)").in("role", ["admin", "mitarbeiter"]).eq("is_active", true),
    sb.from("email_account_users").select("account_id, user_id"),
    sb.from("email_accounts").select("id, address, username"),
    authEmails(sb).catch(() => /* @__PURE__ */ new Map()),
    sb.from("email_user_prefs").select("user_id, hidden_categories")
  ]);
  const hidden = new Map((prefs?.data ?? []).map((r) => [r.user_id, (r.hidden_categories ?? []).map(String)]));
  const linkRows = must(links);
  const mailboxes = must(accounts).flatMap((a) => {
    const assignees = linkRows.filter((l) => l.account_id === a.id).map((l) => String(l.user_id));
    return [a.address, a.username].filter((x) => x && String(x).includes("@")).map((address) => ({ address, assignees }));
  });
  const people = /* @__PURE__ */ new Map();
  for (const p of must(profiles)) {
    const mails = personalEmails(p.id, [emails.get(p.id), p.employees?.email].filter(Boolean), mailboxes);
    const admin = p.role === "admin";
    const user = { id: p.id, name: String(p.display_name || ""), emails: mails, hiddenCategories: admin ? [] : hidden.get(p.id) ?? [] };
    people.set(p.id, { user, admin });
  }
  const out = /* @__PURE__ */ new Map();
  for (const a of must(accounts)) out.set(a.id, [...people.values()].filter((x) => x.admin).map((x) => x.user));
  for (const l of linkRows) {
    const p = people.get(l.user_id);
    const list = out.get(l.account_id);
    if (p && list && !list.some((u) => u.id === p.user.id)) list.push(p.user);
  }
  audienceCache = { at: Date.now(), value: out };
  return out;
}

// supabase/functions/_shared/email/addressee.ts
var L = "\\p{Lu}[\\p{L}'-]+";
var GREETING = new RegExp(
  `^\\s*(?:hallo|hi|hey|moin|servus|gr(?:\xFC|ue)(?:\xDF|ss) (?:dich|gott)|guten (?:morgen|tag|abend)|liebe[rs]?|sehr geehrte[rs]?)[,!]?\\s+(?:herr(?:n)?\\s+|frau\\s+)?(${L})(?:\\s+(${L}))?`,
  "imu"
);
var ATTN = new RegExp(`(?:z\\.?\\s?hd\\.?|zu h(?:\xE4|ae)nden(?: von)?|attn\\.?|attention)\\s*:?\\s*(?:herr(?:n)?\\s+|frau\\s+)?(${L})(?:\\s+(${L}))?`, "iu");
var norm = (s) => s.toLowerCase().normalize("NFC");
var parts = (name) => norm(name).split(/[\s-]+/).filter((w) => w.length >= 2);
function byNames(words, users) {
  const ws = words.map(norm).filter((w) => w.length >= 2);
  if (!ws.length) return null;
  const hits = users.filter((u) => {
    const p = parts(u.name);
    return p.length > 0 && ws.every((w) => p.includes(w));
  });
  return hits.length === 1 ? hits[0] : null;
}
function addresseeOf(m, users) {
  if (users.length < 2) return null;
  const to = (m.to_addrs ?? []).map((a) => norm(a));
  const byMail = users.filter((u) => u.emails.some((e) => to.includes(norm(e))));
  if (byMail.length === 1) return byMail[0];
  if (byMail.length > 1) return null;
  const head = String(m.body_text ?? "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim()).slice(0, 4).join("\n");
  for (const re of [GREETING, ATTN]) {
    for (const src of [head, re === ATTN ? String(m.subject ?? "") : ""]) {
      const g = src ? src.match(re) : null;
      if (!g) continue;
      const one = byNames([g[1], g[2]].filter(Boolean), users) ?? (g[2] ? byNames([g[1]], users) : null);
      if (one) return one;
    }
  }
  return null;
}

// supabase/functions/_shared/email/crypto.ts
var enc = new TextEncoder();
var dec = new TextDecoder();
function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function importKey(secret) {
  if (!secret || secret.length < 32) {
    throw new Error(
      "EMAIL_ENCRYPTION_KEY fehlt oder ist zu kurz (mind. 32 Zeichen). Erzeugen mit: openssl rand -hex 32"
    );
  }
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptSecret(plain, secret) {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));
  return `v1:${toB64(iv)}:${toB64(ct)}`;
}

// supabase/functions/_shared/email/config.ts
async function getConfig(sb, key, fallback) {
  const { data } = await sb.from("email_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? fallback;
}
async function setConfig(sb, key, value) {
  const { error } = await sb.from("email_config").upsert({ key, value, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
  if (error) throw new Error(error.message);
}
var encryptionKey = () => globalThis.Deno?.env?.get("EMAIL_ENCRYPTION_KEY");

// supabase/functions/_shared/email/topics.ts
var TOPIC_DEFAULTS = { skip_categories: ["werbung_spam", "newsletter"], unanswered_days: 2, followup_days: 7 };
var days = (v, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 90 ? n : def;
};
function normalizeTopicConfig(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    skip_categories: Array.isArray(r.skip_categories) ? r.skip_categories.map(String).slice(0, 20) : TOPIC_DEFAULTS.skip_categories,
    unanswered_days: days(r.unanswered_days, TOPIC_DEFAULTS.unanswered_days),
    followup_days: days(r.followup_days, TOPIC_DEFAULTS.followup_days)
  };
}
function isRelevant(m, cfg) {
  if (m.direction !== "in") return false;
  if (m.category == null) return m.status === "fehler";
  if (cfg.skip_categories.includes(m.category)) return false;
  return m.beleg_state !== "weitergeleitet";
}
var isCustomerCategory = (c) => !!c && INBOX_CATEGORIES.includes(c);
var DAY = 864e5;
var t = (s) => s ? Date.parse(s) : NaN;
var maxTime = (...xs) => Math.max(...xs.map(t).filter((n) => !Number.isNaN(n)), 0);
function topicStatus(f, cfg, now) {
  const nowMs = now.getTime();
  if (f.undecided > 0) {
    return { due: true, reason: f.state === "erledigt" && f.hadDecided ? "wieder_offen" : "neu", nextCheck: null, days: null };
  }
  if (f.state === "erledigt") return { due: false, reason: null, nextCheck: null, days: null };
  if (f.state === "wiedervorlage") {
    const until = t(f.snoozedUntil);
    if (Number.isNaN(until) || until <= nowMs) return { due: true, reason: "wiedervorlage", nextCheck: f.snoozedUntil, days: null };
    return { due: false, reason: null, nextCheck: f.snoozedUntil, days: null };
  }
  if (f.openSuggestions > 0) return { due: true, reason: "vorschlag", nextCheck: null, days: null };
  const unanswered = f.customer && t(f.lastIn) > (t(f.lastOut) || 0);
  const limit = unanswered ? cfg.unanswered_days : cfg.followup_days;
  const quietSince = unanswered ? t(f.lastIn) : maxTime(f.lastIn, f.lastOut);
  const anchor = Math.max(quietSince || 0, t(f.reviewedAt) || 0);
  if (!anchor) return { due: false, reason: null, nextCheck: null, days: null };
  const next = anchor + limit * DAY;
  const quietDays = Math.floor((nowMs - (quietSince || anchor)) / DAY);
  if (next <= nowMs) return { due: true, reason: unanswered ? "unbeantwortet" : "nachfassen", nextCheck: new Date(next).toISOString(), days: quietDays };
  return { due: false, reason: null, nextCheck: new Date(next).toISOString(), days: null };
}
function validSnoozeDate(date, today) {
  const d = String(date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T12:00:00Z`))) return null;
  if (d <= today) return null;
  const max = new Date(Date.parse(`${today}T12:00:00Z`) + 730 * DAY).toISOString().slice(0, 10);
  return d > max ? null : d;
}
function reasonText(s, note) {
  switch (s.reason) {
    case "unbeantwortet":
      return `Kundenmail seit ${s.days ?? "?"} Tagen unbeantwortet`;
    case "nachfassen":
      return `Seit ${s.days ?? "?"} Tagen keine Bewegung \u2013 nachfassen oder abschlie\xDFen?`;
    case "wiedervorlage":
      return note ? `Wiedervorlage: ${note}` : "Wiedervorlage";
    case "wieder_offen":
      return "Neue Mail in einem abgeschlossenen Thema";
    case "vorschlag":
      return "Vorschlag offen";
    case "neu":
      return "Neue Mail";
    default:
      return "";
  }
}

// supabase/functions/_shared/email/webpush.ts
var enc2 = new TextEncoder();
function b64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const t2 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t2 + "=".repeat((4 - (t2.length % 4 || 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts2) {
  const out = new Uint8Array(parts2.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts2) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
async function generateVapid(subject) {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { publicKey: b64url(pub), privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey), subject };
}
async function vapidAuth(endpoint, keys, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc2.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc2.encode(JSON.stringify({ aud, exp: Math.floor(now / 1e3) + 12 * 3600, sub: keys.subject })));
  const key = await crypto.subtle.importKey("jwk", { ...keys.privateJwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc2.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}
async function encryptPayload(sub, payload, opts = {}) {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("Ung\xFCltiges Push-Abo (Schl\xFCssel).");
  const server = opts.serverKeys ?? await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", server.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, server.privateKey, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc2.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc2.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc2.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}
var MAX_PAYLOAD_BYTES = 3e3;
async function sendPush(sub, data, keys, fetchImpl = fetch, opts = {}) {
  const body = enc2.encode(JSON.stringify(data));
  if (body.length > MAX_PAYLOAD_BYTES) throw new Error("Push-Nachricht zu gro\xDF.");
  const cipher = await encryptPayload(sub, body);
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuth(sub.endpoint, keys),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttl ?? 24 * 3600),
        Urgency: opts.urgency ?? "normal"
      },
      body: cipher
    });
    if (res.ok) return { ok: true };
    const text = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, gone: res.status === 404 || res.status === 410, status: res.status, error: text || res.statusText };
  } catch (e) {
    return { ok: false, gone: false, status: 0, error: String(e?.message || e).slice(0, 200) };
  }
}
var PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/
];
function isPushEndpoint(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

// supabase/functions/_shared/email/push.ts
var DEFAULT_PREFS = { decide: true, incoming: false };
var VAPID_KEY = "push_vapid";
async function loadVapid(sb) {
  const have = await getConfig(sb, VAPID_KEY, null);
  if (have?.publicKey && have.privateJwk) return have;
  const { data: acc } = await sb.from("email_accounts").select("address").order("created_at").limit(1).maybeSingle();
  const fresh = await generateVapid(`mailto:${acc?.address || "notifications@captfix.app"}`);
  const { error } = await sb.from("email_config").insert({ key: VAPID_KEY, value: fresh, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  const stored = await getConfig(sb, VAPID_KEY, null);
  if (!stored?.publicKey) {
    await setConfig(sb, VAPID_KEY, fresh);
    return fresh;
  }
  return stored;
}
async function loadPrefs(sb, userIds) {
  const out = /* @__PURE__ */ new Map();
  if (!userIds.length) return out;
  const { data } = await sb.from("email_user_prefs").select("user_id, push_decide, push_incoming").in("user_id", userIds);
  for (const r of data || []) out.set(r.user_id, { decide: r.push_decide !== false, incoming: r.push_incoming === true });
  return out;
}
async function pushToUser(sb, userId, payload, keys) {
  const { data: subs } = await sb.from("email_push_subscriptions").select("id, endpoint, p256dh, auth, failures").eq("user_id", userId);
  let sent = 0, failed = 0;
  for (const s of subs || []) {
    const r = await sendPush(s, payload, keys, fetch, { urgency: "high" });
    if (r.ok) {
      sent++;
      await sb.from("email_push_subscriptions").update({ last_ok_at: (/* @__PURE__ */ new Date()).toISOString(), failures: 0 }).eq("id", s.id);
    } else {
      failed++;
      if (r.gone || s.failures >= 20) await sb.from("email_push_subscriptions").delete().eq("id", s.id);
      else await sb.from("email_push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
    }
  }
  return { sent, failed };
}

// supabase/functions/_shared/email/autopilot.ts
function normalizeAutopilot(raw) {
  const out = { ...AUTOPILOT_DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const k of AUTOPILOT_ACTIONS) {
      const v = raw[k];
      if (v === "off" || v === "suggest" || v === "auto") out[k] = v;
    }
  }
  return out;
}

// supabase/functions/_shared/email/hero.ts
var HERO_GRAPHQL = "https://login.hero-software.de/api/external/v9/graphql";
var HeroError = class extends Error {
};
async function heroGraphql(apiKey, query, variables = {}, fetchImpl = fetch) {
  const resp = await fetchImpl(HERO_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(3e4)
  });
  const text = await resp.text();
  if (!resp.ok) throw new HeroError(`HERO HTTP ${resp.status}: ${text.slice(0, 200)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HeroError(`HERO lieferte kein JSON: ${text.slice(0, 120)}`);
  }
  if (json.errors?.length) throw new HeroError(String(json.errors[0]?.message || "HERO GraphQL-Fehler"));
  return json.data;
}
async function loadHeroKey(sb) {
  const { data } = await sb.from("app_config").select("key, value").in("key", ["hero_api_key", "hero_enabled"]);
  const m = new Map((data || []).map((r) => [r.key, r.value]));
  const key = m.get("hero_api_key");
  return key && m.get("hero_enabled") === "true" ? key : null;
}
var PROJECT_FIELDS = `
  id project_nr name
  current_project_match_status { step_id step { name } }
  customer { id first_name last_name company_name }
`;
function customerName(c) {
  if (!c) return "";
  return String(c.company_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "").trim();
}
function toProject(pm) {
  return {
    id: Number(pm.id),
    nr: String(pm.project_nr || ""),
    name: String(pm.name || ""),
    stepId: pm.current_project_match_status?.step_id != null ? Number(pm.current_project_match_status.step_id) : null,
    stepName: pm.current_project_match_status?.step?.name ?? null,
    customerId: pm.customer?.id != null ? Number(pm.customer.id) : null,
    customerName: customerName(pm.customer)
  };
}
async function projectByNumber(apiKey, relativeId, fetchImpl = fetch) {
  const data = await heroGraphql(apiKey, `query($nr: String) { project_matches(relative_id: $nr) { ${PROJECT_FIELDS} } }`, { nr: String(relativeId) }, fetchImpl);
  const pm = data?.project_matches?.[0];
  return pm?.id ? toProject(pm) : null;
}
async function projectById(apiKey, id, fetchImpl = fetch) {
  const data = await heroGraphql(apiKey, `query($ids: [Int]) { project_matches(ids: $ids) { ${PROJECT_FIELDS} } }`, { ids: [id] }, fetchImpl);
  const pm = data?.project_matches?.[0];
  return pm?.id ? toProject(pm) : null;
}
async function searchProjects(apiKey, term, fetchImpl = fetch) {
  const data = await heroGraphql(apiKey, `query($s: String) { project_matches(search: $s, first: 20) { ${PROJECT_FIELDS} } }`, { s: term }, fetchImpl);
  return (data?.project_matches || []).map(toProject);
}
var DOCUMENT_MAIL_CONTEXT = { confirmation: "CUSTOMER_DOCUMENT_CONFIRMATION", offer: "CUSTOMER_DOCUMENT_OFFER" };
var DOC_FIELDS = `id nr date status_code status_name value project_match { id project_nr } document_type { base_type } file_upload { uuid }`;
function toDocument(d) {
  return {
    id: Number(d.id),
    nr: String(d.nr ?? ""),
    date: d.date ?? null,
    statusCode: Number(d.status_code ?? 0),
    statusName: String(d.status_name ?? ""),
    value: d.value != null && Number.isFinite(Number(d.value)) ? Number(d.value) : null,
    projectId: d.project_match?.id != null ? Number(d.project_match.id) : null,
    projectNr: d.project_match?.project_nr ?? null,
    baseType: d.document_type?.base_type ?? null,
    fileUuid: d.file_upload?.uuid ?? null,
    draft: d.published_customer_document_draft?.data ?? null
  };
}
async function documentById(apiKey, id, fetchImpl = fetch) {
  const data = await heroGraphql(apiKey, `query($ids: [Int]) { customer_documents(ids: $ids) { ${DOC_FIELDS} } }`, { ids: [id] }, fetchImpl);
  const d = data?.customer_documents?.[0];
  return d?.id ? toDocument(d) : null;
}
async function emailTemplates(apiKey, context, fetchImpl = fetch) {
  const data = await heroGraphql(apiKey, `query { EmailTemplate_EmailTemplates(first: 200) { edges { node { id name context } } } }`, {}, fetchImpl);
  return (data?.EmailTemplate_EmailTemplates?.edges || []).map((e) => e.node).filter((n) => n?.context === context).map((n) => ({ id: Number(n.id), name: String(n.name) }));
}
function pickTemplate(templates, formality) {
  const want = formality === "du" ? /PER DU/i : /PER SIE/i;
  return templates.find((t2) => want.test(t2.name) && !/kopie/i.test(t2.name)) ?? templates.find((t2) => !/kopie/i.test(t2.name)) ?? templates[0] ?? null;
}
async function projectSteps(apiKey, typeId, fetchImpl = fetch) {
  const data = await heroGraphql(apiKey, `query { project_types { id name project_status_steps { id name } } }`, {}, fetchImpl);
  const types = data?.project_types || [];
  const t2 = types.find((x) => Number(x.id) === Number(typeId)) ?? types.find((x) => /^projekt$/i.test(String(x.name).trim()));
  return (t2?.project_status_steps || []).map((s) => ({ id: Number(s.id), name: String(s.name || "").trim() })).filter((s) => s.id > 0);
}

// supabase/functions/_shared/email/learn.ts
function learnedCategory(feedbackNewestFirst) {
  const [a, b] = feedbackNewestFirst;
  if (!a || !b || !a.new_value || a.new_value !== b.new_value) return null;
  return CATEGORIES.includes(a.new_value) ? a.new_value : null;
}
async function learnRule(fromAddr, store) {
  const pattern = String(fromAddr || "").trim().toLowerCase();
  if (!pattern || !pattern.includes("@")) return null;
  const category = learnedCategory(await store.recentCategoryFeedback(pattern, 2));
  if (!category) return null;
  const existing = await store.existingRule(pattern);
  if (existing && (existing.source !== "gelernt" || existing.category === category)) return null;
  await store.saveRule(pattern, category);
  return { pattern, category };
}

// supabase/functions/_shared/email/heroReload.ts
function normalizeName(n) {
  return String(n || "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9äöü ]+/g, " ").replace(/\s+/g, " ").trim();
}
var STEP_PATTERNS = {
  angebot: "angeboterstellung",
  vor_ort: "vor ort termin",
  detailgespraech: "detailgespr",
  projektplanung: "projektplanung",
  visualisierung: "visualisierung",
  materialbestellung: "materialbestellung",
  produktionsdaten: "produktionsdaten",
  reklamation: "reklamation",
  warten_auftrag: "warten auf auftrag",
  warten_layout: "warten auf layoutfreigabe",
  warten_ware: "warten auf ware"
};
var EXCLUDED_PATTERNS = ["warten auf bezahlung", "abgeschlossen", "archiviert"];
function mapSteps(steps) {
  const out = {};
  const excluded = [];
  const norm2 = steps.map((s) => ({ id: Number(s.id), n: normalizeName(s.name) }));
  for (const [key, pat] of Object.entries(STEP_PATTERNS)) {
    const hit = norm2.find((s) => s.n.includes(pat));
    if (hit) out[key] = hit.id;
  }
  for (const pat of EXCLUDED_PATTERNS) {
    const hit = norm2.find((s) => s.n.includes(pat));
    if (hit) excluded.push(hit.id);
  }
  const missing = [
    ...Object.keys(STEP_PATTERNS).filter((k) => out[k] == null),
    ...EXCLUDED_PATTERNS.filter((p) => !norm2.some((s) => s.n.includes(p)))
  ];
  return { steps: out, excluded, missing };
}
var DOC_PATTERNS = {
  layouts: "plan layout",
  aufmasse: "aufmassdokument",
  druckdaten: "druckdaten"
};
function mapDocumentTypes(types) {
  const norm2 = types.map((t2) => ({ id: Number(t2.id), n: normalizeName(t2.name) }));
  const found = {};
  for (const [key, pat] of Object.entries(DOC_PATTERNS)) {
    const hit = norm2.find((t2) => t2.n === pat) ?? norm2.find((t2) => t2.n.includes(pat));
    if (hit) found[key] = hit.id;
  }
  const offer = norm2.find((t2) => t2.n === "angebot");
  const confirmation = norm2.find((t2) => t2.n.startsWith("auftragsbest"));
  return { found, offerTypeId: offer?.id ?? null, confirmationTypeId: confirmation?.id ?? null };
}

// supabase/functions/_shared/email/mail.ts
var MIN_ATTACHMENT_BYTES = 10 * 1024;
function emailDomain(addr) {
  const at = String(addr || "").lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).toLowerCase().trim() : "";
}
function matchesPattern(addr, pattern) {
  const a = String(addr || "").toLowerCase().trim();
  const p = String(pattern || "").toLowerCase().trim();
  if (!a || !p) return false;
  if (p.startsWith("@")) {
    const dom = p.slice(1);
    const ad = emailDomain(a);
    return ad === dom || ad.endsWith("." + dom);
  }
  return a === p;
}
var TRACKING_PIXEL_BYTES = 2 * 1024;
var INLINE_IMAGE_HIDE_BYTES = 25 * 1024;

// supabase/functions/_shared/email/classify.ts
var import_zod = require("zod");

// supabase/functions/_shared/email/knowledge.ts
var KNOWLEDGE_TEXT_MAX = 1e3;
function patternForScope(scope, fromAddr) {
  const addr = String(fromAddr || "").trim().toLowerCase();
  if (scope === "alle") return null;
  if (scope === "absender") {
    if (!addr.includes("@")) throw new Error("Die Mail hat keine Absenderadresse.");
    return addr;
  }
  if (scope === "domain") {
    const dom = emailDomain(addr);
    if (!dom) throw new Error("Die Mail hat keine Absenderadresse.");
    if (FREEMAIL_DOMAINS.includes(dom)) throw new Error(`@${dom} ist ein Freemail-Anbieter \u2013 bitte \u201Enur dieser Absender\u201C w\xE4hlen.`);
    return `@${dom}`;
  }
  return void 0;
}
function normalizePattern(p) {
  const s = String(p ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^@[^\s@]+\.[^\s@]+$|^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error("Absender: Adresse (a@b.de) oder Domain (@b.de) \u2013 oder leer f\xFCr alle Mails.");
  return s;
}

// supabase/functions/_shared/email/classify.ts
var SERVICES = [
  "Fahrzeugbeschriftung",
  "Schilder",
  "Leitsystem",
  "Folierung",
  "Digitaldruck",
  "Textildruck",
  "Splitterschutz",
  "Montage",
  "Sonstiges"
];
var SIGNALS = ["layout_freigegeben", "layout_korrektur", "angebot_angenommen", "druckdaten_geliefert", "mangel"];
var BELEG_DELIVERY = ["anhang", "portal", "keine"];
var ATTACHMENT_ROLES = ["logo", "foto", "fahrzeugbild", "skizze", "druckdaten", "rechnung", "sonstiges"];
var str = import_zod.z.string().nullish().transform((v) => v == null || v === "" ? null : String(v));
var conf = import_zod.z.coerce.number().min(0).max(1);
var UnderstandSchema = import_zod.z.object({
  category: import_zod.z.enum(CATEGORIES),
  category_confidence: conf,
  contact: import_zod.z.object({
    salutation: str,
    first_name: str,
    last_name: str,
    company: str,
    email: str,
    phone: str,
    street: str,
    zip: str,
    city: str,
    formality: import_zod.z.enum(["du", "sie"]).nullish().transform((v) => v ?? null)
  }),
  request: import_zod.z.object({
    summary: import_zod.z.string().min(1),
    service: import_zod.z.enum(SERVICES).nullish().transform((v) => v ?? null),
    dimensions: str,
    quantity: str,
    material: str,
    location: str,
    /** Vorschlag fuer den HERO-Projektnamen, z. B. „Fahrzeugbeschriftung VW Crafter". */
    project_name: str
  }),
  /** Buchungsrelevanter Beleg? Und wie kommt man an ihn heran (Anhang oder nur ueber ein Kundenportal)? */
  beleg: import_zod.z.object({
    is_booking_document: import_zod.z.boolean().catch(false),
    delivery: import_zod.z.enum(BELEG_DELIVERY).catch("keine"),
    vendor: str
  }).catch({ is_booking_document: false, delivery: "keine", vendor: null }),
  /** Klares Signal fuer einen Statuswechsel in HERO – nur setzen, wenn es eindeutig in der Mail steht. */
  signal: import_zod.z.enum(SIGNALS).nullish().transform((v) => v ?? null),
  dates: import_zod.z.object({
    wish_date: str,
    deadline: str,
    urgency: import_zod.z.enum(["niedrig", "normal", "hoch"]).catch("normal")
  }),
  references: import_zod.z.object({
    project_numbers: import_zod.z.array(import_zod.z.string()).catch([]),
    offer_numbers: import_zod.z.array(import_zod.z.string()).catch([]),
    earlier_orders: str
  }),
  attachments: import_zod.z.array(import_zod.z.object({
    filename: import_zod.z.string(),
    role: import_zod.z.enum(ATTACHMENT_ROLES).catch("sonstiges")
  })).catch([]),
  reply: import_zod.z.object({ needed: import_zod.z.boolean(), reason: import_zod.z.string().catch("") }),
  field_confidence: import_zod.z.object({
    contact: conf.catch(0.5),
    request: conf.catch(0.5),
    dates: conf.catch(0.5),
    references: conf.catch(0.5)
  })
});
var sNull = { type: ["string", "null"] };
var UNDERSTAND_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "category_confidence", "contact", "request", "beleg", "signal", "dates", "references", "attachments", "reply", "field_confidence"],
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    category_confidence: { type: "number", minimum: 0, maximum: 1 },
    contact: {
      type: "object",
      additionalProperties: false,
      required: ["salutation", "first_name", "last_name", "company", "email", "phone", "street", "zip", "city", "formality"],
      properties: {
        salutation: sNull,
        first_name: sNull,
        last_name: sNull,
        company: sNull,
        email: sNull,
        phone: sNull,
        street: sNull,
        zip: sNull,
        city: sNull,
        formality: { type: ["string", "null"], enum: ["du", "sie", null] }
      }
    },
    request: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "service", "dimensions", "quantity", "material", "location", "project_name"],
      properties: {
        summary: { type: "string" },
        service: { type: ["string", "null"], enum: [...SERVICES, null] },
        dimensions: sNull,
        quantity: sNull,
        material: sNull,
        location: sNull,
        project_name: sNull
      }
    },
    beleg: {
      type: "object",
      additionalProperties: false,
      required: ["is_booking_document", "delivery", "vendor"],
      properties: {
        is_booking_document: { type: "boolean" },
        delivery: { type: "string", enum: [...BELEG_DELIVERY] },
        vendor: sNull
      }
    },
    signal: { type: ["string", "null"], enum: [...SIGNALS, null] },
    dates: {
      type: "object",
      additionalProperties: false,
      required: ["wish_date", "deadline", "urgency"],
      properties: { wish_date: sNull, deadline: sNull, urgency: { type: "string", enum: ["niedrig", "normal", "hoch"] } }
    },
    references: {
      type: "object",
      additionalProperties: false,
      required: ["project_numbers", "offer_numbers", "earlier_orders"],
      properties: {
        project_numbers: { type: "array", items: { type: "string" } },
        offer_numbers: { type: "array", items: { type: "string" } },
        earlier_orders: sNull
      }
    },
    attachments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["filename", "role"],
        properties: { filename: { type: "string" }, role: { type: "string", enum: [...ATTACHMENT_ROLES] } }
      }
    },
    reply: {
      type: "object",
      additionalProperties: false,
      required: ["needed", "reason"],
      properties: { needed: { type: "boolean" }, reason: { type: "string" } }
    },
    field_confidence: {
      type: "object",
      additionalProperties: false,
      required: ["contact", "request", "dates", "references"],
      properties: {
        contact: { type: "number", minimum: 0, maximum: 1 },
        request: { type: "number", minimum: 0, maximum: 1 },
        dates: { type: "number", minimum: 0, maximum: 1 },
        references: { type: "number", minimum: 0, maximum: 1 }
      }
    }
  }
};

// supabase/functions/_shared/email/store.ts
var REFERENCE_DOC_MAX = 2e5;

// supabase/functions/_shared/email/instruct.ts
var import_zod3 = require("zod");

// supabase/functions/_shared/email/heroOps.ts
var import_zod2 = require("zod");
var OP_KINDS = [
  "ansprechpartner_anlegen",
  "kontakt_aendern",
  "adresse_anlegen",
  "projekt_aendern",
  "status_setzen",
  "mitarbeiter_zuweisen",
  "aufgabe_anlegen",
  "logbuch_notiz"
];
var MAX_OPS = 10;
var str2 = import_zod2.z.string().nullish().transform((v) => v == null ? null : String(v).trim() || null);
var ActionSchema = import_zod2.z.object({
  op: import_zod2.z.enum(OP_KINDS),
  /** vorhandener Kontakt: Name oder E-Mail eines Ansprechpartners, „Absender“ oder „Kunde“ */
  contact: str2,
  salutation: str2,
  first_name: str2,
  last_name: str2,
  email: str2,
  phone: str2,
  mobile: str2,
  position: str2,
  street: str2,
  zip: str2,
  city: str2,
  label: str2,
  project_name: str2,
  note: str2,
  /** Mitarbeiter (Name aus der Liste) */
  person: str2,
  /** Projektschritt (Name aus der Liste) */
  step: str2,
  title: str2,
  due_date: str2
});
var S = { type: ["string", "null"] };
var ACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["op", "contact", "salutation", "first_name", "last_name", "email", "phone", "mobile", "position", "street", "zip", "city", "label", "project_name", "note", "person", "step", "title", "due_date"],
  properties: {
    op: { type: "string", enum: [...OP_KINDS] },
    contact: S,
    salutation: S,
    first_name: S,
    last_name: S,
    email: S,
    phone: S,
    mobile: S,
    position: S,
    street: S,
    zip: S,
    city: S,
    label: S,
    project_name: S,
    note: S,
    person: S,
    step: S,
    title: S,
    due_date: S
  }
};
var OPS_PROMPT = [
  "- actions: weitere HERO-Aktionen, je Aktion ein Eintrag (nur wenn die Anweisung sie verlangt):",
  "  ansprechpartner_anlegen = neuen Ansprechpartner beim Kunden anlegen (salutation Herr/Frau, first_name, last_name, email, phone, mobile, position; Daten aus Anweisung oder Mail-Signatur);",
  "  kontakt_aendern = Kontaktdaten eines vorhandenen Kontakts \xE4ndern (contact = wer: Name/E-Mail eines Ansprechpartners, \u201EAbsender\u201C oder \u201EKunde\u201C; nur die ge\xE4nderten Felder);",
  "  adresse_anlegen = weitere Adresse beim Kunden (label z. B. \u201ELieferadresse\u201C, street, zip, city);",
  "  projekt_aendern = Projektname (project_name) und/oder Ansprechpartner am Projekt (contact);",
  "  status_setzen = Projektschritt wechseln (step = Name aus der Schrittliste);",
  "  mitarbeiter_zuweisen = Mitarbeiter dem Projekt zuweisen (person);",
  "  aufgabe_anlegen = Aufgabe (title, note, person = f\xFCr wen, due_date YYYY-MM-DD);",
  "  logbuch_notiz = Notiz ins Projekt-Logbuch (note).",
  "  Alles, was daf\xFCr nicht genannt ist, = null. Nichts erfinden: Telefonnummern, Adressen usw. nur aus Anweisung oder Mail."
].join("\n");

// supabase/functions/_shared/email/instruct.ts
var TZ = "Europe/Berlin";
var MAX_APPOINTMENTS = 6;
var InstructionSchema = import_zod3.z.object({
  project: import_zod3.z.object({
    action: import_zod3.z.enum(["neu", "bestehend", "unveraendert"]).catch("unveraendert"),
    project_nr: import_zod3.z.string().nullish().transform((v) => v ?? null),
    name: import_zod3.z.string().nullish().transform((v) => v ?? null)
  }).catch({ action: "unveraendert", project_nr: null, name: null }),
  /** Was die Anweisung ueber den Kontakt sagt: „vorhanden“ = gibt es in HERO schon (dann NIE ein neuer Kontakt). */
  contact: import_zod3.z.enum(["vorhanden", "neu", "unklar"]).catch("unklar"),
  customer_hint: import_zod3.z.string().nullish().transform((v) => v ?? null),
  offer: import_zod3.z.boolean().catch(false),
  /** Auftragsbestaetigung aus dem Angebot im Projekt („Angebot in AB wandeln“) */
  confirmation: import_zod3.z.boolean().catch(false),
  appointments: import_zod3.z.array(import_zod3.z.object({
    category: import_zod3.z.string().nullish().transform((v) => v ?? null),
    date: import_zod3.z.string().nullish().transform((v) => v ?? null),
    time: import_zod3.z.string().nullish().transform((v) => v ?? null),
    duration_min: import_zod3.z.coerce.number().nullish().transform((v) => v ?? null),
    title: import_zod3.z.string().nullish().transform((v) => v ?? null),
    person: import_zod3.z.string().nullish().transform((v) => v ?? null)
  }).catch(null)).catch([]).transform((a) => a.filter(Boolean).slice(0, MAX_APPOINTMENTS)),
  actions: import_zod3.z.array(ActionSchema.catch(null)).catch([]).transform((a) => a.filter(Boolean).slice(0, MAX_OPS)),
  /** Anhaenge der Mail ans HERO-Projekt und/oder in den Dropbox-Projektordner */
  files: import_zod3.z.object({
    hero: import_zod3.z.boolean().catch(false),
    dropbox: import_zod3.z.boolean().catch(false),
    subfolder: import_zod3.z.string().nullish().transform((v) => v ?? null)
  }).catch({ hero: false, dropbox: false, subfolder: null }),
  /** Thema abschliessen oder auf Wiedervorlage legen */
  topic: import_zod3.z.object({
    action: import_zod3.z.enum(["keine", "erledigt", "wiedervorlage"]).catch("keine"),
    date: import_zod3.z.string().nullish().transform((v) => v ?? null),
    note: import_zod3.z.string().nullish().transform((v) => v ?? null)
  }).catch({ action: "keine", date: null, note: null }),
  not_doable: import_zod3.z.array(import_zod3.z.string()).catch([]),
  summary: import_zod3.z.string().catch("")
});
function berlinToIso(date, time) {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const parts2 = {};
  for (const p of new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(guess))) parts2[p.type] = p.value;
  const wall = Date.parse(`${parts2.year}-${parts2.month}-${parts2.day}T${parts2.hour}:${parts2.minute}:00Z`);
  return new Date(guess - (wall - guess)).toISOString();
}
var berlinToday = (now = /* @__PURE__ */ new Date()) => now.toLocaleDateString("sv-SE", { timeZone: TZ });

// supabase/functions/_shared/email/topicsDb.ts
var MSG_COLS = "id, account_id, thread_id, direction, from_name, from_addr, subject, sent_at, created_at, summary, category, status, beleg_state, has_attachments, decided_at, hero_project_match_id, match_info";
var CHUNK = 80;
function must2(r) {
  if (r.error) throw new Error(r.error.message || String(r.error));
  return r.data;
}
var chunks = (xs) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
async function loadTopicConfig(sb) {
  return normalizeTopicConfig(await getConfig(sb, "topics", {}));
}
var categoryFilter = (cfg) => cfg.skip_categories.length ? `category.is.null,category.not.in.(${cfg.skip_categories.join(",")})` : "category.is.null,category.not.is.null";
async function openSuggestions(sb) {
  const rows = must2(await sb.from("email_suggestions").select("id, email_messages!inner(thread_id)").in("status", ["offen", "fehlgeschlagen"]).limit(500));
  const out = /* @__PURE__ */ new Map();
  for (const r of rows || []) {
    const th = r.email_messages?.thread_id;
    if (th) (out.get(th) ?? out.set(th, []).get(th)).push(r.id);
  }
  return out;
}
async function addressees(sb, ms, audience) {
  const out = /* @__PURE__ */ new Map();
  const ids = [...new Set(ms.filter((m) => (audience.get(m.account_id) ?? []).length > 1).map((m) => m.id))];
  for (const c of chunks(ids)) {
    const rows = must2(await sb.from("email_messages").select("id, account_id, category, to_addrs, subject, body_text").in("id", c));
    for (const r of rows) {
      const a = addresseeOf({ to_addrs: r.to_addrs, subject: r.subject, body_text: String(r.body_text ?? "").slice(0, 1500) }, visibleTo(audience.get(r.account_id) ?? [], r.category));
      if (a) out.set(r.id, a);
    }
  }
  return out;
}
async function buildTopics(sb, threadIds, cfg, sugg, now, viewer = null) {
  const scope = viewer?.accountIds ?? null;
  const hidden = viewer?.hiddenCategories ?? [];
  const threads = [];
  const msgs = [];
  for (const ids of chunks(threadIds)) {
    const [th, ms] = await Promise.all([
      sb.from("email_threads").select("id, account_id, subject_norm, topic_state, snoozed_until, topic_note, reviewed_at, closed_at, hero_project_match_id, last_activity_at, assigned_user_id").in("id", ids),
      sb.from("email_messages").select(MSG_COLS).in("thread_id", ids).is("trashed_at", null).order("sent_at", { ascending: true, nullsFirst: true }).limit(2e3)
    ]);
    threads.push(...must2(th));
    msgs.push(...must2(ms));
  }
  const byThread = /* @__PURE__ */ new Map();
  for (const m of msgs) (byThread.get(m.thread_id) ?? byThread.set(m.thread_id, []).get(m.thread_id)).push(m);
  const hiddenForViewer = (th) => !!th.assigned_user_id && !!viewer?.userId && th.assigned_user_id !== viewer.userId;
  const assignedIds = [...new Set(threads.map((th) => th.assigned_user_id).filter(Boolean))];
  const names = /* @__PURE__ */ new Map();
  if (assignedIds.length) {
    const rows = must2(await sb.from("profiles").select("id, display_name").in("id", assignedIds));
    for (const r of rows) names.set(r.id, String(r.display_name || "Mitarbeiter"));
  }
  let addr = /* @__PURE__ */ new Map();
  if (viewer?.audience) {
    const look = [];
    for (const th of threads) {
      if (scope && !scope.includes(th.account_id)) continue;
      if (th.assigned_user_id) continue;
      const rel = (byThread.get(th.id) ?? []).filter((m) => isRelevant(m, cfg) && (!hidden.length || seesCategory({ hiddenCategories: hidden }, m.category)));
      look.push(...rel.filter((m) => !m.decided_at));
      if (rel.length) look.push(rel[rel.length - 1]);
    }
    addr = await addressees(sb, look, viewer.audience);
  }
  const mine = (m) => !viewer?.userId || !addr.has(m.id) || addr.get(m.id).id === viewer.userId;
  const draftIds = /* @__PURE__ */ new Set();
  const wantDraft = msgs.filter((m) => m.direction === "in" && !m.decided_at).map((m) => m.id);
  for (const c of chunks(wantDraft)) {
    for (const r of must2(await sb.from("email_messages").select("id, draft_text").in("id", c))) if (r.draft_text) draftIds.add(r.id);
  }
  const topics = [];
  const irrelevant = [];
  for (const th of threads) {
    if (scope && !scope.includes(th.account_id)) continue;
    if (hiddenForViewer(th)) continue;
    const allRaw = byThread.get(th.id) ?? [];
    const sIds = sugg.get(th.id) ?? [];
    if (!allRaw.some((m) => isRelevant(m, cfg)) && !sIds.length) {
      irrelevant.push(th.id);
      continue;
    }
    const all = hidden.length ? allRaw.filter((m) => seesCategory({ hiddenCategories: hidden }, m.category)) : allRaw;
    const rel = all.filter((m) => isRelevant(m, cfg));
    if (hidden.length && !rel.length) continue;
    const when = (m) => m.sent_at ?? m.created_at ?? null;
    const lastOf = (xs) => xs.reduce((a, m) => when(m) && (!a || when(m) > a) ? when(m) : a, null);
    const outs = all.filter((m) => m.direction === "out");
    const assignedTo = th.assigned_user_id ? { id: th.assigned_user_id, name: names.get(th.assigned_user_id) ?? "Mitarbeiter" } : null;
    const owner = assignedTo ?? (rel.length ? addr.get(rel[rel.length - 1].id) ?? null : null);
    const othersTopic = !!owner && !!viewer?.userId && owner.id !== viewer.userId;
    const undecided = rel.filter((m) => !m.decided_at && (!!assignedTo || mine(m)));
    const facts = {
      state: th.topic_state,
      snoozedUntil: th.snoozed_until,
      reviewedAt: th.reviewed_at,
      lastIn: lastOf(rel),
      lastOut: lastOf(outs),
      undecided: undecided.length,
      hadDecided: rel.some((m) => !!m.decided_at),
      openSuggestions: sIds.length,
      customer: rel.some((m) => isCustomerCategory(m.category))
    };
    const raw = topicStatus(facts, cfg, now);
    const st = othersTopic && raw.due && raw.reason !== "wiedervorlage" ? { ...raw, due: false, reason: null } : raw;
    const latest = all[all.length - 1] ?? rel[rel.length - 1];
    const lastInMail = [...rel].reverse()[0] ?? all.find((m) => m.direction === "in");
    const projectId = th.hero_project_match_id ?? [...all].reverse().find((m) => m.hero_project_match_id)?.hero_project_match_id ?? null;
    const pm = projectId ? [...all].reverse().find((m) => m.hero_project_match_id === projectId && m.match_info) : null;
    const project = projectId ? { nr: pm?.match_info?.projectNr ?? null, name: pm?.match_info?.projectName ?? null, kunde: pm?.match_info?.customer?.name ?? null, certain: pm?.match_info?.certain === true } : null;
    topics.push({
      id: th.id,
      subject: (lastInMail ?? latest)?.subject || th.subject_norm || "(ohne Betreff)",
      state: th.topic_state,
      due: st.due,
      reason: st.reason,
      reasonText: reasonText(st, th.topic_note),
      nextCheck: st.nextCheck,
      snoozedUntil: th.snoozed_until,
      note: th.topic_note,
      closedAt: th.closed_at,
      projectId,
      project,
      lastActivity: lastOf(all),
      from: lastInMail ? lastInMail.from_name || lastInMail.from_addr : "",
      latestId: latest?.id ?? "",
      lastMail: latest ? { direction: latest.direction, from: latest.from_name || latest.from_addr, sent_at: latest.sent_at, summary: latest.summary ?? latest.subject ?? null } : null,
      messageCount: all.length,
      addressedTo: assignedTo ? null : owner?.name ?? null,
      assignedTo,
      newMessages: undecided.map((m) => ({
        id: m.id,
        direction: m.direction,
        from_name: m.from_name,
        from_addr: m.from_addr,
        subject: m.subject,
        sent_at: m.sent_at,
        summary: m.summary,
        category: m.category,
        has_attachments: m.has_attachments,
        decided_at: m.decided_at,
        addressedTo: addr.get(m.id)?.name ?? null,
        hasDraft: draftIds.has(m.id),
        belegState: m.beleg_state ?? null
      })),
      suggestionIds: sIds
    });
  }
  return { topics, irrelevant };
}
async function currentTopics(sb, cfg, now, viewer = null) {
  const [open, undecided, sugg] = await Promise.all([
    sb.from("email_threads").select("id, last_activity_at").neq("topic_state", "erledigt").limit(3e3),
    sb.from("email_messages").select("thread_id").eq("direction", "in").is("decided_at", null).is("trashed_at", null).not("thread_id", "is", null).or(categoryFilter(cfg)).limit(3e3),
    openSuggestions(sb)
  ]);
  const openRows = must2(open);
  const ids = /* @__PURE__ */ new Set([
    ...openRows.map((r) => r.id),
    ...must2(undecided).map((r) => r.thread_id),
    ...sugg.keys()
  ]);
  const { topics, irrelevant } = await buildTopics(sb, [...ids], cfg, sugg, now, viewer);
  const dayAgo = new Date(now.getTime() - 864e5).toISOString();
  const lastAct = new Map(openRows.map((r) => [r.id, r.last_activity_at]));
  const stale = irrelevant.filter((id) => lastAct.has(id) && (lastAct.get(id) ?? "") < dayAgo);
  for (const c of chunks(stale)) await sb.from("email_threads").update({ topic_state: "erledigt" }).in("id", c).neq("topic_state", "erledigt");
  return topics;
}
var byActivityDesc = (a, b) => String(b.lastActivity ?? "").localeCompare(String(a.lastActivity ?? ""));
async function listTopics(sb, view, now = /* @__PURE__ */ new Date(), viewer = null) {
  const scope = viewer?.accountIds ?? null;
  const cfg = await loadTopicConfig(sb);
  if (view === "erledigt") {
    let q = sb.from("email_threads").select("id").eq("topic_state", "erledigt").not("closed_at", "is", null);
    if (scope) q = q.in("account_id", scope);
    const rows = must2(await q.order("closed_at", { ascending: false }).limit(150));
    const { topics } = await buildTopics(sb, rows.map((r) => r.id), cfg, /* @__PURE__ */ new Map(), now, viewer);
    return topics.filter((x) => !x.due).sort((a, b) => String(b.closedAt ?? "").localeCompare(String(a.closedAt ?? ""))).slice(0, 100);
  }
  const all = await currentTopics(sb, cfg, now, viewer);
  if (view === "entscheiden") return all.filter((x) => x.due).sort(byActivityDesc);
  if (view === "wiedervorlage") {
    return all.filter((x) => !x.due && x.state === "wiedervorlage").sort((a, b) => String(a.snoozedUntil).localeCompare(String(b.snoozedUntil)));
  }
  return all.filter((x) => !x.due && x.state === "aktiv").sort((a, b) => String(a.nextCheck ?? "").localeCompare(String(b.nextCheck ?? "")));
}
async function topicCounts(sb, now = /* @__PURE__ */ new Date(), viewer = null) {
  const all = await currentTopics(sb, await loadTopicConfig(sb), now, viewer);
  return {
    entscheiden: all.filter((x) => x.due).length,
    laufend: all.filter((x) => !x.due && x.state === "aktiv").length,
    wiedervorlage: all.filter((x) => !x.due && x.state === "wiedervorlage").length
  };
}
async function topicOfThread(sb, threadId, now = /* @__PURE__ */ new Date(), viewer = null) {
  if (!threadId) return null;
  const cfg = await loadTopicConfig(sb);
  const sugg = await openSuggestions(sb);
  const { topics } = await buildTopics(sb, [threadId], cfg, /* @__PURE__ */ new Map([[threadId, sugg.get(threadId) ?? []]]), now, viewer);
  return topics[0] ?? null;
}
var DECISION_LABEL = {
  weiter: "weiter verfolgen",
  wiedervorlage: "wiedervorlage",
  erledigt: "abgeschlossen",
  oeffnen: "wieder geoeffnet"
};
async function decideTopic(sb, threadId, d, now = /* @__PURE__ */ new Date()) {
  if (!threadId) throw new Error("Thema fehlt.");
  const { data: th } = await sb.from("email_threads").select("id, topic_state").eq("id", threadId).maybeSingle();
  if (!th) throw new Error("Thema nicht gefunden.");
  const nowIso = now.toISOString();
  let snoozedUntil = null;
  if (d.decision === "wiedervorlage") {
    const date = validSnoozeDate(d.until, berlinToday(now));
    if (!date) throw new Error("Wiedervorlage: Datum ab morgen angeben (h\xF6chstens zwei Jahre).");
    snoozedUntil = berlinToIso(date, "06:00");
  }
  let q = sb.from("email_messages").update({ decided_at: nowIso, decision: d.label ?? DECISION_LABEL[d.decision] }).eq("thread_id", threadId).eq("direction", "in").is("decided_at", null);
  if (d.messageIds?.length && d.decision !== "erledigt") q = q.in("id", d.messageIds.slice(0, 200));
  must2(await q);
  if (d.decision === "weiter" || d.decision === "erledigt") {
    const ids = must2(await sb.from("email_messages").select("id").eq("thread_id", threadId)).map((r) => r.id);
    for (const c of chunks(ids)) {
      must2(await sb.from("email_suggestions").update({ status: "abgelehnt", decided_at: nowIso, result: { reason: d.decision === "erledigt" ? "Thema abgeschlossen" : "Thema weiter verfolgt ohne diesen Vorschlag" } }).in("message_id", c).in("status", ["offen", "fehlgeschlagen"]));
    }
  }
  const note = d.note == null ? null : String(d.note).trim().slice(0, 300) || null;
  const patch = { reviewed_at: nowIso };
  if (d.decision === "erledigt") Object.assign(patch, { topic_state: "erledigt", closed_at: nowIso, snoozed_until: null, topic_note: note });
  else if (d.decision === "wiedervorlage") Object.assign(patch, { topic_state: "wiedervorlage", snoozed_until: snoozedUntil, closed_at: null, topic_note: note });
  else Object.assign(patch, { topic_state: "aktiv", snoozed_until: null, closed_at: null, topic_note: note });
  must2(await sb.from("email_threads").update(patch).eq("id", threadId));
  return { state: patch.topic_state, snoozedUntil };
}

// supabase/functions/email-api/index.ts
var CONFIG_KEYS = [
  "folders",
  "gewerke",
  "hero",
  "company_knowledge",
  "reply_rules",
  "lexoffice",
  "budget",
  "retention_days",
  "llm_prices",
  "topics"
];
var MESSAGE_LIST_COLUMNS = "id, account_id, thread_id, direction, from_addr, from_name, subject, sent_at, status, category, confidence, summary, hero_project_match_id, hero_project_nr:match_info->>projectNr, match_method, has_attachments, draft_message_id, current_folder, error, hero_logged_at, beleg_state, beleg_vendor, correction_note, trashed_at, answered_at, user_forwarded_at, assigned_user_id";
var BELEG_STATES = ["weiterleiten_offen", "weitergeleitet", "portal_offen", "portal_erledigt"];
var VIEWS = {
  kunden: (q) => q.eq("direction", "in").in("category", INBOX_CATEGORIES),
  ohne_projekt: (q) => q.eq("direction", "in").in("category", INBOX_CATEGORIES).is("hero_project_match_id", null),
  unsicher: (q) => q.eq("direction", "in").lt("confidence", 0.7),
  belege: (q) => q.eq("category", "beleg"),
  korrigiert: (q) => q.not("correction_note", "is", null),
  fehler: (q) => q.eq("status", "fehler"),
  zugeordnet: (q) => q.not("assigned_user_id", "is", null)
};
var ADMIN_ONLY = /* @__PURE__ */ new Set([
  "list_knowledge",
  "save_knowledge",
  "delete_knowledge",
  "save_account",
  "list_rules",
  "save_rule",
  "delete_rule",
  "save_config",
  "list_ai",
  "save_provider",
  "save_ai_setting",
  "hero_reload",
  "hero_probe",
  "list_reference_docs",
  "save_reference_doc",
  "delete_reference_doc",
  "list_runs",
  "list_users",
  "save_user"
]);
function applyMessageFilters(q, body, user, opts = {}) {
  q = scopeCategories(scopeAccounts(q, user), user);
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
  if (s) q = q.or(`subject.ilike.%${s}%,from_addr.ilike.%${s}%,summary.ilike.%${s}%,from_name.ilike.%${s}%,body_text.ilike.%${s}%`);
  return q;
}
async function viewerOf(sb, user) {
  return { accountIds: user.accountIds, userId: user.id, audience: await mailAudience(sb).catch(() => void 0), hiddenCategories: user.hiddenCategories };
}
async function withAttachments(sb, topics) {
  const ids = topics.flatMap((t2) => t2.newMessages.filter((m) => m.has_attachments).map((m) => m.id));
  if (!ids.length) return topics;
  const { data } = await sb.from("email_attachments").select("id, message_id, filename, mime, size, storage_path").in("message_id", ids).eq("is_ignored", false).order("created_at");
  const rows = data || [];
  const paths = rows.map((r) => r.storage_path).filter(Boolean);
  const urls = /* @__PURE__ */ new Map();
  if (paths.length) {
    const { data: signed } = await sb.storage.from("email-attachments").createSignedUrls(paths, 600);
    for (const x of signed || []) if (x?.path && x.signedUrl) urls.set(x.path, x.signedUrl);
  }
  const byMsg = /* @__PURE__ */ new Map();
  for (const r of rows) {
    (byMsg.get(r.message_id) ?? byMsg.set(r.message_id, []).get(r.message_id)).push({ id: r.id, filename: r.filename, mime: r.mime, size: r.size, url: r.storage_path ? urls.get(r.storage_path) ?? null : null });
  }
  for (const t2 of topics) for (const m of t2.newMessages) if (byMsg.has(m.id)) m.attachments = byMsg.get(m.id);
  return topics;
}
async function userNames(sb, ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return /* @__PURE__ */ new Map();
  const { data } = await sb.from("profiles").select("id, display_name").in("id", list);
  return new Map((data || []).map((r) => [r.id, String(r.display_name || "Mitarbeiter")]));
}
async function threadFor(sb, user, body) {
  let threadId = String(body.threadId || "");
  if (!threadId && body.messageId) {
    const { data } = await sb.from("email_messages").select("thread_id").eq("id", String(body.messageId)).maybeSingle();
    threadId = data?.thread_id ?? "";
  }
  if (!threadId) throw new Error("Thema fehlt.");
  await assertThread(sb, user, threadId);
  const { data: th } = await sb.from("email_threads").select("id, account_id, assigned_user_id").eq("id", threadId).maybeSingle();
  if (!th) throw new Error("Thema nicht gefunden.");
  return th;
}
async function assignCandidates(sb, th) {
  const [audience, { data: cats }] = await Promise.all([
    mailAudience(sb),
    sb.from("email_messages").select("category").eq("thread_id", th.id).not("category", "is", null)
  ]);
  const used = [...new Set((cats || []).map((r) => String(r.category)))];
  return (audience.get(th.account_id) ?? []).filter((u) => used.every((c) => !(u.hiddenCategories ?? []).includes(c))).map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name, "de"));
}
var must3 = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
var likeSafe = (q) => q.replace(/[%,()\\]/g, " ").trim().slice(0, 80);
var handlers = {
  async me({ user }) {
    return { name: user.name, email: user.email, role: user.role, admin: isMailAdmin(user), accountIds: user.accountIds, hiddenCategories: user.hiddenCategories };
  },
  // ---------------------------------------------------------------- Benachrichtigungen (jeder Benutzer fuer sich)
  /** Oeffentlicher VAPID-Schluessel, eigene Einstellungen, ob dieses Geraet angemeldet ist. */
  async push_status({ sb, user, body }) {
    const keys = await loadVapid(sb);
    const prefs = (await loadPrefs(sb, [user.id])).get(user.id) ?? DEFAULT_PREFS;
    const { data: subs } = await sb.from("email_push_subscriptions").select("endpoint").eq("user_id", user.id);
    const endpoint = String(body.endpoint || "");
    return { publicKey: keys.publicKey, prefs, devices: (subs || []).length, subscribed: !!endpoint && (subs || []).some((x) => x.endpoint === endpoint) };
  },
  async push_subscribe({ sb, user, body }) {
    const sub = body.subscription || {};
    const endpoint = String(sub.endpoint || "");
    const p256dh = String(sub.keys?.p256dh || "");
    const auth = String(sub.keys?.auth || "");
    if (!isPushEndpoint(endpoint)) throw new Error("Unbekannter Push-Dienst.");
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) throw new Error("Ung\xFCltiges Push-Abo.");
    const { error } = await sb.from("email_push_subscriptions").upsert({
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: String(body.userAgent || "").slice(0, 200) || null,
      failures: 0
    }, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);
    return { subscribed: true };
  },
  async push_unsubscribe({ sb, user, body }) {
    await sb.from("email_push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", String(body.endpoint || ""));
    return { subscribed: false };
  },
  async push_prefs({ sb, user, body }) {
    const cur = (await loadPrefs(sb, [user.id])).get(user.id) ?? DEFAULT_PREFS;
    const next = {
      decide: typeof body.decide === "boolean" ? body.decide : cur.decide,
      incoming: typeof body.incoming === "boolean" ? body.incoming : cur.incoming
    };
    const { error } = await sb.from("email_user_prefs").upsert({
      user_id: user.id,
      push_decide: next.decide,
      push_incoming: next.incoming,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (error) throw new Error(error.message);
    return next;
  },
  async push_test({ sb, user }) {
    const r = await pushToUser(sb, user.id, { title: "Mail-Assistent", body: "Benachrichtigungen funktionieren.", url: "/", tag: "test" }, await loadVapid(sb));
    if (!r.sent) throw new Error(r.failed ? "Senden an dieses Ger\xE4t fehlgeschlagen \u2013 bitte Benachrichtigungen aus- und wieder einschalten." : "Kein Ger\xE4t angemeldet.");
    return r;
  },
  async overview({ sb, user }) {
    const statuses = ["neu", "klassifiziert", "zugeordnet", "ohne_bezug", "erledigt", "wartet", "fehler"];
    const counts = {};
    await Promise.all(statuses.map(async (s) => {
      const { count } = await scopeCategories(scopeAccounts(sb.from("email_messages").select("id", { count: "exact", head: true }), user), user).eq("status", s);
      counts[s] = count ?? 0;
    }));
    const { count: open } = await scopeCategories(scopeAccounts(
      sb.from("email_suggestions").select("id, email_messages!inner(account_id, category, assigned_user_id)", { count: "exact", head: true }),
      user,
      "email_messages.account_id"
    ), user, "email_messages").eq("status", "offen");
    const start = /* @__PURE__ */ new Date();
    start.setUTCHours(0, 0, 0, 0);
    const monthStart = /* @__PURE__ */ new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { data: today } = await sb.from("email_ai_calls").select("neurons").eq("provider_type", "cloudflare").gte("created_at", start.toISOString());
    const { data: month } = await sb.from("email_ai_calls").select("cost_usd, neurons").gte("created_at", monthStart.toISOString());
    const prices = await getConfig(sb, "llm_prices", {});
    const budget = await getConfig(sb, "budget", {});
    const neuronsMonth = (month || []).reduce((n, r) => n + Number(r.neurons || 0), 0);
    const cost = (month || []).reduce((n, r) => n + Number(r.cost_usd || 0), 0) + neuronsMonth / 1e3 * Number(prices?._neuron_usd_per_1000 ?? 0.011);
    const topics = await topicCounts(sb, void 0, await viewerOf(sb, user)).catch(() => null);
    return {
      statusCounts: counts,
      openSuggestions: open ?? 0,
      topics,
      neuronsToday: (today || []).reduce((n, r) => n + Number(r.neurons || 0), 0),
      costMonthUsd: Math.round(cost * 1e4) / 1e4,
      budgetUsd: budget?.monthly_usd ?? null,
      budgetExceeded: budget?.monthly_usd != null && Number(budget.monthly_usd) > 0 && cost >= Number(budget.monthly_usd)
    };
  },
  async list_messages({ sb, user, body }) {
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const offset = Math.max(Number(body.offset) || 0, 0);
    const q = applyMessageFilters(sb.from("email_messages").select(MESSAGE_LIST_COLUMNS, { count: "exact" }), body, user);
    const { data, error, count } = await q.order("sent_at", { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    const names = await userNames(sb, (data || []).map((m) => m.assigned_user_id));
    const messages = (data || []).map((m) => ({ ...m, assigned_to: m.assigned_user_id ? names.get(m.assigned_user_id) ?? "Mitarbeiter" : null }));
    return { messages, total: count ?? 0 };
  },
  /** Anzahl je Kategorie unter den uebrigen Filtern (fuer die Kategorie-Chips). */
  async message_facets({ sb, user, body }) {
    const categories = {};
    await Promise.all(CATEGORIES.filter((c) => seesCategory(user, c)).map(async (c) => {
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
    assertVisible(user, msg);
    const topicP = topicOfThread(sb, msg.thread_id, void 0, {
      // Ohne userId: das Thema erscheint auch, wenn es einem anderen zugeordnet ist (mit „zugeordnet: …“).
      accountIds: user.accountIds,
      hiddenCategories: user.hiddenCategories
    }).catch(() => null);
    const [{ data: thread }, { data: atts }, { data: shadow }, { data: suggestions }, { data: calls }] = await Promise.all([
      msg.thread_id ? sb.from("email_messages").select("id, direction, from_addr, from_name, subject, sent_at, summary, category, body_text, status, decided_at, decision").eq("thread_id", msg.thread_id).order("sent_at", { ascending: true }) : Promise.resolve({ data: [] }),
      sb.from("email_attachments").select("*").eq("message_id", id).order("created_at"),
      sb.from("email_ai_shadow").select("*").eq("message_id", id),
      sb.from("email_suggestions").select("*").eq("message_id", id).order("created_at", { ascending: false }),
      sb.from("email_ai_calls").select("task, provider_type, model, tokens_in, tokens_out, neurons, cost_usd, ok, fallback, error, created_at").eq("message_id", id).order("created_at")
    ]);
    const attachments = [];
    for (const a of atts || []) {
      let url = null;
      if (a.storage_path) {
        const { data: s } = await sb.storage.from("email-attachments").createSignedUrl(a.storage_path, 600);
        url = s?.signedUrl ?? null;
      }
      attachments.push({ ...a, storage_path: void 0, url });
    }
    const { data: kn } = await sb.from("email_knowledge").select("id, text, from_pattern, source, created_at").eq("active", true).order("created_at", { ascending: false }).limit(300);
    const knowledge = {
      sender: (kn || []).filter((k) => k.from_pattern && matchesPattern(msg.from_addr, k.from_pattern)),
      general: (kn || []).filter((k) => !k.from_pattern).length
    };
    const visibleThread = (thread || []).filter((t2) => seesCategory(user, t2.category));
    const assignedName = msg.assigned_user_id ? (await userNames(sb, [msg.assigned_user_id])).get(msg.assigned_user_id) ?? "Mitarbeiter" : null;
    return { message: { ...msg, body_html: void 0, assigned_to: assignedName }, thread: visibleThread, attachments, shadow: shadow || [], suggestions: suggestions || [], calls: calls || [], knowledge, topic: await topicP };
  },
  /** Korrektur eines Menschen: wird gespeichert und fliesst als Beispiel in kuenftige Laeufe. */
  async correct_message({ sb, user, body }) {
    const id = String(body.id || "");
    await assertMessages(sb, user, [id]);
    const { data: msg } = await sb.from("email_messages").select("id, from_addr, category, summary, extracted").eq("id", id).maybeSingle();
    if (!msg) throw new Error("Mail nicht gefunden.");
    const patch = {};
    const feedback = [];
    if (body.category !== void 0) {
      if (!CATEGORIES.includes(body.category)) throw new Error("Unbekannte Kategorie.");
      if (body.category !== msg.category) {
        patch.category = body.category;
        feedback.push({ field: "category", old_value: msg.category, new_value: body.category });
      }
    }
    if (body.summary !== void 0 && body.summary !== msg.summary) {
      patch.summary = String(body.summary).slice(0, 1e3);
      feedback.push({ field: "summary", old_value: msg.summary, new_value: patch.summary });
    }
    if (body.extracted && typeof body.extracted === "object") {
      const next = { ...msg.extracted || {} };
      for (const [group, fields] of Object.entries(body.extracted)) {
        if (group.startsWith("_") || !fields || typeof fields !== "object") continue;
        const cur = { ...next[group] || {} };
        for (const [k, v] of Object.entries(fields)) {
          if (JSON.stringify(cur[k] ?? null) !== JSON.stringify(v ?? null)) {
            feedback.push({ field: `${group}.${k}`, old_value: cur[k] == null ? null : String(cur[k]), new_value: v == null ? null : String(v) });
            cur[k] = v;
          }
        }
        next[group] = cur;
      }
      patch.extracted = next;
    }
    if (!Object.keys(patch).length) return { changed: 0 };
    must3(await sb.from("email_messages").update(patch).eq("id", id));
    must3(await sb.from("email_feedback").insert(feedback.map((f) => ({ ...f, message_id: id, from_addr: msg.from_addr }))));
    let learned = null;
    if (feedback.some((f) => f.field === "category")) {
      learned = await learnRule(msg.from_addr, {
        async recentCategoryFeedback(addr, n) {
          const { data } = await sb.from("email_feedback").select("new_value, created_at").eq("field", "category").eq("from_addr", addr).order("created_at", { ascending: false }).limit(n);
          return data || [];
        },
        async existingRule(pattern) {
          const { data } = await sb.from("email_rules").select("source, category").eq("pattern", pattern).maybeSingle();
          return data ?? null;
        },
        async saveRule(pattern, category) {
          must3(await sb.from("email_rules").upsert({ pattern, category, source: "gelernt", protect: false }, { onConflict: "pattern" }));
        }
      });
    }
    return { changed: feedback.length, learned };
  },
  /** Beleg-Stand von Hand setzen, z. B. „Im Portal abgeholt und verbucht“. */
  async set_beleg_state({ sb, user, body }) {
    await assertMessages(sb, user, [body.id]);
    const state = String(body.state || "");
    if (!BELEG_STATES.includes(state)) throw new Error("Unbekannter Stand.");
    must3(await sb.from("email_messages").update({ beleg_state: state, ...state === "weitergeleitet" ? { forwarded_at: (/* @__PURE__ */ new Date()).toISOString() } : {} }).eq("id", String(body.id || "")));
    return { ok: true };
  },
  /** Mail noch einmal durch die Pipeline schicken. */
  async reprocess_message({ sb, user, body }) {
    await assertMessages(sb, user, [body.id]);
    must3(await sb.from("email_messages").update({ status: "neu", attempts: 0, error: null }).eq("id", String(body.id || "")));
    return { ok: true };
  },
  /** Anhang ein- oder ausblenden (nur Anzeige – gespeichert bleibt die Datei). */
  async set_attachment_hidden({ sb, user, body }) {
    const { data: att } = await sb.from("email_attachments").select("id, message_id").eq("id", String(body.id || "")).maybeSingle();
    if (!att) throw new Error("Anhang nicht gefunden.");
    await assertMessages(sb, user, [att.message_id]);
    must3(await sb.from("email_attachments").update({ is_ignored: !!body.hidden }).eq("id", att.id));
    return { ok: true };
  },
  /** Mehrfachauswahl in der Liste: Kategorie setzen (wie einzeln korrigiert, mit Lernen) oder neu verarbeiten. */
  async bulk_messages({ sb, user, body }) {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 200);
    if (!ids.length) throw new Error("Keine Mails ausgew\xE4hlt.");
    await assertMessages(sb, user, ids);
    if (body.op === "reprocess") {
      must3(await sb.from("email_messages").update({ status: "neu", attempts: 0, error: null }).in("id", ids).is("trashed_at", null));
      return { changed: ids.length };
    }
    if (body.op === "category") {
      if (!CATEGORIES.includes(body.category)) throw new Error("Unbekannte Kategorie.");
      let changed = 0;
      const learned = [];
      for (const id of ids) {
        const r = await handlers.correct_message({ sb, user, body: { id, category: body.category } });
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
    if (note.length < 3) throw new Error("Bitte kurz beschreiben, was richtig w\xE4re.");
    if (note.length > KNOWLEDGE_TEXT_MAX) throw new Error(`H\xF6chstens ${KNOWLEDGE_TEXT_MAX} Zeichen.`);
    const scope = ["keine", "absender", "domain", "alle"].includes(body.remember) ? body.remember : "keine";
    const { data: msg } = await sb.from("email_messages").select("id, account_id, from_addr, correction_note").eq("id", id).maybeSingle();
    if (!msg) throw new Error("Mail nicht gefunden.");
    let knowledgeId = null;
    const pattern = patternForScope(scope, msg.from_addr);
    if (pattern !== void 0) {
      const text = String(body.knowledgeText || note).trim().slice(0, KNOWLEDGE_TEXT_MAX);
      if (text.length < 3) throw new Error("Der Wissenseintrag ist leer.");
      const k = must3(await sb.from("email_knowledge").insert({ text, from_pattern: pattern, source: "korrektur", message_id: id }).select("id").single());
      knowledgeId = k.id;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const { data: open } = await sb.from("email_suggestions").update({ status: "abgelehnt", decided_at: now, result: { reason: "korrigiert" } }).eq("message_id", id).eq("status", "offen").select("type");
    must3(await sb.from("email_feedback").insert([
      { message_id: id, field: "hinweis", old_value: msg.correction_note, new_value: note, from_addr: msg.from_addr },
      ...(open || []).map((r) => ({ message_id: id, field: `suggestion.${r.type}`, old_value: "vorgeschlagen", new_value: "abgelehnt", from_addr: msg.from_addr }))
    ]));
    must3(await sb.from("email_messages").update({ correction_note: note, status: "neu", attempts: 0, error: null }).eq("id", id));
    return { accountId: msg.account_id, knowledgeId, rejected: (open || []).length };
  },
  // ------------------------------------------------------------------ Wissensdatei
  async list_knowledge({ sb }) {
    const rows = must3(await sb.from("email_knowledge").select("id, text, from_pattern, source, message_id, active, created_at, updated_at").order("created_at", { ascending: false }).limit(500));
    const ids = [...new Set(rows.map((r) => r.message_id).filter(Boolean))];
    const subjects = {};
    if (ids.length) {
      const { data } = await sb.from("email_messages").select("id, subject").in("id", ids);
      for (const m of data || []) subjects[m.id] = m.subject;
    }
    return rows.map((r) => ({ ...r, message_subject: r.message_id ? subjects[r.message_id] ?? null : null }));
  },
  async save_knowledge({ sb, body }) {
    const row = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
    if (body.text !== void 0) {
      const text = String(body.text).trim();
      if (text.length < 3 || text.length > KNOWLEDGE_TEXT_MAX) throw new Error(`Text: 3 bis ${KNOWLEDGE_TEXT_MAX} Zeichen.`);
      row.text = text;
    }
    if (body.from_pattern !== void 0) row.from_pattern = normalizePattern(body.from_pattern);
    if (body.active !== void 0) row.active = !!body.active;
    if (body.id) {
      must3(await sb.from("email_knowledge").update(row).eq("id", String(body.id)));
      return { id: body.id };
    }
    if (!row.text) throw new Error("Text fehlt.");
    return must3(await sb.from("email_knowledge").insert({ ...row, source: "manuell" }).select("id").single());
  },
  async delete_knowledge({ sb, body }) {
    must3(await sb.from("email_knowledge").delete().eq("id", String(body.id || "")));
    return { ok: true };
  },
  // ------------------------------------------------------------------ Postfaecher
  async list_accounts({ sb, user }) {
    const { data } = await scopeAccounts(sb.from("email_accounts").select("id, label, address, imap_host, imap_port, smtp_host, smtp_port, username, password_enc, folder_map, signature, autopilot, shadow_mode, enabled, backfill, last_sync_at, last_error, locked_until"), user, "id").order("created_at");
    if (!isMailAdmin(user)) return (data || []).map((a) => ({ id: a.id, label: a.label, address: a.address, enabled: a.enabled }));
    return (data || []).map((a) => ({ ...a, password_enc: void 0, has_password: !!a.password_enc, autopilot: normalizeAutopilot(a.autopilot) }));
  },
  async save_account({ sb, body }) {
    const row = {};
    for (const k of ["label", "address", "imap_host", "smtp_host", "username", "signature"]) {
      if (body[k] !== void 0) row[k] = String(body[k]).trim();
    }
    if (body.imap_port !== void 0) row.imap_port = Math.min(Math.max(parseInt(body.imap_port, 10) || 993, 1), 65535);
    if (body.smtp_port !== void 0) row.smtp_port = Math.min(Math.max(parseInt(body.smtp_port, 10) || 465, 1), 65535);
    if (body.backfill !== void 0) row.backfill = Math.min(Math.max(parseInt(body.backfill, 10) || 0, 0), 500);
    if (body.shadow_mode !== void 0) row.shadow_mode = !!body.shadow_mode;
    if (body.enabled !== void 0) row.enabled = !!body.enabled;
    if (body.autopilot !== void 0) row.autopilot = normalizeAutopilot(body.autopilot);
    if (body.password) row.password_enc = await encryptSecret(String(body.password), encryptionKey());
    if (body.id) {
      must3(await sb.from("email_accounts").update(row).eq("id", body.id));
      return { id: body.id };
    }
    if (!row.address || !row.imap_host || !row.username) throw new Error("Adresse, Server und Benutzername sind Pflicht.");
    row.label = row.label || row.address;
    const d = must3(await sb.from("email_accounts").insert({ imap_port: 993, ...row }).select("id").single());
    return { id: d.id };
  },
  // ------------------------------------------------------------------ Regeln
  async list_rules({ sb }) {
    return must3(await sb.from("email_rules").select("*").order("pattern"));
  },
  async save_rule({ sb, body }) {
    const pattern = String(body.pattern || "").trim().toLowerCase();
    if (!pattern || !/^@?[^\s@]+(\.[^\s@]+)*$|^[^\s@]+@[^\s@]+$/.test(pattern)) throw new Error("Muster: Adresse (a@b.de) oder Domain (@b.de).");
    if (!CATEGORIES.includes(body.category)) throw new Error("Unbekannte Kategorie.");
    const row = { pattern, category: body.category, target_folder: body.target_folder || null, protect: !!body.protect, source: "manuell" };
    must3(await sb.from("email_rules").upsert(row, { onConflict: "pattern" }));
    return { ok: true };
  },
  async delete_rule({ sb, body }) {
    must3(await sb.from("email_rules").delete().eq("id", String(body.id || "")));
    return { ok: true };
  },
  // ------------------------------------------------------------------ Konfiguration
  async get_config({ sb }) {
    const out = {};
    for (const k of CONFIG_KEYS) out[k] = await getConfig(sb, k, null);
    return out;
  },
  async save_config({ sb, body }) {
    const key = String(body.key || "");
    if (!CONFIG_KEYS.includes(key)) throw new Error("Dieser Einstellungsschluessel ist nicht aenderbar.");
    if (body.value === void 0) throw new Error("Wert fehlt.");
    await setConfig(sb, key, key === "topics" ? normalizeTopicConfig(body.value) : body.value);
    return { ok: true };
  },
  // ------------------------------------------------------------------ KI
  async list_ai({ sb }) {
    const [{ data: providers }, { data: settings }] = await Promise.all([
      sb.from("email_ai_providers").select("id, name, type, base_url, account_id, api_key_enc, enabled").order("name"),
      sb.from("email_ai_settings").select("*").order("task")
    ]);
    return {
      providers: (providers || []).map((p) => ({ ...p, api_key_enc: void 0, has_key: !!p.api_key_enc })),
      settings: settings || [],
      tasks: AI_TASKS
    };
  },
  async save_provider({ sb, body }) {
    const row = {};
    for (const k of ["name", "base_url", "account_id"]) if (body[k] !== void 0) row[k] = body[k] ? String(body[k]).trim() : null;
    if (body.type !== void 0) {
      if (!["cloudflare", "anthropic", "openai"].includes(body.type)) throw new Error("Unbekannter Anbieter-Typ.");
      row.type = body.type;
    }
    if (body.enabled !== void 0) row.enabled = !!body.enabled;
    if (body.api_key) row.api_key_enc = await encryptSecret(String(body.api_key), encryptionKey());
    if (body.id) {
      must3(await sb.from("email_ai_providers").update(row).eq("id", body.id));
      return { id: body.id };
    }
    if (!row.name || !row.type) throw new Error("Name und Typ sind Pflicht.");
    return must3(await sb.from("email_ai_providers").insert(row).select("id").single());
  },
  async save_ai_setting({ sb, body }) {
    if (!AI_TASKS.includes(body.task)) throw new Error("Unbekannte Aufgabe.");
    const row = { task: body.task };
    for (const k of ["provider_id", "fallback_provider_id", "shadow_provider_id"]) if (body[k] !== void 0) row[k] = body[k] || null;
    for (const k of ["model", "fallback_model", "shadow_model"]) if (body[k] !== void 0) row[k] = body[k] ? String(body[k]).trim() : null;
    if (body.on_limit !== void 0) {
      if (!["ausweichen", "warten"].includes(body.on_limit)) throw new Error("on_limit: ausweichen oder warten.");
      row.on_limit = body.on_limit;
    }
    if (body.daily_neuron_limit !== void 0) row.daily_neuron_limit = Math.max(0, parseInt(body.daily_neuron_limit, 10) || 0);
    if (row.model !== void 0 && !row.model) throw new Error("Modell darf nicht leer sein.");
    must3(await sb.from("email_ai_settings").upsert(row, { onConflict: "task" }));
    return { ok: true };
  },
  // ------------------------------------------------------------------ Vorschlaege (Zu entscheiden)
  async list_suggestions({ sb, user, body }) {
    const status = ["offen", "angenommen", "abgelehnt", "fehlgeschlagen"].includes(body.status) ? body.status : "offen";
    const { data, error } = await scopeCategories(scopeAccounts(sb.from("email_suggestions").select("id, type, payload, status, result, created_at, decided_at, email_messages!inner(id, account_id, assigned_user_id, subject, from_addr, from_name, summary, category, confidence, sent_at, direction, hero_project_match_id, match_info, has_attachments, extracted)"), user, "email_messages.account_id"), user, "email_messages").eq("status", status).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    const ids = [...new Set((data || []).map((r) => r.email_messages.id))];
    const atts = {};
    if (ids.length) {
      const { data: a } = await sb.from("email_attachments").select("id, message_id, filename, mime, size, role, storage_path, is_ignored").in("message_id", ids);
      for (const x of a || []) {
        let url = null;
        if (x.storage_path && /^image\//.test(x.mime)) {
          const { data: sg } = await sb.storage.from("email-attachments").createSignedUrl(x.storage_path, 600);
          url = sg?.signedUrl ?? null;
        }
        (atts[x.message_id] ||= []).push({ id: x.id, filename: x.filename, mime: x.mime, size: x.size, role: x.role, is_ignored: x.is_ignored, url });
      }
    }
    return (data || []).map((r) => ({ ...r, message: r.email_messages, email_messages: void 0, attachments: atts[r.email_messages.id] || [] }));
  },
  // ------------------------------------------------------------------ Themen
  /** Themen einer Ansicht: entscheiden | laufend | wiedervorlage | erledigt (topics.ts). */
  async list_topics({ sb, user, body }) {
    const views = ["entscheiden", "laufend", "wiedervorlage", "erledigt"];
    const view = views.includes(body.view) ? body.view : "entscheiden";
    const topics = await listTopics(sb, view, void 0, await viewerOf(sb, user));
    return view === "entscheiden" ? await withAttachments(sb, topics) : topics;
  },
  /** Wem das Thema (der Mail) zugeordnet werden kann, und wem es gerade zugeordnet ist. */
  async assign_candidates({ sb, user, body }) {
    const th = await threadFor(sb, user, body);
    return { assignedUserId: th.assigned_user_id, candidates: await assignCandidates(sb, th) };
  },
  /**
   * Thema (mit allen Mails, auch kuenftigen) einem Mitarbeiter zuordnen – danach legen die Themen-Ansichten es nur noch ihm
   * vor, auch die Wiedervorlage; die Mails bleiben im Postfach fuer alle sichtbar – oder mit userId = null aufheben.
   */
  async assign_topic({ sb, user, body }) {
    const th = await threadFor(sb, user, body);
    const target = body.userId ? String(body.userId) : null;
    if (target === th.assigned_user_id) return { assignedUserId: target };
    let name = null;
    if (target) {
      const cand = (await assignCandidates(sb, th)).find((c) => c.id === target);
      if (!cand) throw new Error("Dieser Mitarbeiter sieht das Postfach oder eine Kategorie dieses Themas nicht.");
      name = cand.name;
    }
    must3(await sb.from("email_threads").update({
      assigned_user_id: target,
      assigned_at: target ? (/* @__PURE__ */ new Date()).toISOString() : null,
      assigned_by: target ? user.id : null
    }).eq("id", th.id));
    if (target && target !== user.id) {
      const prefs = (await loadPrefs(sb, [target])).get(target) ?? DEFAULT_PREFS;
      const { data: last } = await sb.from("email_messages").select("id, subject, from_name, from_addr").eq("thread_id", th.id).order("sent_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (prefs.decide && last) {
        await pushToUser(sb, target, {
          title: `${user.name || "Jemand"} hat dir eine Mail zugeordnet`.slice(0, 80),
          body: `${last.from_name || last.from_addr}: ${last.subject || "(ohne Betreff)"}`.slice(0, 240),
          url: `/mails/${last.id}`,
          tag: `assign-${th.id}`
        }, await loadVapid(sb)).catch(() => null);
      }
    }
    return { assignedUserId: target, assignedTo: name };
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
      decision,
      until: body.until ?? null,
      note: body.note ?? null,
      messageIds: Array.isArray(body.messageIds) ? body.messageIds.map(String) : null
    });
  },
  /** Kurzuebersicht (fuer die Startseite und die optionale 7-Uhr-Push-Meldung). */
  async digest({ sb, user }) {
    const twoDays = new Date(Date.now() - 2 * 864e5).toISOString();
    const { count: open } = await scopeCategories(scopeAccounts(
      sb.from("email_suggestions").select("id, email_messages!inner(account_id, category, assigned_user_id)", { count: "exact", head: true }),
      user,
      "email_messages.account_id"
    ), user, "email_messages").eq("status", "offen");
    const customerCats = ["anfrage_neu", "projekt_kommunikation", "layout_freigabe", "auftrag", "reklamation"];
    const { data: unanswered } = await scopeCategories(scopeAccounts(sb.from("email_messages").select("id, subject, from_name, from_addr, sent_at, category, email_threads!inner(answered)"), user), user).eq("direction", "in").in("category", customerCats).eq("email_threads.answered", false).lt("sent_at", twoDays).is("trashed_at", null).order("sent_at", { ascending: true }).limit(20);
    const { data: claims } = await scopeCategories(scopeAccounts(sb.from("email_messages").select("id, subject, from_name, from_addr, sent_at, category, email_threads!inner(answered)"), user), user).eq("direction", "in").eq("category", "reklamation").eq("email_threads.answered", false).is("trashed_at", null).order("sent_at", { ascending: true }).limit(20);
    const { data: portal } = await scopeCategories(scopeAccounts(sb.from("email_messages").select("id, subject, from_name, from_addr, sent_at, beleg_vendor"), user), user).eq("beleg_state", "portal_offen").is("trashed_at", null).order("sent_at", { ascending: true }).limit(50);
    const lines = [];
    if (portal?.length) lines.push(`${portal.length} Rechnung(en) im Portal abzuholen.`);
    if (open) lines.push(`${open} Vorschlag/Vorschl\xE4ge warten auf dich.`);
    if (unanswered?.length) lines.push(`${unanswered.length} Kundenmail(s) seit \xFCber 2 Tagen unbeantwortet.`);
    if (claims?.length) lines.push(`${claims.length} offene Reklamation(en).`);
    return {
      openSuggestions: open ?? 0,
      unanswered: (unanswered || []).map((r) => ({ id: r.id, subject: r.subject, from: r.from_name || r.from_addr, sent_at: r.sent_at, category: r.category })),
      portalOpen: (portal || []).map((r) => ({ id: r.id, subject: r.subject, from: r.beleg_vendor || r.from_name || r.from_addr, sent_at: r.sent_at })),
      claims: (claims || []).map((r) => ({ id: r.id, subject: r.subject, from: r.from_name || r.from_addr, sent_at: r.sent_at })),
      text: lines.length ? `Mail-Assistent: ${lines.join(" ")}` : "Mail-Assistent: nichts offen."
    };
  },
  // ------------------------------------------------------------------ HERO (lesend)
  /** Aktueller Status eines HERO-Projekts und die Schritte des Ablaufs (fuer „Projektstatus“ in Zu entscheiden). Nur lesend. */
  async project_status({ sb, body }) {
    const key = await loadHeroKey(sb);
    if (!key) throw new Error("HERO ist nicht aktiviert.");
    const id = Number(body.projectId);
    if (!Number.isFinite(id) || id <= 0) throw new Error("Projekt fehlt.");
    const cfg = await getConfig(sb, "hero", {}) ?? {};
    const [p, steps] = await Promise.all([projectById(key, id), projectSteps(key, cfg.project_type_id ?? null)]);
    if (!p) throw new Error("Projekt in HERO nicht gefunden.");
    return { projectId: p.id, nr: p.nr, name: p.name, stepId: p.stepId, stepName: p.stepName, steps };
  },
  async search_projects({ sb, body }) {
    const key = await loadHeroKey(sb);
    if (!key) throw new Error("HERO ist nicht aktiviert.");
    const term = String(body.q || "").trim().slice(0, 80);
    if (term.length < 2) return [];
    const nr = /^(?:[a-z]{2,4}[\s-]*)?(\d{1,6})$/i.exec(term)?.[1];
    const [exact, hits] = await Promise.all([
      nr ? projectByNumber(key, Number(nr)).catch(() => null) : Promise.resolve(null),
      searchProjects(key, term)
    ]);
    return exact ? [exact, ...hits.filter((p) => p.id !== exact.id)] : hits;
  },
  /** Pipeline-Schritte und Dokumenttypen anhand ihrer Namen aus HERO neu zuordnen. */
  async hero_reload({ sb }) {
    const key = await loadHeroKey(sb);
    if (!key) throw new Error("HERO ist nicht aktiviert.");
    const cfg = await getConfig(sb, "hero", {}) ?? {};
    const data = await heroGraphql(key, "query { project_types { id name project_status_steps { id name } } document_types { id name } }");
    const types = data?.project_types || [];
    const type = types.find((t2) => Number(t2.id) === Number(cfg.project_type_id)) ?? types.find((t2) => /^projekt$/i.test(String(t2.name).trim()));
    if (!type) throw new Error("Projekttyp in HERO nicht gefunden \u2013 bitte die Projekttyp-ID pr\xFCfen.");
    const steps = mapSteps(type.project_status_steps || []);
    const docs = mapDocumentTypes(data?.document_types || []);
    const next = {
      ...cfg,
      project_type_id: Number(type.id),
      steps: { ...cfg.steps ?? {}, ...steps.steps },
      excluded_steps: steps.excluded.length ? steps.excluded : cfg.excluded_steps ?? [],
      document_types: { ...cfg.document_types ?? {}, ...docs.found },
      offer_document_type_id: docs.offerTypeId ?? cfg.offer_document_type_id,
      confirmation_document_type_id: docs.confirmationTypeId ?? cfg.confirmation_document_type_id
    };
    await setConfig(sb, "hero", next);
    return { hero: next, missing: steps.missing, docTypesFound: Object.keys(docs.found) };
  },
  /** Nur lesen: Argumente einer HERO-Mutation per Introspection (z. B. create_document). */
  async hero_probe({ sb, body }) {
    const key = await loadHeroKey(sb);
    if (!key) throw new Error("HERO ist nicht aktiviert.");
    const name = String(body.mutation || "create_document");
    if (!/^[a-z_]{3,60}$/.test(name)) throw new Error("Ung\xFCltiger Name.");
    const data = await heroGraphql(key, 'query { __type(name: "Mutation") { fields { name args { name type { name kind ofType { name kind } } } } } }');
    const f = (data?.__type?.fields || []).find((x) => x.name === name);
    const services = await heroGraphql(key, "query { supply_services { id } }").then((d) => (d?.supply_services || []).length).catch(() => null);
    return { mutation: name, found: !!f, args: f?.args ?? null, supplyServices: services };
  },
  /** Live-Stand eines HERO-Dokuments fuer die Karte „versenden": Status, PDF, passende Mailvorlagen. Nur lesend. */
  async document_info({ sb, body }) {
    const key = await loadHeroKey(sb);
    if (!key) throw new Error("HERO ist nicht aktiviert.");
    const kind = body.kind === "offer" ? "offer" : "confirmation";
    const doc = await documentById(key, Number(body.documentId));
    if (!doc) throw new Error("Dokument nicht gefunden (in HERO gel\xF6scht?).");
    const templates = await emailTemplates(key, DOCUMENT_MAIL_CONTEXT[kind]);
    return {
      id: doc.id,
      nr: doc.nr,
      statusCode: doc.statusCode,
      statusName: doc.statusName,
      value: doc.value,
      projectNr: doc.projectNr,
      hasPdf: !!doc.fileUuid && doc.statusCode >= 100,
      sent: doc.statusCode === 200,
      templates,
      suggestedTemplateId: pickTemplate(templates, body.formality === "du" ? "du" : body.formality === "sie" ? "sie" : null)?.id ?? null
    };
  },
  // ------------------------------------------------------------------ Referenzwissen (Skill-Dateien, HERO-Doku)
  async list_reference_docs({ sb }) {
    return must3(await sb.from("email_reference_docs").select("id, title, content, tasks, active, created_at, updated_at").order("created_at"));
  },
  async save_reference_doc({ sb, body }) {
    const row = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
    if (body.title !== void 0) {
      const t2 = String(body.title).trim();
      if (t2.length < 2 || t2.length > 200) throw new Error("Titel: 2 bis 200 Zeichen.");
      row.title = t2;
    }
    if (body.content !== void 0) {
      const c = String(body.content);
      if (c.length > REFERENCE_DOC_MAX) throw new Error("H\xF6chstens 200.000 Zeichen je Dokument \u2013 bitte aufteilen.");
      row.content = c;
    }
    if (body.tasks !== void 0) {
      const allowed = ["prepare_offer", "prepare_confirmation", "understand", "draft"];
      row.tasks = (Array.isArray(body.tasks) ? body.tasks : []).map(String).filter((t2) => allowed.includes(t2));
    }
    if (body.active !== void 0) row.active = !!body.active;
    if (body.id) {
      must3(await sb.from("email_reference_docs").update(row).eq("id", String(body.id)));
      return { id: body.id };
    }
    if (!row.title) throw new Error("Titel fehlt.");
    return must3(await sb.from("email_reference_docs").insert(row).select("id").single());
  },
  async delete_reference_doc({ sb, body }) {
    must3(await sb.from("email_reference_docs").delete().eq("id", String(body.id || "")));
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
  }
};
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = (0, import_supabase_js.createClient)(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const user = await requireMailUser(req, sb);
  if (!user) return fail("Nicht angemeldet oder kein Zugang zur Mail-App (Admin oder Mitarbeiter mit Postfach).", { code: "unauthorized" });
  const body = await readJson(req);
  const action = String(body.action || "");
  const h = handlers[action];
  if (!h) return fail("Unbekannte Aktion.");
  if (ADMIN_ONLY.has(action) && !isMailAdmin(user)) return fail("Nur f\xFCr Admins.", { code: "forbidden" });
  try {
    return ok(await h({ sb, user, body }));
  } catch (e) {
    return fail(String(e?.message || e).slice(0, 300), e instanceof AccessError ? { code: "forbidden" } : {});
  }
});
