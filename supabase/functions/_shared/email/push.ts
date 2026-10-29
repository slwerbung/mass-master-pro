// Push-Benachrichtigungen der Mail-App (Einstellungen → Benachrichtigungen, je Benutzer und Geraet).
//
//  * „Zu entscheiden“ (Standard an): eine neue Mail, die unter „Zu entscheiden“ landet. Ist sie erkennbar an einen
//    Mitarbeiter gerichtet (addressee.ts), bekommt nur er die Nachricht – sonst alle mit Zugriff aufs Postfach.
//  * „Alle eingehenden Mails“ (Standard aus): zusaetzlich jede andere eingehende Mail (ohne Werbung/Spam).
//
// Jede eingehende Mail wird genau einmal geprueft (`email_messages.pushed_at`), nach dem Verarbeiten (email-process),
// damit Kategorie, Zusammenfassung und Entscheidung schon feststehen. Aeltere Mails (Rueckstand) werden nicht gemeldet.

import { addresseeOf, type AddresseeUser } from "./addressee.ts";
import { getConfig, setConfig } from "./config.ts";
import { isRelevant, normalizeTopicConfig, type TopicConfig } from "./topics.ts";
import { mailAudience } from "./users.ts";
import { generateVapid, sendPush, type PushSubscription, type VapidKeys } from "./webpush.ts";

export interface PushPrefs { decide: boolean; incoming: boolean }
export const DEFAULT_PREFS: PushPrefs = { decide: true, incoming: false };

export interface PushMail {
  id: string;
  account_id: string;
  direction: "in" | "out";
  status: string | null;
  category: string | null;
  beleg_state: string | null;
  decided_at: string | null;
  from_name: string | null;
  from_addr: string;
  to_addrs: string[];
  subject: string | null;
  summary: string | null;
  body_text: string | null;
}

export interface UserPushes { decide: PushMail[]; incoming: PushMail[] }

/** Wer bekommt welche Mail? Reine Logik. */
export function planPushes(
  mails: PushMail[], audience: Map<string, AddresseeUser[]>, prefs: Map<string, PushPrefs>, cfg: TopicConfig,
): Map<string, UserPushes> {
  const out = new Map<string, UserPushes>();
  const add = (userId: string, kind: keyof UserPushes, m: PushMail) => {
    const e = out.get(userId) ?? out.set(userId, { decide: [], incoming: [] }).get(userId)!;
    e[kind].push(m);
  };
  for (const m of mails) {
    if (m.direction !== "in") continue;
    const users = audience.get(m.account_id) ?? [];
    if (!users.length) continue;
    const decide = !m.decided_at && isRelevant(m, cfg);
    const to = decide ? addresseeOf(m, users) : null;
    for (const u of to ? [to] : users) {
      const p = prefs.get(u.id) ?? DEFAULT_PREFS;
      if (decide && p.decide) add(u.id, "decide", m);
      else if (p.incoming && m.category !== "werbung_spam") add(u.id, "incoming", m);
    }
  }
  return out;
}

const who = (m: PushMail) => m.from_name?.trim() || m.from_addr || "Unbekannt";
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export interface PushPayload { title: string; body: string; url: string; tag: string }

/** Text der Benachrichtigung: eine Mail ausfuehrlich, mehrere als Liste. */
export function pushPayload(kind: keyof UserPushes, mails: PushMail[]): PushPayload {
  const label = kind === "decide" ? "Zu entscheiden" : "Neue Mail";
  if (mails.length === 1) {
    const m = mails[0];
    const body = [m.subject || "(ohne Betreff)", m.summary].filter(Boolean).join("\n");
    return { title: cut(`${label}: ${who(m)}`, 80), body: cut(body, 240), url: kind === "decide" ? "/" : `/mails/${m.id}`, tag: `mail-${m.id}` };
  }
  const lines = mails.slice(0, 4).map((m) => `${who(m)}: ${m.subject || "(ohne Betreff)"}`);
  if (mails.length > 4) lines.push(`… und ${mails.length - 4} weitere`);
  return {
    title: kind === "decide" ? `${mails.length} Mails zu entscheiden` : `${mails.length} neue Mails`,
    body: cut(lines.join("\n"), 400), url: kind === "decide" ? "/" : "/mails", tag: `mails-${kind}`,
  };
}

// ---------------------------------------------------------------- Datenbank

const VAPID_KEY = "push_vapid";

/** VAPID-Schluessel: beim ersten Gebrauch erzeugt und in email_config (nur service_role) abgelegt. */
export async function loadVapid(sb: any): Promise<VapidKeys> {
  const have = await getConfig<VapidKeys | null>(sb, VAPID_KEY, null);
  if (have?.publicKey && have.privateJwk) return have;
  const { data: acc } = await sb.from("email_accounts").select("address").order("created_at").limit(1).maybeSingle();
  const fresh = await generateVapid(`mailto:${acc?.address || "info@slwerbung.de"}`);
  // Gleichzeitige Erzeugung: nur der erste Eintrag zaehlt (sonst passen bestehende Abos nicht mehr).
  const { error } = await sb.from("email_config").insert({ key: VAPID_KEY, value: fresh, updated_at: new Date().toISOString() });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  const stored = await getConfig<VapidKeys | null>(sb, VAPID_KEY, null);
  if (!stored?.publicKey) {
    await setConfig(sb, VAPID_KEY, fresh);
    return fresh;
  }
  return stored;
}

export async function loadPrefs(sb: any, userIds: string[]): Promise<Map<string, PushPrefs>> {
  const out = new Map<string, PushPrefs>();
  if (!userIds.length) return out;
  const { data } = await sb.from("email_user_prefs").select("user_id, push_decide, push_incoming").in("user_id", userIds);
  for (const r of data || []) out.set(r.user_id, { decide: r.push_decide !== false, incoming: r.push_incoming === true });
  return out;
}

/** An alle Geraete eines Benutzers. Abgelaufene Abos werden geloescht. */
export async function pushToUser(sb: any, userId: string, payload: PushPayload, keys: VapidKeys): Promise<{ sent: number; failed: number }> {
  const { data: subs } = await sb.from("email_push_subscriptions").select("id, endpoint, p256dh, auth, failures").eq("user_id", userId);
  let sent = 0, failed = 0;
  for (const s of (subs || []) as (PushSubscription & { id: string; failures: number })[]) {
    const r = await sendPush(s, payload, keys, fetch, { urgency: "high" });
    if (r.ok) {
      sent++;
      await sb.from("email_push_subscriptions").update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq("id", s.id);
    } else {
      failed++;
      if (r.gone || s.failures >= 20) await sb.from("email_push_subscriptions").delete().eq("id", s.id);
      else await sb.from("email_push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
    }
  }
  return { sent, failed };
}

const PUSH_COLS = "id, account_id, direction, status, category, beleg_state, decided_at, from_name, from_addr, to_addrs, subject, summary, body_text";

/** Nach dem Verarbeiten eines Postfachs: neue eingehende Mails melden. Fehler hier halten nichts an. */
export async function notifyNewMail(sb: any, accountId: string): Promise<{ checked: number; sent: number }> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  // Rueckstand (z. B. nach einem neuen Postfach) nicht melden.
  await sb.from("email_messages").update({ pushed_at: now.toISOString() })
    .eq("account_id", accountId).is("pushed_at", null).lt("created_at", since);
  const { data } = await sb.from("email_messages").select(PUSH_COLS)
    .eq("account_id", accountId).eq("direction", "in").is("pushed_at", null).in("status", ["erledigt", "wartet"])
    .order("created_at").limit(50);
  const mails = (data || []) as PushMail[];
  if (!mails.length) return { checked: 0, sent: 0 };
  // Erst markieren, dann senden: lieber eine Nachricht verlieren als doppelt schicken.
  await sb.from("email_messages").update({ pushed_at: now.toISOString() }).in("id", mails.map((m) => m.id));

  const { count } = await sb.from("email_push_subscriptions").select("id", { count: "exact", head: true });
  if (!count) return { checked: mails.length, sent: 0 };
  const [audience, cfg] = await Promise.all([mailAudience(sb), getConfig<unknown>(sb, "topics", {}).then(normalizeTopicConfig)]);
  const users = [...new Set([...audience.values()].flat().map((u) => u.id))];
  const plan = planPushes(mails, audience, await loadPrefs(sb, users), cfg);
  if (!plan.size) return { checked: mails.length, sent: 0 };
  const keys = await loadVapid(sb);
  let sent = 0;
  for (const [userId, p] of plan) {
    for (const kind of ["decide", "incoming"] as const) {
      if (p[kind].length) sent += (await pushToUser(sb, userId, pushPayload(kind, p[kind]), keys)).sent;
    }
  }
  return { checked: mails.length, sent };
}
