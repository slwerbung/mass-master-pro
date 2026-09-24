// Admin-Aktionen fuer die Terminbuchung. Verlangt einen echten Admin-Token.
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

    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
