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
import { geocode } from "../_shared/booking/hero.ts";

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
  "required_skills",
]);

// Es gibt MEHRERE Terminarten (M1 hat drei angelegt). Frueher stand hier eine
// feste Kennung — damit waren zwei davon unsichtbar und unbuchbar. Die Kennung
// bleibt nur als Vorgabe, wenn der Aufrufer keine nennt.
const RULE_SET_DEFAULT = "aufmass_vor_ort";

/** Koordinaten aus der Adresse holen, wenn ein Routing-Schluessel hinterlegt ist. */
async function koordinaten(db: any, adresse: string | null): Promise<{ lat: number | null; lng: number | null }> {
  const text = String(adresse ?? "").trim();
  if (!text) return { lat: null, lng: null };
  const key = Deno.env.get("ORS_API_KEY") || null;
  const cache = {
    async get(q: string) {
      const { data } = await db.from("geocode_cache").select("lat, lng").eq("query", q).maybeSingle();
      return data ? { lat: data.lat, lng: data.lng } : null;
    },
    async set(q: string, geo: { lat: number | null; lng: number | null }) {
      await db.from("geocode_cache").upsert({ query: q, lat: geo.lat, lng: geo.lng }, { onConflict: "query" });
    },
  };
  const geo = await geocode(text, key, cache);
  return { lat: geo?.lat ?? null, lng: geo?.lng ?? null };
}

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
      const [cfg, rs, staff, hours, cats, rss, heroCfg] = await Promise.all([
        db.from("app_config").select("key, value").like("key", "booking_%"),
        // ALLE Terminarten, nicht nur eine.
        db.from("rule_set").select("*").order("label"),
        db.from("staff")
          .select("id, employee_id, display_name, active, skills, home_base_address, home_base_lat, home_base_lng")
          .order("display_name"),
        db.from("working_hours").select("id, staff_id, weekday, start_time, end_time").order("weekday"),
        db.from("appointment_category").select("id, key, label, source, blocks_availability, is_bookable").order("label"),
        db.from("rule_set_staff").select("rule_set_id, staff_id"),
        db.from("app_config").select("value").eq("key", "hero_enabled").maybeSingle(),
      ]);
      const settings: Record<string, string> = {};
      for (const r of cfg.data ?? []) settings[(r as any).key] = (r as any).value ?? "";

      // Mitarbeiter mitsamt HERO-Zuordnung: ohne sie blockieren HERO-Termine
      // nicht, und unsere Termine landen in HERO ohne Zustaendigen. Der Reiter
      // zeigt das deshalb an der Stelle, wo es auffaellt.
      const { data: emps } = await db.from("employees").select("id, name, hero_partner_id").order("name");
      const belegt = new Set((staff.data ?? []).map((s: any) => s.employee_id).filter(Boolean));
      const heroPartnerOf = new Map((emps ?? []).map((e: any) => [e.id, e.hero_partner_id]));

      const katById = new Map((cats.data ?? []).map((c: any) => [c.id, c]));

      return json({
        settings,
        ruleSets: (rs.data ?? []).map((r: any) => ({
          ...r,
          categoryKey: katById.get(r.category_id)?.key ?? null,
          categoryLabel: katById.get(r.category_id)?.label ?? null,
          isBookable: katById.get(r.category_id)?.is_bookable ?? false,
          // Leere Liste heisst: jeder mit passender Qualifikation.
          staffIds: (rss.data ?? []).filter((x: any) => x.rule_set_id === r.id).map((x: any) => x.staff_id),
          heroCategoryId: (r.config ?? {}).hero_category_id ?? null,
        })),
        staff: (staff.data ?? []).map((s: any) => ({
          ...s,
          heroPartnerId: s.employee_id ? heroPartnerOf.get(s.employee_id) ?? null : null,
          workingHours: (hours.data ?? []).filter((h: any) => h.staff_id === s.id),
        })),
        categories: cats.data ?? [],
        employees: (emps ?? []).map((e: any) => ({ ...e, uebernommen: belegt.has(e.id) })),
        // Ob Routing/Geocoding ueberhaupt moeglich ist, weiss nur der Server:
        // der Schluessel liegt in den Secrets, nicht in app_config.
        routingKeyVorhanden: !!Deno.env.get("ORS_API_KEY"),
        heroAktiv: (heroCfg.data as any)?.value === "true",
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

    // ── Terminart speichern ──
    // `key` sagt, WELCHE Terminart gemeint ist. Ohne Angabe die Vorgabe, damit
    // aeltere Aufrufe weiter funktionieren.
    if (body.action === "set_rule_set") {
      const key = String(body.key || RULE_SET_DEFAULT);
      const patch = (body.patch ?? {}) as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!ERLAUBTE_RULESET_SPALTEN.has(k)) continue;
        if (k === "label") update[k] = String(v ?? "").trim() || key;
        else if (k === "travel_buffer" || k === "active" || k === "requires_approval") update[k] = v === true || v === "true";
        else if (k === "max_per_day_global" || k === "max_per_day_per_staff") update[k] = zahl(v);
        else if (k === "required_skills") {
          update[k] = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
        } else {
          const n = zahl(v);
          if (n != null && n >= 0) update[k] = n;
        }
      }

      // HERO-Kategorie gehoert an die Terminart, nicht in eine globale
      // Einstellung: eine Montage soll in HERO nicht unter "Aufmass" landen.
      if (Object.prototype.hasOwnProperty.call(body, "heroCategoryId")) {
        const { data: vorhanden } = await db.from("rule_set").select("config").eq("key", key).maybeSingle();
        const cfg = { ...((vorhanden as any)?.config ?? {}) };
        const id = zahl(body.heroCategoryId);
        if (id && id > 0) cfg.hero_category_id = id; else delete cfg.hero_category_id;
        update.config = cfg;
      }

      if (Object.keys(update).length === 0) return json({ error: "Nichts zu speichern" }, 400);
      update.updated_at = new Date().toISOString();
      const { error } = await db.from("rule_set").update(update).eq("key", key);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, key, felder: Object.keys(update) });
    }

    // ── Wer macht diese Terminart? ──
    // Leere Liste = jeder mit passender Qualifikation (so rechnet die Engine).
    // Eine ausdrueckliche Auswahl schlaegt das.
    if (body.action === "set_rule_set_staff") {
      const key = String(body.key || "");
      if (!key) return json({ error: "key erforderlich" }, 400);
      const { data: rs } = await db.from("rule_set").select("id").eq("key", key).maybeSingle();
      if (!rs) return json({ error: "Terminart nicht gefunden" }, 404);
      const ids = Array.isArray(body.staffIds) ? body.staffIds.map((x: unknown) => String(x)) : [];
      const { error: delErr } = await db.from("rule_set_staff").delete().eq("rule_set_id", (rs as any).id);
      if (delErr) return json({ error: delErr.message }, 500);
      if (ids.length > 0) {
        const { error } = await db.from("rule_set_staff")
          .insert(ids.map((staff_id: string) => ({ rule_set_id: (rs as any).id, staff_id })));
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true, zugeordnet: ids.length });
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
      // Standort kommt als ADRESSE. Die Koordinaten rechnet der Server daraus,
      // damit im Adminmenue niemand Breite und Laenge tippen muss.
      const adresse = body.homeBaseAddress == null ? null : String(body.homeBaseAddress).trim() || null;
      const row: Record<string, unknown> = {
        display_name: String(body.displayName || "").trim(),
        active: body.active !== false,
        employee_id: body.employeeId || null,
        home_base_address: adresse,
        skills: Array.isArray(body.skills) ? body.skills.map((x: unknown) => String(x)) : [],
        updated_at: new Date().toISOString(),
      };
      if (!row.display_name) return json({ error: "Name erforderlich" }, 400);

      // Nur neu geocodieren, wenn die Adresse sich geaendert hat — sonst bei
      // jedem Speichern ein Aufruf beim Anbieter.
      let alteAdresse: string | null = null;
      if (body.id) {
        const { data: vorher } = await db.from("staff")
          .select("home_base_address").eq("id", String(body.id)).maybeSingle();
        alteAdresse = (vorher as any)?.home_base_address ?? null;
      }
      if (adresse !== alteAdresse) {
        const geo = await koordinaten(db, adresse);
        row.home_base_lat = geo.lat;
        row.home_base_lng = geo.lng;
      }

      if (body.id) {
        const { error } = await db.from("staff").update(row).eq("id", String(body.id));
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, id: body.id, standortErkannt: row.home_base_lat != null });
      }
      const { data, error } = await db.from("staff").insert(row).select("id, home_base_lat").single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, id: data?.id, standortErkannt: (data as any)?.home_base_lat != null });
    }

    // ── Standorte nachtraeglich ermitteln ──
    // Sinnvoll, sobald der Routing-Schluessel hinterlegt wurde: vorher konnte
    // aus den Adressen nichts werden.
    if (body.action === "geocode_staff") {
      if (!Deno.env.get("ORS_API_KEY")) {
        return json({ error: "Kein Routing-Schluessel hinterlegt (Supabase-Secret ORS_API_KEY)" }, 400);
      }
      const { data: liste } = await db.from("staff")
        .select("id, display_name, home_base_address").not("home_base_address", "is", null);
      const bericht: Record<string, unknown>[] = [];
      for (const st of liste ?? []) {
        const geo = await koordinaten(db, (st as any).home_base_address);
        await db.from("staff")
          .update({ home_base_lat: geo.lat, home_base_lng: geo.lng, updated_at: new Date().toISOString() })
          .eq("id", (st as any).id);
        bericht.push({ name: (st as any).display_name, erkannt: geo.lat != null });
      }
      return json({ ok: true, bericht });
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
      // Ohne Auswahl: alle mit HERO-Zuordnung — nur fuer die kann der Abgleich
      // spaeter Termine zuordnen. Mit Auswahl: genau diese.
      const gewuenscht = Array.isArray(body.employeeIds)
        ? body.employeeIds.map((x: unknown) => String(x))
        : null;

      let frage = db.from("employees").select("id, name, hero_partner_id");
      if (gewuenscht) frage = frage.in("id", gewuenscht);
      else frage = frage.not("hero_partner_id", "is", null);
      const { data: emps } = await frage;

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
