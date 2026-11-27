// Alarm bei rotem Nachttest (hero-calc-contract): Push an alle Admin-Geräte der Mail-App (sobald welche eingetragen sind)
// UND Mail an info@slwerbung.de als Zwischenlösung (bis Silas den Kanal festlegt). Höchstens eine Meldung je 24 Stunden.
// Inhalt: nur Schrittnamen und kurze Fehlertexte der Testläufe auf WER-1984, keine Kundendaten, nie Zugangsdaten.
import { sendPush, type PushSubscription, type VapidKeys } from "../email/webpush.ts";
import { allOk, type Step } from "./contract.ts";

export const ALERT_MAIL_TO = "info@slwerbung.de";
export const ALERT_COOLDOWN_MS = 24 * 3600_000;

const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface AlertText { title: string; body: string; text: string }

/** Text der Meldung (reine Logik). */
export function buildAlert(mode: string, steps: Step[]): AlertText {
  const failed = steps.filter((s) => !s.ok);
  const lines = failed.slice(0, 5).map((s) => `- ${s.name}${s.detail ? `: ${cut(s.detail, 160)}` : ""}`);
  if (failed.length > 5) lines.push(`… und ${failed.length - 5} weitere`);
  const title = mode === "contract" ? "hero-calc Vertragstest ROT" : `hero-calc ${mode} ROT`;
  const body = cut(lines.join("\n") || "Test fehlgeschlagen", 300);
  const text = [
    `${title}.`,
    "Der nächtliche Test gegen die Test-Entwürfe in WER-1984 ist fehlgeschlagen. Wahrscheinlich hat HERO den internen Endpoint geändert.",
    "Bis zur Klärung hero-calc nicht für echte Angebote benutzen.",
    "",
    "Fehlgeschlagen:",
    ...lines,
    "",
    "Details: select created_at, ok, detail from hero_calc_contract_log order by id desc limit 5;",
  ].join("\n");
  return { title, body, text };
}

export interface AlertDeps {
  fetchFn?: typeof fetch;
  resendKey?: string | null;
  sendPushFn?: typeof sendPush;
  now?: number;
}
export interface AlertResult { alerted: boolean; reason: string; push: number; mail: boolean; errors: string[] }

async function pushToAdmins(sb: any, a: AlertText, deps: AlertDeps): Promise<number> {
  const { data: admins } = await sb.from("profiles").select("id").eq("role", "admin").eq("is_active", true);
  const ids = ((admins ?? []) as any[]).map((r) => r.id);
  if (!ids.length) return 0;
  const { data: subs } = await sb.from("email_push_subscriptions").select("id, endpoint, p256dh, auth, failures").in("user_id", ids);
  if (!subs?.length) return 0;
  const { data: cfg } = await sb.from("email_config").select("value").eq("key", "push_vapid").maybeSingle();
  const keys = cfg?.value as VapidKeys | undefined;
  if (!keys?.publicKey) return 0;
  const send = deps.sendPushFn ?? sendPush;
  let sent = 0;
  for (const s of subs as (PushSubscription & { id: string; failures: number })[]) {
    const r = await send(s, { title: a.title, body: a.body, url: "/", tag: "hero-calc-contract" }, keys, deps.fetchFn ?? fetch, { urgency: "high" });
    if (r.ok) {
      sent++;
      await sb.from("email_push_subscriptions").update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq("id", s.id);
    } else if (r.gone || s.failures >= 20) {
      await sb.from("email_push_subscriptions").delete().eq("id", s.id);
    } else {
      await sb.from("email_push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
    }
  }
  return sent;
}

async function sendMail(a: AlertText, deps: AlertDeps): Promise<void> {
  if (!deps.resendKey) throw new Error("RESEND_API_KEY fehlt");
  const res = await (deps.fetchFn ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${deps.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "hero-calc Alarm <notifications@captfix.app>", to: [ALERT_MAIL_TO], subject: a.title, text: a.text }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
}

/**
 * Meldet einen roten Testlauf (höchstens einmal je 24 h). `logId` ist die Zeile in hero_calc_contract_log,
 * die als gemeldet markiert wird. Fehler beim Melden verdecken nie das Testergebnis.
 */
export async function alertOnFailure(sb: any, logId: number | null, mode: string, steps: Step[], deps: AlertDeps = {}): Promise<AlertResult> {
  const res: AlertResult = { alerted: false, reason: "", push: 0, mail: false, errors: [] };
  if (allOk(steps)) return { ...res, reason: "ok" };

  const since = new Date((deps.now ?? Date.now()) - ALERT_COOLDOWN_MS).toISOString();
  const { data: recent } = await sb.from("hero_calc_contract_log").select("id").eq("alerted", true).gt("created_at", since).limit(1);
  if (recent?.length) return { ...res, reason: "throttled" };

  const a = buildAlert(mode, steps);
  try { res.push = await pushToAdmins(sb, a, deps); } catch (e) { res.errors.push(`push: ${msg(e)}`); }
  try { await sendMail(a, deps); res.mail = true; } catch (e) { res.errors.push(`mail: ${msg(e)}`); }

  res.alerted = res.push > 0 || res.mail;
  res.reason = res.alerted ? "sent" : "no_channel_worked";
  if (res.alerted && logId !== null) {
    await sb.from("hero_calc_contract_log").update({ alerted: true }).eq("id", logId).then(() => {}, () => {});
  }
  return res;
}
