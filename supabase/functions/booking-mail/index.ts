// Outbox-Worker fuer die Terminmails.
//
// Die Buchung selbst verschickt nichts, sie legt nur Zeilen in `notification`
// ab. Das hier arbeitet sie ab. Der Grund: eine Buchung darf nicht scheitern,
// weil der Mailanbieter gerade zickt, und eine Erinnerung muss Tage spaeter
// rausgehen, ohne dass irgendwer wartet.
//
// Aufruf durch pg_cron (Header `x-poll-secret`) oder von Hand mit Admin-Token.
//
// Wichtig: eine Erinnerung an einen abgesagten Termin darf NIE rausgehen. Sie
// steht zum Buchungszeitpunkt schon in der Outbox, also wird beim Versenden
// noch einmal auf den Status geschaut.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DateTime } from "luxon";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";
import { buildIcs, toBase64 } from "../_shared/booking/ics.ts";
import { buildBookingMail, type MailInfo, type MailKind } from "../_shared/booking/mails.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-poll-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const APP_BASE = "https://captfix.app";
const FROM = "Captfix <notifications@captfix.app>";
const MAX_ATTEMPTS = 5;
const BATCH = 20;
const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

interface Attachment { filename: string; content: string; content_type?: string }

async function sendMail(
  apiKey: string, to: string, subject: string, html: string, attachments?: Attachment[],
): Promise<void> {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, ...(attachments?.length ? { attachments } : {}) }),
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
}

/** Der Kalendereintrag. Gleiche UID wie bei der Einladung, damit eine Absage
 *  im Kalender den bestehenden Termin trifft statt einen zweiten anzulegen. */
function icsFor(kind: MailKind, bk: any, label: string, address: string | null): Attachment | null {
  if (kind !== "confirmation" && kind !== "cancellation") return null;
  const text = buildIcs({
    uid: `booking-${bk.id}@captfix.app`,
    start: new Date(bk.starts_at),
    end: new Date(bk.ends_at),
    summary: `${label}${bk.customer_name ? ` – ${bk.customer_name}` : ""}`,
    location: address ?? undefined,
    organizer: { name: "SL WERBUNG", email: "info@slwerbung.de" },
    method: kind === "cancellation" ? "CANCEL" : "REQUEST",
    sequence: kind === "cancellation" ? 1 : 0,
  });
  return { filename: "termin.ics", content: toBase64(text), content_type: "text/calendar; charset=utf-8" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);

  const db = sb();
  try {
    const body = await req.json().catch(() => ({}));

    const { data: cfgRows } = await db.from("app_config").select("key, value")
      .in("key", ["booking_poll_secret", "booking_notify_internal", "notification_global_email"]);
    const cfg = new Map((cfgRows ?? []).map((r: any) => [r.key, r.value]));

    const secret = cfg.get("booking_poll_secret");
    const given = req.headers.get("x-poll-secret") || String((body as any).pollSecret || "");
    let allowed = !!secret && given === secret;
    if (!allowed && (body as any).adminToken) {
      const payload = await verifySessionToken(String((body as any).adminToken), getSessionSecret());
      allowed = payload?.role === "admin";
    }
    if (!allowed) return json({ error: "Unauthorized" }, 401);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "RESEND_API_KEY ist nicht gesetzt" }, 500);

    const internal = String(cfg.get("booking_notify_internal") || cfg.get("notification_global_email") || "").trim();

    // Faellige Zeilen. `send_after` steuert die Erinnerung, `attempts` sorgt
    // dafuer, dass eine dauerhaft kaputte Adresse nicht ewig wiederholt wird.
    const { data: due, error: dueErr } = await db.from("notification")
      .select(`id, kind, attempts, booking_id,
               booking:booking_id ( id, status, starts_at, ends_at, customer_name, customer_email,
                                    address, answers, cancel_token, staff_token, cancel_reason,
                                    project_id, staff_id, rule_set_id )`)
      .is("sent_at", null)
      .lte("send_after", new Date().toISOString())
      .lt("attempts", MAX_ATTEMPTS)
      .order("send_after")
      .limit(BATCH);
    if (dueErr) return json({ error: dueErr.message }, 500);
    if (!due || due.length === 0) return json({ ok: true, due: 0 });

    // Bezeichnungen und Namen in einem Zug nachladen.
    const ruleSetIds = [...new Set(due.map((n: any) => n.booking?.rule_set_id).filter(Boolean))];
    const staffIds = [...new Set(due.map((n: any) => n.booking?.staff_id).filter(Boolean))];
    const [{ data: ruleSets }, { data: staff }] = await Promise.all([
      ruleSetIds.length ? db.from("rule_set").select("id, label").in("id", ruleSetIds) : Promise.resolve({ data: [] }),
      staffIds.length ? db.from("staff").select("id, display_name").in("id", staffIds) : Promise.resolve({ data: [] }),
    ]);
    const labelOf = new Map((ruleSets ?? []).map((r: any) => [r.id, r.label]));
    const staffOf = new Map((staff ?? []).map((s: any) => [s.id, s.display_name]));

    let sent = 0, skipped = 0, failed = 0;
    const errors: string[] = [];

    for (const n of due as any[]) {
      const bk = n.booking;
      const kind = n.kind as MailKind;
      try {
        if (!bk) throw new Error("Buchung fehlt");

        // Nichts verschicken, was inzwischen gegenstandslos ist.
        const gegenstandslos =
          (kind === "confirmation" || kind === "reminder") && bk.status === "cancelled";
        const empfaenger = kind === "internal_new" ? internal : String(bk.customer_email || "").trim();
        if (gegenstandslos || !empfaenger) {
          await db.from("notification").update({
            sent_at: new Date().toISOString(),
            last_error: gegenstandslos ? "Termin war abgesagt, nicht verschickt" : "Kein Empfaenger",
          }).eq("id", n.id);
          skipped++;
          continue;
        }

        const label = labelOf.get(bk.rule_set_id) || "Termin vor Ort";
        const info: MailInfo = {
          customerName: bk.customer_name || "",
          projectNumber: "",
          label,
          start: bk.starts_at,
          end: bk.ends_at,
          address: bk.address ?? null,
          hinweis: (bk.answers as any)?.hinweis ?? null,
          staffName: kind === "internal_new" ? (staffOf.get(bk.staff_id) ?? null) : null,
          cancelReason: bk.cancel_reason ?? null,
          cancelUrl: bk.cancel_token ? `${APP_BASE}/termin/absagen/${bk.cancel_token}` : undefined,
          bookingUrl: bk.project_id ? `${APP_BASE}/termin/${bk.project_id}` : undefined,
          staffCancelUrl: bk.staff_token ? `${APP_BASE}/termin/intern/${bk.staff_token}?mode=cancel` : undefined,
          staffRescheduleUrl: bk.staff_token ? `${APP_BASE}/termin/intern/${bk.staff_token}?mode=reschedule` : undefined,
        };

        // Projektnummer nur holen, wenn es ein Projekt gibt.
        if (bk.project_id) {
          const { data: proj } = await db.from("projects")
            .select("project_number").eq("id", bk.project_id).maybeSingle();
          info.projectNumber = (proj as any)?.project_number || "";
        }

        const { subject, html } = buildBookingMail(kind, info);
        const ics = icsFor(kind, bk, label, info.address);
        await sendMail(resendKey, empfaenger, subject, html, ics ? [ics] : undefined);

        await db.from("notification").update({ sent_at: new Date().toISOString(), last_error: null }).eq("id", n.id);
        sent++;
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        errors.push(`${n.kind}/${n.id}: ${msg}`);
        await db.from("notification").update({
          attempts: (n.attempts ?? 0) + 1,
          last_error: msg.slice(0, 500),
        }).eq("id", n.id);
        failed++;
      }
    }

    return json({
      ok: true, due: due.length, sent, skipped, failed,
      errors: errors.slice(0, 5),
      now: DateTime.now().setZone("Europe/Berlin").toISO(),
    });
  } catch (e: any) {
    console.error("[booking-mail]", e?.message || e);
    return json({ ok: false, error: e?.message || String(e) });
  }
});
