// Nachfass-Mail senden (Klick in der Karte, Sammelkarte oder Autopilot „Automatisch“).
//
// Gesendet wird NICHT hier: `deliver` kommt von aussen und ist in email-send der bestehende Weg (`send`: HTML-Signatur
// des Postfachs, Thread zur letzten Kundenmail, Kopie in „Gesendet“, `email_sent.project_id` -> HERO-Logbuch wie bei jeder
// Mail der Mail-App). Hier stehen nur die Sicherheitsregeln:
//   * Schattenmodus (projects_write_enabled != "true"): nichts wird gesendet, nur protokolliert.
//   * Empfaenger, Betreff, Text kommen ausschliesslich aus dem gespeicherten Entwurf.
//   * Doppelversand: der Entwurf wird atomar von „draft“ auf „sending“ gesetzt.
//   * Automatisch nur mit Autopilot „auto“ (Projekt vor Regel), offener Karte (nicht Aufraeum-Karte), im Versandfenster
//     und unter dem Tageslimit.
//   * Hat der Kunde nach dem Entwurf geschrieben, wird nicht gesendet (Kette gestoppt).

import { isShadow } from "./access.ts";
import { berlinDayStartIso, effectiveAutopilot, inSendWindow, looksLikeEmail, parseWindow } from "./followup.ts";

export interface DeliverArgs { accountId: string; to: string; subject: string; text: string; replyTo: string | null; projectId: number }
export type Deliver = (a: DeliverArgs) => Promise<{ messageId: string; warnings: string[] }>;
export interface SendActor { name: string; id: string | null; canSee?: (p: { assignee_emails: string[] | null }) => boolean }
export interface SendOpts {
  draftId: string; actor: SendActor; auto: boolean; now?: Date;
  /** Nur als Rueckfall, wenn die Kopie nicht im Gesendet-Ordner landete (dann kommt sie nicht ueber den Abruf ins Logbuch). */
  logbook?: (heroId: number, text: string) => Promise<void>;
}
export interface SendResult { ok: true; shadow: boolean; message: string; warnings?: string[] }

export class FollowupError extends Error {}
const DAY = 86_400_000;

async function cfg(sb: any, key: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

async function logAction(sb: any, o: SendOpts, action: string, heroId: number, payload: Record<string, unknown>, shadow: boolean, extra: { error?: string; response?: unknown } = {}) {
  await sb.from("project_actions_log").insert({ user: o.actor.name, action, hero_id: heroId, payload, shadow, hero_response: extra.response ?? null, error: extra.error ?? null });
}

export async function sendFollowup(sb: any, deliver: Deliver, o: SendOpts): Promise<SendResult> {
  const now = o.now ?? new Date();
  const { data: draft } = await sb.from("project_followup_mails").select("*").eq("id", o.draftId).maybeSingle();
  if (!draft || draft.state !== "draft") throw new FollowupError("Dieser Entwurf ist nicht mehr offen (schon gesendet oder gestoppt).");
  const hero = Number(draft.hero_id);

  const { data: p } = await sb.from("hero_projects").select("hero_id, project_nr, name, assignee_emails").eq("hero_id", hero).maybeSingle();
  if (!p || (o.actor.canSee && !o.actor.canSee(p))) throw new FollowupError("Projekt nicht gefunden (nicht mehr offen?).");
  const { data: rule } = await sb.from("project_rules").select("*").eq("key", draft.rule_key).maybeSingle();
  if (!rule || !rule.active || rule.channel !== "mail") throw new FollowupError("Diese Regel versendet keine Mails (mehr).");

  const to = String(draft.to_email || "").trim().toLowerCase();
  const subject = String(draft.subject || "").trim();
  const text = String(draft.body || "").trim();
  if (!looksLikeEmail(to)) throw new FollowupError("Keine gültige Empfängeradresse im Entwurf.");
  if (!subject || !text) throw new FollowupError("Betreff und Text dürfen nicht leer sein.");

  // Hat der Kunde nach dem Entwurf geschrieben? Dann nicht senden, Kette stoppen.
  const { data: newer } = await sb.from("email_messages").select("id").eq("direction", "in").eq("hero_project_match_id", hero).is("trashed_at", null).gt("sent_at", draft.created_at);
  if ((newer || []).length) {
    await sb.from("project_followup_mails").update({ state: "stopped", stopped_reason: "Kunde hat geantwortet" }).eq("id", draft.id).eq("state", "draft");
    throw new FollowupError("Der Kunde hat inzwischen geantwortet – der Entwurf wurde gestoppt.");
  }

  if (o.auto) {
    const ap = await sb.from("project_autopilot").select("mode").eq("hero_id", hero).eq("rule_key", draft.rule_key).maybeSingle();
    if (effectiveAutopilot(rule.autopilot, ap.data?.mode) !== "auto") throw new FollowupError("Autopilot steht für dieses Projekt nicht auf „Automatisch“.");
    const card = await sb.from("project_cards").select("id").eq("hero_id", hero).eq("rule_key", draft.rule_key).eq("state", "open").eq("bundled", false);
    if (!(card.data || []).length) throw new FollowupError("Keine offene Karte (mehr) – nicht automatisch gesendet.");
    if (!inSendWindow(now, parseWindow(await cfg(sb, "projects_followup_hours")))) throw new FollowupError("Außerhalb des Versandfensters.");
    const max = Number(await cfg(sb, "projects_auto_max_per_day")) || 20;
    const { count } = await sb.from("project_actions_log").select("id", { count: "exact", head: true })
      .eq("action", "auto_followup").eq("shadow", false).gte("created_at", berlinDayStartIso(now));
    if ((count ?? 0) >= max) throw new FollowupError(`Tageslimit für automatische Mails erreicht (${max}).`);
  }

  const payload = { draftId: draft.id, to, subject, rule: draft.rule_key, stage: draft.stage, auto: o.auto };
  if (await isShadow(sb)) {
    await logAction(sb, o, o.auto ? "auto_followup" : "send_followup", hero, payload, true);
    return { ok: true, shadow: true, message: `Schattenmodus: Mail an ${to} wäre gesendet worden (nichts gesendet).` };
  }

  // Atomar beanspruchen: nur einer darf diesen Entwurf senden.
  const claim = await sb.from("project_followup_mails").update({ state: "sending", attempts: Number(draft.attempts || 0) + 1, error: null }).eq("id", draft.id).eq("state", "draft").select("id");
  if (!(claim.data || []).length) throw new FollowupError("Dieser Entwurf wird gerade gesendet.");
  const release = (error: string) => sb.from("project_followup_mails").update(
    o.auto ? { state: "stopped", stopped_reason: "Automatischer Versand fehlgeschlagen", error } : { state: "draft", error },
  ).eq("id", draft.id);

  // Postfach und Thread: das Postfach der letzten Kundenmail zu diesem Projekt (Antwort im selben Thread).
  const lastR = await sb.from("email_messages").select("id, account_id, sent_at").eq("direction", "in").eq("hero_project_match_id", hero).is("trashed_at", null).order("sent_at", { ascending: false }).limit(1);
  const last = (lastR.data || [])[0] as { id: string; account_id: string } | undefined;
  let accountId = last?.account_id ?? (await cfg(sb, "projects_followup_account_id")) ?? "";
  if (!accountId) {
    const { data: accs } = await sb.from("email_accounts").select("id, smtp_host").eq("enabled", true);
    accountId = (accs || []).find((a: any) => a.smtp_host)?.id ?? "";
  }
  if (!accountId) {
    const msg = "Kein Postfach zum Senden gefunden (Einstellungen → Postfächer, SMTP).";
    await release(msg); await logAction(sb, o, o.auto ? "auto_followup" : "send_followup", hero, payload, false, { error: msg });
    throw new FollowupError(msg);
  }

  let res: { messageId: string; warnings: string[] };
  try {
    res = await deliver({ accountId, to, subject, text, replyTo: last?.id ?? null, projectId: hero });
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 300);
    await release(msg);
    await logAction(sb, o, o.auto ? "auto_followup" : "send_followup", hero, payload, false, { error: msg });
    throw e;
  }

  // Ab hier ist die Mail draussen. Nacharbeiten duerfen den Versand nicht mehr als Fehler melden.
  const warnings = [...(res.warnings || [])];
  await sb.from("project_followup_mails").update({ state: "sent", sent_at: now.toISOString(), message_id: res.messageId, auto: o.auto, error: null }).eq("id", draft.id);
  const due = new Date(now.getTime() + (Number(rule.followup_days) || 7) * DAY);
  due.setUTCHours(6, 0, 0, 0);
  await sb.from("followups").update({ done_at: now.toISOString() }).eq("target_type", "project").eq("hero_id", hero).is("done_at", null);
  await sb.from("followups").insert({ target_type: "project", hero_id: hero, due_at: due.toISOString(), reason: rule.followup_reason || "Nachgefasst", stage: Number(draft.stage) || 1, created_by: o.actor.id });
  await sb.from("project_cards").update({ state: "snoozed" }).eq("hero_id", hero).in("state", ["open", "in_hero"]);
  if (warnings.length && o.logbook) {
    try { await o.logbook(hero, `Nachfass-Mail (Stufe ${draft.stage}) gesendet an ${to}: ${subject}`); } catch (e) { warnings.push(`Logbuch-Eintrag fehlgeschlagen: ${(e as Error).message}`); }
  }
  await logAction(sb, o, o.auto ? "auto_followup" : "send_followup", hero, { ...payload, messageId: res.messageId }, false, { response: { warnings } });
  return { ok: true, shadow: false, message: `Mail an ${to} gesendet.`, ...(warnings.length ? { warnings } : {}) };
}

/**
 * Entwuerfe, die der Autopilot jetzt senden darf (Auswahl fuer followup-runner; sendFollowup prueft alles noch einmal):
 * Entwurf offen, Autopilot „auto“ (Projekt vor Regel), offene Karte (keine Aufraeum-Karte), noch kein Fehlversuch.
 * Aelteste zuerst, hoechstens `limit`.
 */
export async function selectAutoDrafts(sb: any, limit: number): Promise<string[]> {
  const [drafts, rules, ap, cards] = await Promise.all([
    sb.from("project_followup_mails").select("id, hero_id, rule_key, created_at, attempts").eq("state", "draft"),
    sb.from("project_rules").select("key, autopilot, channel, active"),
    sb.from("project_autopilot").select("hero_id, rule_key, mode"),
    sb.from("project_cards").select("hero_id, rule_key").eq("state", "open").eq("bundled", false),
  ]);
  const ruleBy = new Map<string, any>((rules.data || []).map((r: any) => [r.key, r]));
  const override = new Map<string, string>((ap.data || []).map((a: any) => [`${a.hero_id}:${a.rule_key}`, a.mode]));
  const open = new Set<string>((cards.data || []).map((c: any) => `${c.hero_id}:${c.rule_key}`));
  return (drafts.data || [])
    .filter((d: any) => {
      const r = ruleBy.get(d.rule_key);
      const k = `${d.hero_id}:${d.rule_key}`;
      return r?.active && r.channel === "mail" && !Number(d.attempts) && open.has(k) && effectiveAutopilot(r.autopilot, override.get(k)) === "auto";
    })
    .sort((a: any, b: any) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(0, Math.max(0, limit))
    .map((d: any) => d.id as string);
}
