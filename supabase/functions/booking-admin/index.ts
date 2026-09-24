// Admin-Aktionen fuer die Terminbuchung. Verlangt einen echten Admin-Token.
//
// Hier laeuft alles, was der Reiter "Termine" im Adminmenue schreibt — direkte
// Supabase-Writes aus dem Adminbereich gibt es in diesem Projekt nicht.
// Geschrieben wird nur, was ausdruecklich erlaubt ist: die Einstellungen sind
// auf eine Liste von Schluesseln begrenzt, das Regelset auf bekannte Spalten.
// Sonst waere der Admin-Token ein Generalschluessel fuer app_config.
//
// Schwerpunkt: Feiertage. Sie kommen aus einer oeffentlichen Quelle pro
// Bundesland und Jahr — statt sie fest einzuprogrammieren, wo sie jedes Jahr
// veralten. Importierte Eintraege bleiben danach ganz normal bearbeitbar:
//   * origin='imported' vs. 'manual' — ein erneuter Import laesst eigene
//     Eintraege in Ruhe.
//   * active=false statt loeschen — sonst legt der naechste Import den
//     abgeschalteten Tag wieder an.
//
// Zwei Quellen, weil eine kostenlose API auch mal weg ist:
//   1. feiertage-api.de — deutsche Feiertage nach Bundesland, ohne Schluessel
//   2. date.nager.at — weltweit, ohne Schluessel, mit Bundesland-Kennung
// Das Lesen beider Antwortformen liegt in _shared/booking/holidays.ts, damit es
// unit-getestet ist — dort sitzen die Fehler, wenn eine Quelle ihr Format dreht.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";
import { fetchHolidays, isGermanState, isIsoDate } from "../_shared/booking/holidays.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/**
 * Einstellungen, die dieser Reiter setzen darf. Alles andere in app_config
 * bleibt tabu — dort liegen auch Schluessel wie hero_api_key.
 */
const ERLAUBTE_KEYS = new Set([
  "booking_travel_mode", "booking_travel_avg_kmh", "booking_travel_detour",
  "booking_travel_overhead", "booking_travel_max_min", "booking_holiday_state",
  "booking_hero_write", "booking_hero_read", "booking_hero_category_id",
  "booking_reminder_hours", "booking_notify_internal", "booking_hero_sync_days",
]);

/** Spalten des Regelsets, die aus dem Adminmenue kommen duerfen. */
const ERLAUBTE_RULESET_SPALTEN = new Set([
  "label", "active", "duration_minutes", "buffer_before_min", "buffer_after_min",
  "travel_buffer", "min_notice_min", "booking_window_days", "slot_granularity_min",
  "max_per_day_global", "max_per_day_per_staff", "requires_approval",
]);

const RULE_SET_KEY = "aufmass_vor_ort";

const zahl = (v: unknown): number | null => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : null;
};
const zeit = (v: unknown): string | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}:00`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);

  try {
    const body = await req.json();
    const payload = body.adminToken
      ? await verifySessionToken(String(body.adminToken), getSessionSecret())
      : null;
    if (!payload || payload.role !== "admin") return json({ error: "Unauthorized" }, 401);

    const db = sb();

    // ── Feiertage importieren ──
    if (body.action === "import_holidays") {
      const state = String(body.state || "BW").toUpperCase();
      if (!isGermanState(state)) return json({ error: `Unbekanntes Bundesland: ${state}` }, 400);

      const thisYear = new Date().getFullYear();
      const years: number[] = Array.isArray(body.years) && body.years.length
        ? body.years.map((y: unknown) => parseInt(String(y), 10)).filter((y: number) => y >= 2020 && y <= 2100)
        : [thisYear, thisYear + 1];
      if (years.length === 0) return json({ error: "Keine gueltigen Jahre" }, 400);

      const report: Record<string, unknown>[] = [];
      for (const year of years) {
        try {
          const { list, source } = await fetchHolidays(state, year);
          // Nur importierte Zeilen anfassen. Ein 'manual'-Eintrag am selben
          // Datum bleibt unberuehrt — deshalb kein blindes upsert.
          const { data: existing } = await db.from("public_holiday")
            .select("date, origin").eq("state_code", state)
            .gte("date", `${year}-01-01`).lte("date", `${year}-12-31`);
          const manual = new Set((existing ?? [])
            .filter((r: any) => r.origin === "manual").map((r: any) => r.date));

          const rows = list
            .filter((h) => !manual.has(h.date))
            .map((h) => ({ date: h.date, name: h.name, state_code: state, origin: "imported" }));

          // onConflict (date,state_code): ein erneuter Import aktualisiert nur
          // den Namen und laesst active in Ruhe.
          const { error } = await db.from("public_holiday")
            .upsert(rows, { onConflict: "date,state_code", ignoreDuplicates: false });
          if (error) throw new Error(error.message);

          report.push({ year, imported: rows.length, skippedManual: manual.size, source });
        } catch (e) {
          report.push({ year, error: (e as Error)?.message || String(e) });
        }
      }
      const ok = report.some((r) => typeof r.imported === "number");
      return json({ ok, state, report }, ok ? 200 : 502);
    }

    // ── Auflisten ──
    if (body.action === "list_holidays") {
      const state = String(body.state || "BW").toUpperCase();
      const from = isIsoDate(body.from) ? body.from : `${new Date().getFullYear()}-01-01`;
      const to = isIsoDate(body.to) ? body.to : `${new Date().getFullYear() + 1}-12-31`;
      const { data, error } = await db.from("public_holiday")
        .select("id, date, name, origin, active")
        .eq("state_code", state).gte("date", from).lte("date", to).order("date");
      if (error) return json({ error: error.message }, 500);
      return json({ holidays: data ?? [] });
    }

    // ── Einzelnen Tag ein-/ausschalten ──
    if (body.action === "set_holiday_active") {
      const id = String(body.id || "");
      if (!id) return json({ error: "id erforderlich" }, 400);
      const { error } = await db.from("public_holiday")
        .update({ active: body.active !== false }).eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ── Eigenen Tag eintragen (Betriebsurlaub, Brueckentag) ──
    if (body.action === "add_holiday") {
      const state = String(body.state || "BW").toUpperCase();
      const date = body.date;
      const name = String(body.name || "").trim();
      if (!isIsoDate(date) || !name) return json({ error: "date (JJJJ-MM-TT) und name erforderlich" }, 400);
      const { error } = await db.from("public_holiday").upsert(
        { date, name, state_code: state, origin: "manual", active: true },
        { onConflict: "date,state_code" },
      );
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (body.action === "delete_holiday") {
      const id = String(body.id || "");
      if (!id) return json({ error: "id erforderlich" }, 400);
      const { error } = await db.from("public_holiday").delete().eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ── Alles laden, was der Reiter braucht ──
    if (body.action === "get_config") {
      const [cfg, rs, staff, hours, cats] = await Promise.all([
        db.from("app_config").select("key, value").like("key", "booking_%"),
        db.from("rule_set").select("*").eq("key", RULE_SET_KEY).maybeSingle(),
        db.from("staff").select("id, employee_id, display_name, active, skills, home_base_lat, home_base_lng")
          .order("display_name"),
        db.from("working_hours").select("id, staff_id, weekday, start_time, end_time").order("weekday"),
        db.from("appointment_category").select("key, label, source, blocks_availability, is_bookable").order("label"),
      ]);
      const settings: Record<string, string> = {};
      for (const r of cfg.data ?? []) settings[(r as any).key] = (r as any).value ?? "";

      // Mitarbeiter, die noch kein Personal-Profil haben — damit der Reiter
      // anbieten kann, sie zu uebernehmen.
      const { data: emps } = await db.from("employees").select("id, name, hero_partner_id").order("name");
      const belegt = new Set((staff.data ?? []).map((s: any) => s.employee_id).filter(Boolean));

      return json({
        settings,
        ruleSet: rs.data ?? null,
        staff: (staff.data ?? []).map((s: any) => ({
          ...s,
          workingHours: (hours.data ?? []).filter((h: any) => h.staff_id === s.id),
        })),
        categories: cats.data ?? [],
        employees: (emps ?? []).map((e: any) => ({ ...e, uebernommen: belegt.has(e.id) })),
      });
    }

    // ── Einstellungen schreiben ──
    if (body.action === "set_config") {
      const values = (body.values ?? {}) as Record<string, unknown>;
      const rows = Object.entries(values)
        .filter(([k]) => ERLAUBTE_KEYS.has(k))
        .map(([key, value]) => ({ key, value: value == null ? "" : String(value) }));
      const abgelehnt = Object.keys(values).filter((k) => !ERLAUBTE_KEYS.has(k));
      if (rows.length > 0) {
        const { error } = await db.from("app_config").upsert(rows, { onConflict: "key" });
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true, gespeichert: rows.length, abgelehnt });
    }

    // ── Terminart ──
    if (body.action === "set_rule_set") {
      const patch = (body.patch ?? {}) as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!ERLAUBTE_RULESET_SPALTEN.has(k)) continue;
        if (k === "label") update[k] = String(v ?? "").trim() || "Aufmass vor Ort";
        else if (k === "travel_buffer" || k === "active" || k === "requires_approval") update[k] = v === true || v === "true";
        else if (k === "max_per_day_global" || k === "max_per_day_per_staff") update[k] = zahl(v);
        else {
          const n = zahl(v);
          if (n != null && n >= 0) update[k] = n;
        }
      }
      if (Object.keys(update).length === 0) return json({ error: "Nichts zu speichern" }, 400);
      update.updated_at = new Date().toISOString();
      const { error } = await db.from("rule_set").update(update).eq("key", RULE_SET_KEY);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, felder: Object.keys(update) });
    }

    // ── Blockiert eine Kategorie die Zeit? ──
    if (body.action === "set_category_blocks") {
      const key = String(body.key || "");
      if (!key) return json({ error: "key erforderlich" }, 400);
      const { error } = await db.from("appointment_category")
        .update({ blocks_availability: body.blocks !== false }).eq("key", key);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ── Personal ──
    if (body.action === "staff_upsert") {
      const row: Record<string, unknown> = {
        display_name: String(body.displayName || "").trim(),
        active: body.active !== false,
        employee_id: body.employeeId || null,
        home_base_lat: body.homeBaseLat == null || body.homeBaseLat === "" ? null : Number(body.homeBaseLat),
        home_base_lng: body.homeBaseLng == null || body.homeBaseLng === "" ? null : Number(body.homeBaseLng),
        skills: Array.isArray(body.skills) ? body.skills.map((x: unknown) => String(x)) : [],
        updated_at: new Date().toISOString(),
      };
      if (!row.display_name) return json({ error: "Name erforderlich" }, 400);
      if (body.id) {
        const { error } = await db.from("staff").update(row).eq("id", String(body.id));
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, id: body.id });
      }
      const { data, error } = await db.from("staff").insert(row).select("id").single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, id: data?.id });
    }

    if (body.action === "staff_delete") {
      const id = String(body.id || "");
      if (!id) return json({ error: "id erforderlich" }, 400);
      // Buchungen haengen per Fremdschluessel daran. Deshalb lieber
      // abschalten als loeschen, wenn der Mitarbeiter schon Termine hatte.
      const { count } = await db.from("booking").select("id", { count: "exact", head: true }).eq("staff_id", id);
      if ((count ?? 0) > 0) {
        const { error } = await db.from("staff").update({ active: false }).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, deaktiviert: true, grund: "Es gibt Buchungen fuer diesen Mitarbeiter" });
      }
      const { error } = await db.from("staff").delete().eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, geloescht: true });
    }

    // ── Arbeitszeiten (ersetzen, nicht ergaenzen) ──
    if (body.action === "set_working_hours") {
      const staffId = String(body.staffId || "");
      if (!staffId) return json({ error: "staffId erforderlich" }, 400);
      const rows: Record<string, unknown>[] = [];
      for (const h of (Array.isArray(body.hours) ? body.hours : [])) {
        const wd = zahl((h as any).weekday);
        const start = zeit((h as any).start);
        const end = zeit((h as any).end);
        if (wd == null || wd < 0 || wd > 6 || !start || !end || end <= start) continue;
        rows.push({ staff_id: staffId, weekday: wd, start_time: start, end_time: end });
      }
      const { error: delErr } = await db.from("working_hours").delete().eq("staff_id", staffId);
      if (delErr) return json({ error: delErr.message }, 500);
      if (rows.length > 0) {
        const { error } = await db.from("working_hours").insert(rows);
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true, zeilen: rows.length });
    }

    // ── Mitarbeiter aus employees uebernehmen ──
    // Wer in HERO einen Partner-Datensatz hat, ist ohnehin der Kandidat: nur
    // dafuer kann der Abgleich spaeter Termine zuordnen.
    if (body.action === "sync_staff_from_employees") {
      const { data: emps } = await db.from("employees")
        .select("id, name, hero_partner_id").not("hero_partner_id", "is", null);
      const { data: vorhanden } = await db.from("staff").select("employee_id");
      const belegt = new Set((vorhanden ?? []).map((s: any) => s.employee_id).filter(Boolean));
      const neu = (emps ?? []).filter((e: any) => !belegt.has(e.id));
      if (neu.length === 0) return json({ ok: true, angelegt: 0 });

      const { data: created, error } = await db.from("staff")
        .insert(neu.map((e: any) => ({ employee_id: e.id, display_name: e.name, active: true, skills: [] })))
        .select("id");
      if (error) return json({ error: error.message }, 500);

      // Startwert Mo-Fr 08:00-17:00, damit ueberhaupt Slots entstehen.
      const hours = (created ?? []).flatMap((s: any) =>
        [1, 2, 3, 4, 5].map((wd) => ({ staff_id: s.id, weekday: wd, start_time: "08:00:00", end_time: "17:00:00" })));
      if (hours.length > 0) await db.from("working_hours").insert(hours);
      return json({ ok: true, angelegt: created?.length ?? 0 });
    }

    // ── Kommende Termine ──
    if (body.action === "list_bookings") {
      const from = isIsoDate(body.from) ? `${body.from}T00:00:00Z` : new Date().toISOString();
      const limit = Math.min(200, Math.max(1, zahl(body.limit) ?? 50));
      const { data, error } = await db.from("booking")
        .select(`id, status, starts_at, ends_at, customer_name, customer_email, customer_phone,
                 address, address_source, answers, cancel_reason, hero_event_ref, project_id,
                 staff:staff_id ( display_name ), rule_set:rule_set_id ( label )`)
        .gte("starts_at", from).order("starts_at").limit(limit);
      if (error) return json({ error: error.message }, 500);
      return json({ bookings: data ?? [] });
    }

    // ── Offene Mails, damit im Reiter sichtbar ist, was haengt ──
    if (body.action === "mail_queue") {
      const { data, error } = await db.from("notification")
        .select("id, kind, send_after, sent_at, attempts, last_error, booking_id")
        .is("sent_at", null).order("send_after").limit(50);
      if (error) return json({ error: error.message }, 500);
      return json({ queue: data ?? [] });
    }

    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
