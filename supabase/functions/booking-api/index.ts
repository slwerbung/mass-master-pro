// Buchungs-API. Oeffentliche Endpunkte fuer die projektbezogene Buchungsseite.
//
// Grundsaetze:
//   * Verfuegbarkeit wird IMMER serverseitig gerechnet. Dem Frontend wird beim
//     Buchen nichts geglaubt: der Tag wird noch einmal neu berechnet.
//   * Letzte Wahrheit gegen Doppelbuchung ist der GiST-Exclusion-Constraint in
//     der Datenbank (-> 409), nicht diese Logik.
//   * Der Link haengt an EINEM Projekt. Ohne Projekt keine Buchung — Adresse
//     und Kontakt kommen aus HERO, der Kunde waehlt nur die Zeit.
//   * HERO-Fehler brechen eine Buchung NICHT ab. Der Termin steht dann bei uns
//     und die interne Mail sagt, dass HERO fehlt.
//
// verify_jwt=false: eigenes Modell, Zugriff via service_role.
//
// Aktionen:
//   GET  ?action=context&project=<uuid>
//   GET  ?action=availability&project=<uuid>&from=&to=[&street=&zip=&city=]
//   POST { action:'create', project, slot:{startsAt,endsAt}, staffId,
//          contact:{name,email,phone}, addressOverride?, hinweis? }
//   POST { action:'cancel', cancelToken }
//   POST { action:'staff-action', staffToken, mode:'cancel'|'reschedule' }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DateTime } from "luxon";
import { computeSlots } from "../_shared/booking/engine.ts";
import { buildComputeInput, ruleSetConfigFromRow } from "../_shared/booking/inputs.ts";
import { createTravelProvider, type TravelCache } from "../_shared/booking/travel.ts";
import {
  formatAddress, geocode, heroCreateAppointment, heroDeleteAppointment,
  loadHeroContext, type GeocodeCache, type HeroAddress,
} from "../_shared/booking/hero.ts";
import type { Geo } from "../_shared/booking/types.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TZ = "Europe/Berlin";
const RULE_SET_KEY = "aufmass_vor_ort";
const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type DB = ReturnType<typeof sb>;

// ── Einstellungen ───────────────────────────────────────────────────────────

interface Settings {
  travelMode: "heuristic" | "routing";
  avgKmh: number;
  detour: number;
  overhead: number;
  maxTravelMin: number;
  holidayState: string;
  heroWrite: boolean;
  heroRead: boolean;
  heroCategoryId: number | null;
  heroApiKey: string | null;
  reminderHours: number;
}

async function loadSettings(db: DB): Promise<Settings> {
  const { data } = await db.from("app_config").select("key, value").in("key", [
    "booking_travel_mode", "booking_travel_avg_kmh", "booking_travel_detour",
    "booking_travel_overhead", "booking_travel_max_min", "booking_holiday_state",
    "booking_hero_write", "booking_hero_read", "booking_hero_category_id",
    "booking_reminder_hours", "hero_api_key", "hero_enabled",
  ]);
  const m = new Map((data ?? []).map((r: any) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = parseFloat(String(m.get(k) ?? "").replace(",", "."));
    return Number.isFinite(v) ? v : d;
  };
  const heroOn = m.get("hero_enabled") === "true";
  const cat = parseInt(String(m.get("booking_hero_category_id") ?? ""), 10);
  return {
    travelMode: m.get("booking_travel_mode") === "routing" ? "routing" : "heuristic",
    avgKmh: num("booking_travel_avg_kmh", 50),
    detour: num("booking_travel_detour", 1.4),
    overhead: num("booking_travel_overhead", 5),
    maxTravelMin: num("booking_travel_max_min", 45),
    holidayState: String(m.get("booking_holiday_state") ?? "BW"),
    heroWrite: heroOn && m.get("booking_hero_write") !== "false",
    heroRead: heroOn && m.get("booking_hero_read") !== "false",
    heroCategoryId: Number.isFinite(cat) && cat > 0 ? cat : null,
    heroApiKey: heroOn ? (m.get("hero_api_key") as string) || null : null,
    reminderHours: num("booking_reminder_hours", 24),
  };
}

// Der Routing-Schluessel steht in den Secrets, nicht in app_config: app_config
// ist fuer Admins lesbar.
const routingKey = () => Deno.env.get("ORS_API_KEY") || null;

function travelCache(db: DB): TravelCache {
  return {
    async get(key) {
      const { data } = await db.from("travel_time_cache")
        .select("minutes, created_at").eq("cache_key", key).maybeSingle();
      if (!data) return null;
      // Fahrzeiten veralten (Baustellen, neue Umgehung) — nach 90 Tagen neu holen.
      const age = Date.now() - new Date(data.created_at).getTime();
      if (age > 90 * 24 * 3600 * 1000) return null;
      return data.minutes as number;
    },
    async set(key, minutes) {
      await db.from("travel_time_cache")
        .upsert({ cache_key: key, minutes, created_at: new Date().toISOString() }, { onConflict: "cache_key" });
    },
  };
}

function geoCache(db: DB): GeocodeCache {
  return {
    async get(q) {
      const { data } = await db.from("geocode_cache").select("lat, lng").eq("query", q).maybeSingle();
      return data ? { lat: data.lat, lng: data.lng } : null;
    },
    async set(q, geo) {
      await db.from("geocode_cache").upsert({ query: q, lat: geo.lat, lng: geo.lng }, { onConflict: "query" });
    },
  };
}

// ── Projekt -> HERO ─────────────────────────────────────────────────────────

async function resolveProject(db: DB, projectId: string) {
  const { data } = await db.from("projects")
    .select("id, project_number, customer_name, custom_fields").eq("id", projectId).maybeSingle();
  if (!data) return null;
  const raw = (data.custom_fields as any)?.__hero_project_id;
  const heroId = Number(raw);
  return {
    id: data.id,
    projectNumber: data.project_number as string,
    customerName: (data.custom_fields as any)?.__customer_name || data.customer_name || "",
    heroProjectId: Number.isFinite(heroId) && heroId > 0 ? heroId : null,
  };
}

/** Adresse + Kontakt: HERO wenn verknuepft, sonst das lokale Projekt. */
async function buildContext(db: DB, s: Settings, projectId: string) {
  const proj = await resolveProject(db, projectId);
  if (!proj) return { error: "Projekt nicht gefunden" as const };

  let address: HeroAddress | null = null;
  let addressSource: "project" | "customer" | null = null;
  let contact = { name: proj.customerName, email: null as string | null, phone: null as string | null };
  let customerName = proj.customerName;

  if (proj.heroProjectId && s.heroApiKey) {
    try {
      const ctx = await loadHeroContext(s.heroApiKey, proj.heroProjectId);
      if (ctx) {
        address = ctx.address;
        addressSource = ctx.addressSource;
        contact = ctx.contact;
        customerName = ctx.customerName || customerName;
      }
    } catch (e) {
      console.warn("[booking] HERO-Kontext nicht ladbar:", (e as Error)?.message);
    }
  }
  return { proj, address, addressSource, contact, customerName };
}

// ── Verfuegbarkeit ──────────────────────────────────────────────────────────

async function availabilityFor(
  db: DB, s: Settings, from: string, to: string, address: Geo | null,
) {
  const { data: rs } = await db.from("rule_set").select("*")
    .eq("key", RULE_SET_KEY).eq("active", true).maybeSingle();
  if (!rs) return { error: "Terminart nicht eingerichtet" as const };

  const { data: rss } = await db.from("rule_set_staff").select("staff_id").eq("rule_set_id", rs.id);
  let staffIds = (rss ?? []).map((r: any) => r.staff_id);
  if (staffIds.length === 0) {
    const { data: all } = await db.from("staff").select("id").eq("active", true);
    staffIds = (all ?? []).map((s2: any) => s2.id);
  }
  if (staffIds.length === 0) return { rs, slots: [] as any[] };

  const [{ data: staff }, { data: wh }, { data: exc }, { data: busy }, { data: bookings }, { data: cats }, { data: hol }] =
    await Promise.all([
      db.from("staff").select("id, skills, home_base_lat, home_base_lng").in("id", staffIds).eq("active", true),
      db.from("working_hours").select("staff_id, weekday, start_time, end_time").in("staff_id", staffIds),
      db.from("working_hours_exception").select("staff_id, date, is_available, start_time, end_time")
        .in("staff_id", staffIds).gte("date", from.slice(0, 10)).lte("date", to.slice(0, 10)),
      db.from("busy_block").select("staff_id, starts_at, ends_at, category_key, geo_lat, geo_lng")
        .in("staff_id", staffIds).gt("ends_at", from).lt("starts_at", to),
      db.from("booking").select("staff_id, starts_at, status").in("staff_id", staffIds)
        .in("status", ["pending", "confirmed"]).gte("starts_at", from).lt("starts_at", to),
      db.from("appointment_category").select("key, blocks_availability"),
      db.from("public_holiday").select("date")
        .eq("state_code", s.holidayState).eq("active", true)
        .gte("date", from.slice(0, 10)).lte("date", to.slice(0, 10)),
    ]);

  const categoryBlocks: Record<string, boolean> = {};
  for (const c of cats ?? []) categoryBlocks[(c as any).key] = (c as any).blocks_availability;

  const travelProvider = createTravelProvider(
    { mode: s.travelMode, avgKmh: s.avgKmh, detourFactor: s.detour, overheadMin: s.overhead, apiKey: routingKey() },
    travelCache(db),
  );

  const input = buildComputeInput({
    ruleSet: rs as any, staff: staff ?? [], workingHours: wh ?? [], exceptions: exc ?? [],
    busy: busy ?? [], bookingCounts: bookings ?? [], categoryBlocks,
    holidays: (hol ?? []).map((h: any) => String(h.date)),
    now: new Date().toISOString(), from, to, address, timezone: TZ,
    travelProvider,
  });
  return { rs, slots: await computeSlots(input) };
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const db = sb();
  try {
    const url = new URL(req.url);
    const s = await loadSettings(db);

    if (req.method === "GET") {
      const action = url.searchParams.get("action");

      // Alles, was die Buchungsseite zum Start braucht.
      if (action === "context") {
        const projectId = url.searchParams.get("project") || "";
        if (!projectId) return json({ error: "project erforderlich" }, 400);
        const ctx = await buildContext(db, s, projectId);
        if ("error" in ctx) return json(ctx, 404);

        const { data: rs } = await db.from("rule_set")
          .select("label, duration_minutes, form_fields, booking_window_days")
          .eq("key", RULE_SET_KEY).eq("active", true).maybeSingle();
        if (!rs) return json({ error: "Terminart nicht eingerichtet" }, 503);

        const addressText = formatAddress(ctx.address);
        const geo = addressText ? await geocode(addressText, routingKey(), geoCache(db)) : null;

        return json({
          project: {
            id: ctx.proj.id,
            number: ctx.proj.projectNumber,
            customerName: ctx.customerName,
            heroLinked: !!ctx.proj.heroProjectId,
          },
          appointment: {
            label: rs.label,
            durationMinutes: rs.duration_minutes,
            formFields: rs.form_fields ?? [],
            bookingWindowDays: rs.booking_window_days,
          },
          address: ctx.address ? { ...ctx.address, text: addressText, source: ctx.addressSource, located: !!geo } : null,
          contact: ctx.contact,
        });
      }

      if (action === "availability") {
        const projectId = url.searchParams.get("project") || "";
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        if (!projectId || !from || !to) return json({ error: "project, from, to erforderlich" }, 400);

        // Hat der Kunde die Adresse geaendert, zaehlt seine Eingabe.
        const street = url.searchParams.get("street");
        const zip = url.searchParams.get("zip");
        const city = url.searchParams.get("city");
        let addressText: string;
        if (zip || street || city) {
          addressText = formatAddress({ street, zipcode: zip, city });
        } else {
          const ctx = await buildContext(db, s, projectId);
          if ("error" in ctx) return json(ctx, 404);
          addressText = formatAddress(ctx.address);
        }
        const geo = addressText ? await geocode(addressText, routingKey(), geoCache(db)) : null;

        const res = await availabilityFor(db, s, from, to, geo);
        if ("error" in res) return json(res, 503);
        return json({ slots: res.slots, addressLocated: !!geo });
      }

      return json({ error: "Unbekannte Aktion" }, 400);
    }

    if (req.method === "POST") {
      const body = await req.json();

      // ── Kunde storniert ──────────────────────────────────────────────────
      if (body.action === "cancel") {
        const token = String(body.cancelToken || "");
        if (!token) return json({ error: "cancelToken erforderlich" }, 400);
        const { data: bk } = await db.from("booking")
          .select("id, status, hero_event_ref").eq("cancel_token", token).maybeSingle();
        if (!bk) return json({ error: "Buchung nicht gefunden" }, 404);
        if (bk.status === "cancelled") return json({ ok: true, status: "cancelled" });

        await db.from("booking").update({ status: "cancelled", cancel_reason: "customer" }).eq("id", bk.id);
        await db.from("busy_block").delete().eq("source", "booking").eq("source_ref", bk.id);
        if (bk.hero_event_ref && s.heroApiKey) {
          await heroDeleteAppointment(s.heroApiKey, Number(bk.hero_event_ref));
        }
        await db.from("notification").insert({ booking_id: bk.id, kind: "cancellation" });
        return json({ ok: true, status: "cancelled" });
      }

      // ── Wir sagen ab oder bitten um Umbuchung (aus der internen Mail) ─────
      if (body.action === "staff-action") {
        const token = String(body.staffToken || "");
        const mode = body.mode === "reschedule" ? "reschedule" : "cancel";
        if (!token) return json({ error: "staffToken erforderlich" }, 400);
        const { data: bk } = await db.from("booking")
          .select("id, status, hero_event_ref, project_id").eq("staff_token", token).maybeSingle();
        if (!bk) return json({ error: "Buchung nicht gefunden" }, 404);
        if (bk.status === "cancelled") return json({ ok: true, status: "cancelled", already: true });

        // Entschieden: der Slot wird SOFORT wieder freigegeben — auch beim
        // Umbuchen. Andere Kunden sollen ihn sehen, statt auf jemanden zu
        // warten, der sich vielleicht nie wieder meldet.
        await db.from("booking").update({
          status: "cancelled",
          cancel_reason: mode === "reschedule" ? "staff_reschedule" : "staff_cancel",
        }).eq("id", bk.id);
        await db.from("busy_block").delete().eq("source", "booking").eq("source_ref", bk.id);
        if (bk.hero_event_ref && s.heroApiKey) {
          await heroDeleteAppointment(s.heroApiKey, Number(bk.hero_event_ref));
        }
        await db.from("notification").insert({
          booking_id: bk.id,
          kind: mode === "reschedule" ? "reschedule" : "cancellation",
        });
        return json({ ok: true, status: "cancelled", mode, projectId: bk.project_id });
      }

      // ── Buchen ───────────────────────────────────────────────────────────
      if (body.action === "create") {
        const projectId = String(body.project || "");
        const slot = body.slot || {};
        const staffId = String(body.staffId || "");
        const contact = body.contact || {};
        if (!projectId || !slot.startsAt || !slot.endsAt || !staffId || !contact.name || !contact.email) {
          return json({ error: "Pflichtfelder fehlen" }, 400);
        }

        const ctx = await buildContext(db, s, projectId);
        if ("error" in ctx) return json(ctx, 404);

        // Adresse: Eingabe des Kunden schlaegt HERO.
        const ov = body.addressOverride || null;
        const address: HeroAddress | null = ov
          ? { street: ov.street ?? null, zipcode: ov.zip ?? null, city: ov.city ?? null }
          : ctx.address;
        const addressSource = ov ? "manual" : ctx.addressSource;
        const addressText = formatAddress(address);
        const geo = addressText ? await geocode(addressText, routingKey(), geoCache(db)) : null;

        // Tag NEU rechnen — dem Frontend wird nicht geglaubt.
        const dayStart = DateTime.fromISO(slot.startsAt, { zone: "utc" }).setZone(TZ).startOf("day");
        const res = await availabilityFor(
          db, s, dayStart.toUTC().toISO()!, dayStart.plus({ days: 1 }).toUTC().toISO()!, geo,
        );
        if ("error" in res) return json(res, 503);
        const wanted = DateTime.fromISO(slot.startsAt, { zone: "utc" }).toISO();
        const stillFree = res.slots.some((x: any) =>
          DateTime.fromISO(x.startsAt, { zone: "utc" }).toISO() === wanted &&
          (x.assignedStaffId === staffId || (x.staffIds ?? []).includes(staffId)));
        if (!stillFree) return json({ error: "Dieser Termin ist nicht mehr verfügbar." }, 409);

        const rs: any = res.rs;
        const { data: cat } = await db.from("appointment_category")
          .select("key").eq("id", rs.category_id).maybeSingle();
        const status = rs.requires_approval ? "pending" : "confirmed";
        const cancelToken = crypto.randomUUID();
        const rescheduleToken = crypto.randomUUID();
        const staffToken = crypto.randomUUID();

        // Korrekturen des Kunden getrennt festhalten — bewusst NICHT nach HERO
        // zurueckschreiben, damit eine Buchung keine Stammdaten ueberschreibt.
        const overrides: Record<string, string> = {};
        for (const f of ["name", "email", "phone"] as const) {
          const was = (ctx.contact as any)[f];
          if (contact[f] && was && String(contact[f]).trim() !== String(was).trim()) {
            overrides[f] = String(contact[f]).trim();
          }
        }

        const { data: created, error: insErr } = await db.from("booking").insert({
          rule_set_id: rs.id, staff_id: staffId,
          starts_at: slot.startsAt, ends_at: slot.endsAt, status,
          customer_name: contact.name, customer_email: contact.email, customer_phone: contact.phone ?? null,
          address: addressText || null, address_lat: geo?.lat ?? null, address_lng: geo?.lng ?? null,
          address_source: addressSource, contact_overrides: overrides,
          project_id: ctx.proj.id, hero_project_id: ctx.proj.heroProjectId,
          answers: body.hinweis ? { hinweis: String(body.hinweis) } : {},
          cancel_token: cancelToken, reschedule_token: rescheduleToken, staff_token: staffToken,
        }).select("id, status, starts_at, ends_at").single();

        if (insErr) {
          // 23P01 = Exclusion-Constraint, 23505 = Unique. Beides: inzwischen vergeben.
          if (insErr.code === "23P01" || insErr.code === "23505") {
            return json({ error: "Dieser Termin wurde gerade vergeben." }, 409);
          }
          return json({ error: insErr.message }, 500);
        }

        await db.from("busy_block").insert({
          staff_id: staffId, starts_at: slot.startsAt, ends_at: slot.endsAt,
          source: "booking", source_ref: created!.id, category_key: cat?.key ?? null,
          geo_lat: geo?.lat ?? null, geo_lng: geo?.lng ?? null,
        });

        // HERO: am Projekt, nicht lose im Kalender. Fehler sind nicht fatal.
        let heroError: string | null = null;
        if (s.heroWrite && s.heroApiKey && ctx.proj.heroProjectId) {
          const { data: st } = await db.from("staff")
            .select("display_name, employee_id").eq("id", staffId).maybeSingle();
          let partnerId: number | null = null;
          if (st?.employee_id) {
            const { data: emp } = await db.from("employees")
              .select("hero_partner_id").eq("id", st.employee_id).maybeSingle();
            const p = Number((emp as any)?.hero_partner_id);
            if (Number.isFinite(p) && p > 0) partnerId = p;
          }
          const start = DateTime.fromISO(slot.startsAt, { zone: "utc" }).setZone(TZ);
          const end = DateTime.fromISO(slot.endsAt, { zone: "utc" }).setZone(TZ);
          const r = await heroCreateAppointment(s.heroApiKey, {
            heroProjectId: ctx.proj.heroProjectId,
            title: `${rs.label} – ${ctx.customerName}`.trim(),
            startIso: start.toISO()!, endIso: end.toISO()!,
            description: [addressText, body.hinweis ? `Hinweis: ${body.hinweis}` : ""].filter(Boolean).join("\n"),
            categoryId: s.heroCategoryId, partnerId,
          });
          if (r.id) await db.from("booking").update({ hero_event_ref: String(r.id) }).eq("id", created!.id);
          else heroError = r.error ?? "unbekannt";
        }

        const notes: any[] = [
          { booking_id: created!.id, kind: "confirmation" },
          { booking_id: created!.id, kind: "internal_new" },
        ];
        if (status === "confirmed" && s.reminderHours > 0) {
          const sendAfter = DateTime.fromISO(slot.startsAt, { zone: "utc" }).minus({ hours: s.reminderHours });
          if (sendAfter.toMillis() > Date.now()) {
            notes.push({ booking_id: created!.id, kind: "reminder", send_after: sendAfter.toUTC().toISO() });
          }
        }
        await db.from("notification").insert(notes);

        return json({
          ok: true,
          booking: {
            id: created!.id, status: created!.status,
            startsAt: created!.starts_at, endsAt: created!.ends_at,
          },
          cancelToken,
          heroError,
        });
      }

      return json({ error: "Unbekannte Aktion" }, 400);
    }

    return json({ error: "Methode nicht erlaubt" }, 405);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
