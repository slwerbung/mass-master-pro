// Buchungs-API (M3). Öffentliche Endpunkte für die Buchungsseite; rechnet
// Verfügbarkeit IMMER serverseitig (Engine) und schützt gegen Doppelbuchung
// über den GiST-Exclusion-Constraint (→ 409). Externe Spiegelung (Google/Hero)
// kommt in M4/M6; hier bewusst noch nicht.
//
// verify_jwt=false: eigenes Modell. Nur diese Handler existieren — Slots lesen
// und Buchung anlegen/stornieren. Nie Config schreiben. Zugriff via service_role.
//
// Aktionen:
//   GET  ?action=rule-sets
//   GET  ?action=availability&ruleSet=&from=&to=&lat=&lng=
//   POST { action:'create', ruleSet, slot:{startsAt,endsAt}, staffId,
//          customer:{name,email,phone}, address:{text,lat,lng}, answers }
//   POST { action:'cancel', cancelToken }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DateTime } from "luxon";
import { computeSlots } from "../_shared/booking/engine.ts";
import { buildComputeInput, ruleSetConfigFromRow } from "../_shared/booking/inputs.ts";
import type { Geo } from "../_shared/booking/types.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TZ = "Europe/Berlin";
const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/** Lädt alle Zeilen für ein Regelset im Zeitraum und liefert die Slots. */
async function availabilityFor(db: ReturnType<typeof sb>, ruleSetKey: string, from: string, to: string, address: Geo | null) {
  const { data: rs } = await db.from("rule_set").select("*").eq("key", ruleSetKey).eq("active", true).maybeSingle();
  if (!rs) return { error: "Terminart nicht gefunden" as const };

  // Mitarbeiter-Pool: explizit zugeordnet, sonst alle aktiven.
  const { data: rss } = await db.from("rule_set_staff").select("staff_id").eq("rule_set_id", rs.id);
  let staffIds = (rss ?? []).map((r: any) => r.staff_id);
  if (staffIds.length === 0) {
    const { data: all } = await db.from("staff").select("id").eq("active", true);
    staffIds = (all ?? []).map((s: any) => s.id);
  }
  if (staffIds.length === 0) return { rs, slots: [] as any[] };

  const [{ data: staff }, { data: wh }, { data: exc }, { data: busy }, { data: bookings }, { data: cats }] = await Promise.all([
    db.from("staff").select("id, skills, home_base_lat, home_base_lng").in("id", staffIds).eq("active", true),
    db.from("working_hours").select("staff_id, weekday, start_time, end_time").in("staff_id", staffIds),
    db.from("working_hours_exception").select("staff_id, date, is_available, start_time, end_time").in("staff_id", staffIds).gte("date", from.slice(0, 10)).lte("date", to.slice(0, 10)),
    db.from("busy_block").select("staff_id, starts_at, ends_at, category_key, geo_lat, geo_lng").in("staff_id", staffIds).gt("ends_at", from).lt("starts_at", to),
    db.from("booking").select("staff_id, starts_at, status").in("staff_id", staffIds).in("status", ["pending", "confirmed"]).gte("starts_at", from).lt("starts_at", to),
    db.from("appointment_category").select("key, blocks_availability"),
  ]);

  const categoryBlocks: Record<string, boolean> = {};
  for (const c of cats ?? []) categoryBlocks[(c as any).key] = (c as any).blocks_availability;

  const input = buildComputeInput({
    ruleSet: rs as any, staff: staff ?? [], workingHours: wh ?? [], exceptions: exc ?? [],
    busy: busy ?? [], bookingCounts: bookings ?? [], categoryBlocks,
    now: new Date().toISOString(), from, to, address, timezone: TZ,
  });
  const slots = await computeSlots(input);
  return { rs, slots };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const db = sb();
  try {
    const url = new URL(req.url);

    // ── GET: rule-sets / availability ──────────────────────────────────────
    if (req.method === "GET") {
      const action = url.searchParams.get("action");
      if (action === "rule-sets") {
        const { data } = await db
          .from("rule_set")
          .select("key, label, duration_minutes, duration_options, form_fields, appointment_category!inner(is_bookable)")
          .eq("active", true)
          .eq("appointment_category.is_bookable", true);
        const list = (data ?? []).map((r: any) => ({
          key: r.key, label: r.label, durationMinutes: r.duration_minutes,
          durationOptions: r.duration_options ?? null, formFields: r.form_fields ?? [],
        }));
        return json({ ruleSets: list });
      }
      if (action === "availability") {
        const ruleSet = url.searchParams.get("ruleSet") || "";
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        if (!ruleSet || !from || !to) return json({ error: "ruleSet, from, to erforderlich" }, 400);
        const lat = parseFloat(url.searchParams.get("lat") || "");
        const lng = parseFloat(url.searchParams.get("lng") || "");
        const address = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        const res = await availabilityFor(db, ruleSet, from, to, address);
        if ("error" in res) return json(res, 404);
        return json({ slots: res.slots });
      }
      return json({ error: "Unbekannte Aktion" }, 400);
    }

    // ── POST: create / cancel ──────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();

      if (body.action === "cancel") {
        const token = String(body.cancelToken || "");
        if (!token) return json({ error: "cancelToken erforderlich" }, 400);
        const { data: bk } = await db.from("booking").select("id, status").eq("cancel_token", token).maybeSingle();
        if (!bk) return json({ error: "Buchung nicht gefunden" }, 404);
        if (bk.status === "cancelled") return json({ ok: true, status: "cancelled" });
        await db.from("booking").update({ status: "cancelled" }).eq("id", bk.id);
        await db.from("busy_block").delete().eq("source", "booking").eq("source_ref", bk.id);
        await db.from("notification").insert({ booking_id: bk.id, kind: "cancellation" });
        return json({ ok: true, status: "cancelled" });
      }

      if (body.action === "create") {
        const ruleSetKey = String(body.ruleSet || "");
        const slot = body.slot || {};
        const staffId = String(body.staffId || "");
        const customer = body.customer || {};
        const addr = body.address || {};
        if (!ruleSetKey || !slot.startsAt || !slot.endsAt || !staffId || !customer.email || !customer.name) {
          return json({ error: "Pflichtfelder fehlen" }, 400);
        }
        const address: Geo | null = (Number.isFinite(addr.lat) && Number.isFinite(addr.lng)) ? { lat: addr.lat, lng: addr.lng } : null;

        // Verfügbarkeit für den Tag NEU rechnen (kein Vertrauen aufs Frontend).
        const dayStart = DateTime.fromISO(slot.startsAt, { zone: "utc" }).setZone(TZ).startOf("day");
        const res = await availabilityFor(db, ruleSetKey, dayStart.toUTC().toISO()!, dayStart.plus({ days: 1 }).toUTC().toISO()!, address);
        if ("error" in res) return json(res, 404);
        const wanted = DateTime.fromISO(slot.startsAt, { zone: "utc" }).toISO();
        const stillFree = res.slots.some((s: any) =>
          DateTime.fromISO(s.startsAt, { zone: "utc" }).toISO() === wanted &&
          (s.assignedStaffId === staffId || (s.staffIds ?? []).includes(staffId)));
        if (!stillFree) return json({ error: "Dieser Termin ist nicht mehr verfügbar." }, 409);

        const rs: any = res.rs;
        const cfg = ruleSetConfigFromRow(rs);
        const { data: cat } = await db.from("appointment_category").select("key").eq("id", rs.category_id).maybeSingle();
        const status = rs.requires_approval ? "pending" : "confirmed";
        const cancelToken = crypto.randomUUID();
        const rescheduleToken = crypto.randomUUID();

        const { data: created, error: insErr } = await db.from("booking").insert({
          rule_set_id: rs.id, staff_id: staffId, starts_at: slot.startsAt, ends_at: slot.endsAt,
          status, customer_name: customer.name, customer_email: customer.email, customer_phone: customer.phone ?? null,
          address: addr.text ?? null, address_lat: address?.lat ?? null, address_lng: address?.lng ?? null,
          answers: body.answers ?? {}, cancel_token: cancelToken, reschedule_token: rescheduleToken,
        }).select("id, status, starts_at, ends_at").single();

        if (insErr) {
          // GiST-Exclusion (23P01) oder Unique (23505) → Slot inzwischen vergeben.
          if (insErr.code === "23P01" || insErr.code === "23505") return json({ error: "Dieser Termin wurde gerade vergeben." }, 409);
          return json({ error: insErr.message }, 500);
        }

        // Belegung spiegeln (source=booking, idempotent über source_ref).
        await db.from("busy_block").insert({
          staff_id: staffId, starts_at: slot.startsAt, ends_at: slot.endsAt, source: "booking",
          source_ref: created!.id, category_key: cat?.key ?? null,
          geo_lat: address?.lat ?? null, geo_lng: address?.lng ?? null,
        });

        // Outbox-Zeilen (Versand kommt mit dem Worker in M5).
        const notes: any[] = [{ booking_id: created!.id, kind: "confirmation" }, { booking_id: created!.id, kind: "internal_new" }];
        if (status === "confirmed") {
          const offsets = (Array.isArray((rs.config || {}).reminder_offsets_min) ? rs.config.reminder_offsets_min : [1440, 180]) as number[];
          const start = DateTime.fromISO(slot.startsAt, { zone: "utc" });
          for (const off of offsets) {
            const sendAfter = start.minus({ minutes: off });
            if (sendAfter.toMillis() > Date.now()) notes.push({ booking_id: created!.id, kind: "reminder", send_after: sendAfter.toUTC().toISO() });
          }
        }
        await db.from("notification").insert(notes);

        return json({ ok: true, booking: { id: created!.id, status: created!.status, startsAt: created!.starts_at, endsAt: created!.ends_at }, cancelToken });
      }

      return json({ error: "Unbekannte Aktion" }, 400);
    }

    return json({ error: "Methode nicht erlaubt" }, 405);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
