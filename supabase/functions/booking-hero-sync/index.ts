// HERO-Leserichtung: Termine aus HERO werden zu `busy_block(source='hero')`,
// damit sie in der Terminsuche blockieren.
//
// Aufruf durch pg_cron alle 10 Minuten (Header `x-poll-secret`), zusaetzlich
// von Hand mit einem Admin-Token. HERO hat fuer uns keine Webhooks
// freigeschaltet, deshalb Polling.
//
// Zwei Dinge, die hier leicht schiefgehen und deshalb ausdruecklich geloest
// sind:
//   * Unsere EIGENEN Buchungen stehen nach dem Schreiben auch in HERO. Sie
//     werden hier ausgeklammert, sonst blockiert derselbe Termin doppelt.
//   * Ein in HERO geloeschter oder umgehaengter Termin muss auch bei uns
//     verschwinden. Deshalb wird das Fenster abgeglichen, nicht nur ergaenzt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DateTime } from "luxon";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-poll-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TZ = "Europe/Berlin";
const HERO_URL = "https://login.hero-software.de/api/external/v9/graphql";
const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

interface HeroEvent {
  id: number;
  title: string | null;
  start: string;
  end: string | null;
  all_day: boolean | null;
  deleted: boolean | null;
  category: { id: number; name: string | null } | null;
  partners: { id: number }[] | null;
}

/**
 * Termine im Zeitraum. `start`/`end` sind DateTime-Argumente und brauchen eine
 * Zeitzone ("2026-09-24T00:00:00+02:00") — ohne Offset antwortet HERO mit
 * "Internal server error".
 */
async function loadEvents(apiKey: string, fromIso: string, toIso: string): Promise<HeroEvent[]> {
  const query = `
    query Events($start: DateTime, $end: DateTime) {
      calendar_events(start: $start, end: $end) {
        id
        title
        start
        end
        all_day
        deleted
        category { id name }
        partners { id }
      }
    }
  `;
  const resp = await fetch(HERO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables: { start: fromIso, end: toIso } }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HERO HTTP ${resp.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  // HERO liefert bei Teilfehlern data UND errors — beides pruefen.
  if (data.errors?.length && !data.data?.calendar_events) {
    throw new Error(data.errors[0]?.message || "HERO GraphQL-Fehler");
  }
  return (data.data?.calendar_events ?? []) as HeroEvent[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);

  const db = sb();
  try {
    const body = await req.json().catch(() => ({}));

    const { data: cfgRows } = await db.from("app_config").select("key, value").in("key", [
      "hero_enabled", "hero_api_key", "booking_hero_read",
      "booking_hero_sync_days", "booking_poll_secret",
    ]);
    const cfg = new Map((cfgRows ?? []).map((r: any) => [r.key, r.value]));

    // Auth: Poll-Secret (pg_cron) oder Admin-Token (Knopf "Jetzt abgleichen"
    // im Adminmenue).
    const secret = cfg.get("booking_poll_secret");
    const given = req.headers.get("x-poll-secret") || String((body as any).pollSecret || "");
    let allowed = !!secret && given === secret;
    if (!allowed && (body as any).adminToken) {
      const payload = await verifySessionToken(String((body as any).adminToken), getSessionSecret());
      allowed = payload?.role === "admin";
    }
    if (!allowed) return json({ error: "Unauthorized" }, 401);

    if (cfg.get("hero_enabled") !== "true") return json({ skipped: "HERO ist nicht aktiv" });
    if (cfg.get("booking_hero_read") === "false") return json({ skipped: "HERO-Lesen ist abgeschaltet" });
    const apiKey = (cfg.get("hero_api_key") as string) || "";
    if (!apiKey) return json({ skipped: "Kein HERO-Schluessel hinterlegt" });

    // ── Mitarbeiter-Zuordnung ──
    // HERO kennt "Partner", wir kennen `staff`. Die Bruecke ist
    // employees.hero_partner_id. Ohne Zuordnung wissen wir nicht, wessen Zeit
    // belegt ist — dann gibt es hier nichts zu tun.
    const { data: staffRows } = await db.from("staff")
      .select("id, employee_id").eq("active", true).not("employee_id", "is", null);
    const employeeIds = (staffRows ?? []).map((s: any) => s.employee_id);
    if (employeeIds.length === 0) return json({ skipped: "Kein Mitarbeiter mit HERO-Zuordnung" });

    const { data: empRows } = await db.from("employees")
      .select("id, hero_partner_id").in("id", employeeIds).not("hero_partner_id", "is", null);
    const staffByPartner = new Map<number, string>();
    for (const s of staffRows ?? []) {
      const emp = (empRows ?? []).find((e: any) => e.id === (s as any).employee_id);
      const pid = Number((emp as any)?.hero_partner_id);
      if (Number.isFinite(pid) && pid > 0) staffByPartner.set(pid, (s as any).id);
    }
    if (staffByPartner.size === 0) return json({ skipped: "Kein Mitarbeiter mit HERO-Partner-ID" });

    // ── Zeitfenster ──
    const days = Math.min(365, Math.max(1, parseInt(String(cfg.get("booking_hero_sync_days") ?? "60"), 10) || 60));
    const from = DateTime.now().setZone(TZ).startOf("day");
    const to = from.plus({ days });

    const events = await loadEvents(apiKey, from.toISO()!, to.toISO()!);

    // Unsere eigenen Termine ausklammern: die blockieren bereits als
    // busy_block(source='booking'). Sonst steht derselbe Termin zweimal im Weg.
    const { data: ownRows } = await db.from("booking")
      .select("hero_event_ref").not("hero_event_ref", "is", null)
      .in("status", ["pending", "confirmed"]);
    const own = new Set((ownRows ?? []).map((r: any) => String(r.hero_event_ref)));

    // ── Kategorien ──
    // Jede HERO-Kategorie bekommt eine eigene Zeile, damit sich im Adminmenue
    // einzeln sagen laesst, ob sie blockiert ("Buero" ja, "Schule" vielleicht
    // nicht). Neue Kategorien blockieren erst einmal — das ist die sichere
    // Richtung.
    const { data: catRows } = await db.from("appointment_category").select("key");
    const known = new Set((catRows ?? []).map((c: any) => c.key));
    const newCats: Record<string, unknown>[] = [];
    const seenCats = new Set<string>();
    for (const ev of events) {
      if (!ev.category?.id) continue;
      const key = `hero:${ev.category.id}`;
      if (known.has(key) || seenCats.has(key)) continue;
      seenCats.add(key);
      newCats.push({
        key, label: ev.category.name || `HERO-Kategorie ${ev.category.id}`,
        source: "hero", blocks_availability: true, is_bookable: false,
      });
    }
    if (newCats.length > 0) {
      await db.from("appointment_category").upsert(newCats, { onConflict: "key", ignoreDuplicates: true });
    }

    // ── Blocks bilden ──
    const rows: Record<string, unknown>[] = [];
    const wanted = new Set<string>(); // "source_ref|staff_id"
    let skippedOwn = 0;
    for (const ev of events) {
      if (ev.deleted) continue;
      const ref = String(ev.id);
      if (own.has(ref)) { skippedOwn++; continue; }

      const startDt = DateTime.fromISO(ev.start, { zone: TZ });
      if (!startDt.isValid) continue;
      // Ganztaegig oder ohne Ende: den ganzen Tag sperren. Lieber einen Tag zu
      // viel blockiert als einen Termin doppelt vergeben.
      let endDt = ev.end ? DateTime.fromISO(ev.end, { zone: TZ }) : startDt.endOf("day");
      if (!endDt.isValid || endDt <= startDt) {
        endDt = ev.all_day ? startDt.endOf("day") : startDt.plus({ hours: 1 });
      }

      for (const p of ev.partners ?? []) {
        const staffId = staffByPartner.get(Number(p?.id));
        if (!staffId) continue;
        const key = `${ref}|${staffId}`;
        if (wanted.has(key)) continue;
        wanted.add(key);
        rows.push({
          staff_id: staffId,
          starts_at: startDt.toUTC().toISO(),
          ends_at: endDt.toUTC().toISO(),
          source: "hero",
          source_ref: ref,
          category_key: ev.category?.id ? `hero:${ev.category.id}` : null,
          geo_lat: null, geo_lng: null,
        });
      }
    }

    if (rows.length > 0) {
      const { error } = await db.from("busy_block")
        .upsert(rows, { onConflict: "source,source_ref,staff_id" });
      if (error) throw new Error(`busy_block: ${error.message}`);
    }

    // ── Abgleich statt nur ergaenzen ──
    // Alles, was im Fenster als HERO-Block liegt, aber nicht mehr aus HERO
    // kommt, ist geloescht oder umgehaengt worden und muss weg — sonst bleibt
    // eine Zeit fuer immer gesperrt.
    const { data: existing } = await db.from("busy_block")
      .select("id, source_ref, staff_id").eq("source", "hero")
      .gte("starts_at", from.toUTC().toISO()!).lt("starts_at", to.toUTC().toISO()!);
    const stale = (existing ?? [])
      .filter((b: any) => !wanted.has(`${b.source_ref}|${b.staff_id}`))
      .map((b: any) => b.id);
    if (stale.length > 0) await db.from("busy_block").delete().in("id", stale);

    return json({
      ok: true,
      window: { from: from.toISO(), to: to.toISO(), days },
      events: events.length,
      blocks: rows.length,
      removed: stale.length,
      skippedOwn,
      newCategories: newCats.map((c) => c.key),
    });
  } catch (e: any) {
    // Fehler als 200 mit Fehlertext: supabase.functions.invoke verschluckt
    // Non-2xx-Bodies, und der Cron-Lauf soll auswertbar bleiben.
    console.error("[booking-hero-sync]", e?.message || e);
    return json({ ok: false, error: e?.message || String(e) });
  }
});
