// Live-Abgleich EINES Tages fuer EINEN Mitarbeiter, direkt vor dem Buchen.
//
// Warum: `booking-hero-sync` gleicht per pg_cron ab (HERO hat fuer uns keine
// Webhooks). Ein Termin, der gerade erst in der HERO-Plantafel angelegt oder
// verlaengert wurde, steht also bis zum naechsten Lauf noch nicht in
// `busy_block` — in diesem Fenster war eine Doppelbuchung moeglich.
//
// Vorgehen: die Termine und Abwesenheiten dieses Tages aus HERO holen und
// genauso in `busy_block` schreiben wie der Cron-Abgleich (gleiche
// source/source_ref, gleiche Zeitumrechnung). Danach rechnet der Aufrufer den
// Tag ganz normal neu — Fahrzeiten und Kategorie-Regeln bleiben also dieselben
// wie in der Terminsuche, statt hier eine zweite Pruef-Logik zu pflegen.
//
// Die Regeln (Zeitumrechnung, eigene Buchungen ausklammern, Abgleich statt nur
// ergaenzen) muessen zu booking-hero-sync passen. Wer dort etwas aendert,
// prueft es hier auch.
//
// Fehler sind NICHT fatal (Grundsatz der Buchungs-API): klappt HERO nicht,
// wird mit dem Stand des letzten Cron-Laufs gebucht.

import { DateTime } from "luxon";
import { heroWallClock, toHeroTime } from "./hero.ts";
import { ABSENCE_REF, ABSENCE_STATUSES, absenceSpan } from "./absence.ts";

const TZ = "Europe/Berlin";
const HERO_URL = "https://login.hero-software.de/api/external/v9/graphql";
/** Eine Buchung soll nicht ewig auf HERO warten. */
const TIMEOUT_MS = 6000;

// deno-lint-ignore no-explicit-any
type DB = any;

async function heroQuery(apiKey: string, query: string, variables: Record<string, unknown>, feld: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(HERO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HERO HTTP ${resp.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    // HERO liefert bei Teilfehlern data UND errors — beides pruefen.
    if (data.errors?.length && !data.data?.[feld]) {
      throw new Error(data.errors[0]?.message || "HERO GraphQL-Fehler");
    }
    return (data.data?.[feld] ?? []) as any[];
  } finally {
    clearTimeout(timer);
  }
}

export interface LiveRefreshResult {
  ok: boolean;
  /** Warum nichts passiert ist (kein HERO, keine Partner-ID …). */
  skipped?: string;
  error?: string;
  blocks?: number;
  removed?: number;
}

/**
 * HERO-Sperren eines Tages fuer einen Mitarbeiter frisch aus HERO holen.
 *
 * @param dayStartUtc Beginn des Tages (Berliner Mitternacht) als ISO-Zeitpunkt.
 */
export async function refreshHeroDay(
  db: DB, apiKey: string | null, staffId: string, dayStartUtc: string,
): Promise<LiveRefreshResult> {
  if (!apiKey) return { ok: true, skipped: "HERO nicht aktiv" };

  // Dieselben Schalter wie der Cron-Abgleich.
  const { data: cfg } = await db.from("app_config").select("value").eq("key", "booking_hero_read").maybeSingle();
  if (cfg?.value === "false") return { ok: true, skipped: "HERO-Lesen ist abgeschaltet" };

  // Mitarbeiter -> HERO-Partner. Ohne Zuordnung blockiert HERO bei ihm nichts.
  const { data: st } = await db.from("staff").select("employee_id").eq("id", staffId).maybeSingle();
  if (!st?.employee_id) return { ok: true, skipped: "Keine HERO-Zuordnung" };
  const { data: emp } = await db.from("employees").select("hero_partner_id").eq("id", st.employee_id).maybeSingle();
  const partnerId = Number(emp?.hero_partner_id);
  if (!Number.isFinite(partnerId) || partnerId <= 0) return { ok: true, skipped: "Keine HERO-Partner-ID" };

  const from = DateTime.fromISO(dayStartUtc, { zone: "utc" }).setZone(TZ).startOf("day");
  const to = from.plus({ days: 1 });

  try {
    // Termine und Abwesenheiten parallel — die Buchung wartet darauf.
    const [events, absRes] = await Promise.all([
      heroQuery(apiKey, `
        query Events($start: DateTime, $end: DateTime) {
          calendar_events(start: $start, end: $end) {
            id start end all_day deleted
            category { id }
            partners { id }
          }
        }`, { start: toHeroTime(from.toISO()!), end: toHeroTime(to.toISO()!) }, "calendar_events"),
      heroQuery(apiKey, `
        query Absences($start: Date, $end: Date, $statuses: [Employees_AbsenceStatusEnum]) {
          absences(start: $start, end: $end, show_all_partners: true, statuses: $statuses) {
            id partner_id start end
          }
        }`, {
          start: from.toFormat("yyyy-MM-dd"), end: from.toFormat("yyyy-MM-dd"), statuses: ABSENCE_STATUSES,
        }, "absences")
        // Abwesenheiten sind Zugabe: fallen sie aus, gilt der Termin-Abgleich trotzdem.
        .then((a) => ({ ok: true as const, list: a }))
        .catch((e) => ({ ok: false as const, list: [] as any[], error: (e as Error)?.message })),
    ]);

    // Eigene Buchungen stehen schon als source='booking' im Weg.
    const { data: ownRows } = await db.from("booking")
      .select("hero_event_ref").not("hero_event_ref", "is", null)
      .in("status", ["pending", "confirmed"]);
    const own = new Set((ownRows ?? []).map((r: any) => String(r.hero_event_ref)));

    const rows: Record<string, unknown>[] = [];
    const wanted = new Set<string>();
    for (const ev of events) {
      if (ev.deleted) continue;
      if (!(ev.partners ?? []).some((p: any) => Number(p?.id) === partnerId)) continue;
      const ref = String(ev.id);
      if (own.has(ref) || wanted.has(ref)) continue;

      const startDt = DateTime.fromISO(heroWallClock(ev.start), { zone: TZ });
      if (!startDt.isValid) continue;
      let endDt = ev.end ? DateTime.fromISO(heroWallClock(ev.end), { zone: TZ }) : startDt.endOf("day");
      if (!endDt.isValid || endDt <= startDt) {
        endDt = ev.all_day ? startDt.endOf("day") : startDt.plus({ hours: 1 });
      }
      wanted.add(ref);
      rows.push({
        staff_id: staffId,
        starts_at: startDt.toUTC().toISO(),
        ends_at: endDt.toUTC().toISO(),
        source: "hero",
        source_ref: ref,
        // Unbekannte Kategorie blockiert (Engine: nicht in der Liste => sperrt).
        // Angelegt wird sie beim naechsten Cron-Lauf.
        category_key: ev.category?.id ? `hero:${ev.category.id}` : null,
        geo_lat: null, geo_lng: null,
      });
    }

    for (const ab of absRes.list) {
      if (Number(ab.partner_id) !== partnerId) continue;
      const span = absenceSpan(ab.start, ab.end);
      if (!span) continue;
      const ref = `${ABSENCE_REF}${ab.id}`;
      if (wanted.has(ref)) continue;
      wanted.add(ref);
      rows.push({
        staff_id: staffId, starts_at: span.startsAt, ends_at: span.endsAt,
        source: "hero", source_ref: ref, category_key: null, geo_lat: null, geo_lng: null,
      });
    }

    if (rows.length > 0) {
      const { error } = await db.from("busy_block").upsert(rows, { onConflict: "source,source_ref,staff_id" });
      if (error) throw new Error(`busy_block: ${error.message}`);
    }

    // Abgleich: HERO-Sperren dieses Mitarbeiters, die an diesem Tag beginnen,
    // aber nicht mehr aus HERO kommen (geloescht, verschoben, umgehaengt).
    // Abwesenheiten nur, wenn sie auch wirklich geladen wurden.
    const { data: existing } = await db.from("busy_block")
      .select("id, source_ref").eq("source", "hero").eq("staff_id", staffId)
      .gte("starts_at", from.toUTC().toISO()).lt("starts_at", to.toUTC().toISO());
    const stale = (existing ?? [])
      .filter((b: any) => !wanted.has(String(b.source_ref)))
      .filter((b: any) => absRes.ok || !String(b.source_ref).startsWith(ABSENCE_REF))
      .map((b: any) => b.id);
    if (stale.length > 0) await db.from("busy_block").delete().in("id", stale);

    return {
      ok: true, blocks: rows.length, removed: stale.length,
      ...(absRes.ok ? {} : { error: `Abwesenheiten: ${absRes.error}` }),
    };
  } catch (e) {
    const error = (e as Error)?.name === "AbortError" ? "HERO antwortet nicht (Timeout)" : (e as Error)?.message || String(e);
    console.warn("[booking] HERO-Live-Abgleich fehlgeschlagen, buche mit letztem Stand:", error);
    return { ok: false, error };
  }
}
