// Termineinladungen aus der App heraus. Verlangt einen echten Mitarbeiter-
// oder Admin-Token.
//
// Der Kern der Entscheidung: die Einladung geht von einem MITARBEITER aus, und
// wer sie verschickt, bekommt den Termin. Auch die TERMINART waehlt der
// Mitarbeiter, nicht der Kunde — er weiss, worum es geht. Deshalb stehen beide
// im Link:
//   * allgemein:    https://captfix.app/termin/m/<slug>?art=<terminart>
//   * mit Projekt:  https://captfix.app/termin/<projekt>?m=<slug>&art=<terminart>
// Der Link entsteht erst, wenn die Terminart gewaehlt ist. Der Slug selbst ist
// dauerhaft. Rechnen tut ohnehin `booking-api`: dieser Dienst stellt nur Link
// und Mail bereit und kann keine Termine anlegen.
//
// Aktionen:
//   POST { action:'link',  token, projectId? }
//     -> Slug, Name und die buchbaren Terminarten, jede mit FERTIGEM Link.
//   POST { action:'send',  token, email, ruleSet, projectId?, projectNumber?, note? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APP_BASE = "https://captfix.app";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Slug aus dem Namen. Gleiche Regeln wie in der Migration (m7), damit ein
 * nachtraeglich angelegter Mitarbeiter denselben Linkstil bekommt.
 */
function slugAus(name: string): string {
  const umlaute: Record<string, string> = {
    "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "ae", "Ö": "oe", "Ü": "ue", "ß": "ss",
  };
  const basis = name.replace(/[äöüÄÖÜß]/g, (c) => umlaute[c] ?? c)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return basis;
}

/**
 * Der Buchungsdatensatz des angemeldeten Mitarbeiters — notfalls neu angelegt.
 *
 * Ohne Arbeitszeiten gaebe es keine freien Zeiten, und der Kunde stuende vor
 * einem leeren Kalender. Deshalb bekommt ein neu angelegter Mitarbeiter
 * Mo–Fr 08–17 Uhr als Startwert, aenderbar im Adminmenue.
 */
async function staffFuerMitarbeiter(db: any, employeeId: string) {
  const { data: emp } = await db.from("employees")
    .select("id, name, hero_partner_id").eq("id", employeeId).maybeSingle();
  if (!emp) return { error: "Mitarbeiter nicht gefunden", status: 404 };

  const { data: vorhanden } = await db.from("staff")
    .select("id, display_name, booking_slug, active").eq("employee_id", employeeId).maybeSingle();

  if (vorhanden) {
    if (!vorhanden.active) {
      return { error: "Dieser Mitarbeiter ist für Termine abgeschaltet (Adminmenü → Termine)", status: 409 };
    }
    if (vorhanden.booking_slug) return { staff: vorhanden, name: emp.name as string };
    // Datensatz ohne Slug (vor m7 angelegt): jetzt einen vergeben.
    const slug = await freierSlug(db, slugAus(String(vorhanden.display_name || emp.name)));
    const { data: up, error } = await db.from("staff")
      .update({ booking_slug: slug }).eq("id", vorhanden.id)
      .select("id, display_name, booking_slug, active").single();
    if (error) return { error: error.message, status: 500 };
    return { staff: up, name: emp.name as string };
  }

  const slug = await freierSlug(db, slugAus(String(emp.name)));
  const { data: neu, error } = await db.from("staff").insert({
    employee_id: employeeId, display_name: emp.name, active: true,
    skills: [], booking_slug: slug,
  }).select("id, display_name, booking_slug, active").single();
  if (error) return { error: error.message, status: 500 };

  const hours = [1, 2, 3, 4, 5].map((wd) => ({
    staff_id: neu.id, weekday: wd, start_time: "08:00:00", end_time: "17:00:00",
  }));
  await db.from("working_hours").insert(hours);
  return { staff: neu, name: emp.name as string, angelegt: true };
}

/** Freien Slug finden. Bei Namensgleichheit haengt eine Nummer dran. */
async function freierSlug(db: any, basis: string): Promise<string> {
  const start = basis || "mitarbeiter";
  for (let i = 1; i <= 50; i++) {
    const kandidat = i === 1 ? start : `${start}-${i}`;
    const { data } = await db.from("staff").select("id").eq("booking_slug", kandidat).maybeSingle();
    if (!data) return kandidat;
  }
  return `${start}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Die buchbaren Terminarten — dieselbe Regel wie in `booking-api`: aktiv UND
 * ihre Kategorie als buchbar markiert. Sortiert nach Dauer.
 *
 * Die Liste kommt vom Server, damit im Dialog nichts auftaucht, was gar nicht
 * buchbar ist (der Kunde liefe sonst in einen leeren Kalender).
 */
async function buchbareTerminarten(db: any): Promise<{ key: string; label: string; durationMinutes: number }[]> {
  const { data } = await db.from("rule_set")
    .select("key, label, duration_minutes, category_id").eq("active", true);
  const arten = data ?? [];
  if (arten.length === 0) return [];
  const { data: cats } = await db.from("appointment_category").select("id, is_bookable");
  const buchbar = new Map((cats ?? []).map((c: any) => [c.id, c.is_bookable]));
  return arten
    .filter((r: any) => buchbar.get(r.category_id) === true)
    .sort((a: any, b: any) => a.duration_minutes - b.duration_minutes)
    .map((r: any) => ({ key: r.key, label: r.label, durationMinutes: r.duration_minutes }));
}

/** Firmenname fuer die Mail. */
async function firma(db: any): Promise<string> {
  const { data } = await db.from("app_config").select("value").eq("key", "legal_info").maybeSingle();
  if (data?.value) {
    try {
      const info = JSON.parse(data.value);
      if (info?.companyName && String(info.companyName).trim()) return String(info.companyName).trim();
    } catch { /* Standard behalten */ }
  }
  return "SL WERBUNG";
}

/**
 * Die Einladungsmail.
 *
 * Zwei Dinge bewusst so:
 *   * KEIN Mitarbeitername. In der Mail stand vorher nur der Nachname
 *     ("Langner möchte…"), und das wirkt auf einen Kunden befremdlich. Es
 *     schreibt die Firma, nicht eine Einzelperson.
 *   * Das Branding ist UNSERE Firma, nicht "Captfix". Der Kunde kennt den
 *     Namen des Werkzeugs nicht; er würde die Mail eher für Spam halten.
 */
function baueMail(opts: {
  companyName: string; link: string; artLabel: string;
  projectNumber: string | null; note: string;
}) {
  const bezug = opts.projectNumber
    ? ` zu Ihrem Projekt <strong>${escapeHtml(opts.projectNumber)}</strong>`
    : "";
  const subject = opts.projectNumber
    ? `Terminvorschlag: ${opts.artLabel} · Projekt ${opts.projectNumber}`
    : `Terminvorschlag: ${opts.artLabel}`;
  const noteBlock = opts.note.trim()
    ? `<p style="margin:16px 0;white-space:pre-wrap">${escapeHtml(opts.note.trim())}</p>`
    : "";
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;max-width:560px;line-height:1.55;font-size:15px">
      <p style="font-weight:600;font-size:17px;margin:0 0 18px">${escapeHtml(opts.companyName)}</p>
      <p>Guten Tag,</p>
      <p>gerne vereinbaren wir${bezug} einen Termin mit Ihnen: <strong>${escapeHtml(opts.artLabel)}</strong>.
         Den Zeitpunkt können Sie selbst aussuchen.</p>
      ${noteBlock}
      <p style="margin:16px 0">Link öffnen, eine freie Zeit wählen, Kontaktdaten prüfen – fertig.
         Die Bestätigung kommt sofort per E-Mail, mit Kalendereintrag zum Hinzufügen.</p>
      <p style="margin:24px 0">
        <a href="${opts.link}" style="display:inline-block;background:#111827;color:#ffffff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">Freie Zeit auswählen</a>
      </p>
      <p style="font-size:13px;color:#6b7280">Falls der Knopf nicht geht: ${opts.link}</p>
      <p style="margin-top:22px">Mit freundlichen Grüßen<br>${escapeHtml(opts.companyName)}</p>
    </div>`;
  return { subject, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);

  try {
    const body = await req.json();
    const payload = body.token
      ? await verifySessionToken(String(body.token), getSessionSecret())
      : null;
    if (!payload || (payload.role !== "employee" && payload.role !== "admin")) {
      return json({ error: "Unauthorized" }, 401);
    }
    // Der Absender muss ein Mitarbeiter sein: der Termin wird IHM zugeordnet.
    // Der Admin-Login ist kein Mitarbeiter (kein Datensatz, keine
    // HERO-Zuordnung) und kann deshalb nicht einladen.
    const employeeId = payload.role === "employee" ? String(payload.userId || "") : "";
    if (!employeeId) {
      return json({ error: "Termineinladungen gehen von einem Mitarbeiter aus. Bitte als Mitarbeiter anmelden." }, 403);
    }

    const db = sb();

    const { data: heroCfg } = await db.from("app_config").select("value").eq("key", "hero_enabled").maybeSingle();
    const heroAktiv = (heroCfg as any)?.value === "true";

    const res = await staffFuerMitarbeiter(db, employeeId);
    if ("error" in res) return json({ error: res.error }, res.status);
    const slug = String(res.staff.booking_slug);

    // Bei aktiver Integration ohne HERO-Zuordnung geht es nicht weiter: der
    // Termin landete sonst in HERO ohne Zustaendigen, und HERO-Termine dieses
    // Kollegen blockieren bei uns keine Zeiten.
    if (heroAktiv) {
      const { data: emp } = await db.from("employees")
        .select("hero_partner_id").eq("id", employeeId).maybeSingle();
      const p = Number((emp as any)?.hero_partner_id);
      if (!Number.isFinite(p) || p <= 0) {
        return json({
          error: "Für Termineinladungen muss der Mitarbeiter in HERO zugeordnet sein (Adminmenü → Mitarbeiter).",
        }, 409);
      }
    }

    const projectId = String(body.projectId || "").trim();
    const arten = await buchbareTerminarten(db);
    if (arten.length === 0) return json({ error: "Es ist keine Terminart buchbar (Adminmenü → Termine)." }, 503);

    /** Der fertige Link zu EINER Terminart. Nur hier wird er gebaut. */
    const link = (artKey: string) => {
      const art = `art=${encodeURIComponent(artKey)}`;
      return projectId
        ? `${APP_BASE}/termin/${encodeURIComponent(projectId)}?m=${encodeURIComponent(slug)}&${art}`
        : `${APP_BASE}/termin/m/${encodeURIComponent(slug)}?${art}`;
    };

    if (body.action === "link") {
      return json({
        slug, name: res.staff.display_name,
        mitProjekt: !!projectId,
        // Jede Terminart mit ihrem eigenen Link: der Mitarbeiter waehlt, der
        // Kunde bekommt nur noch den Kalender dieser einen Art zu sehen.
        appointments: arten.map((a) => ({ ...a, link: link(a.key) })),
        neuAngelegt: !!(res as any).angelegt,
      });
    }

    if (body.action === "send") {
      const email = String(body.email || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Ungültige E-Mail-Adresse" }, 400);

      // Die Terminart ist Pflicht: sie waehlt der Mitarbeiter, nicht der Kunde.
      const art = arten.find((a) => a.key === String(body.ruleSet || ""));
      if (!art) return json({ error: "Bitte eine buchbare Terminart angeben" }, 400);

      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY ist nicht konfiguriert" }, 500);

      const companyName = await firma(db);
      const projectNumber = projectId ? (String(body.projectNumber || "").trim() || null) : null;
      const url = link(art.key);
      const { subject, html } = baueMail({
        companyName, link: url, artLabel: art.label,
        projectNumber, note: String(body.note || ""),
      });

      // Mailadresse bleibt bei captfix.app (dort liegt die verifizierte
      // Domain), der Anzeigename ist unsere Firma.
      const mail = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${companyName} <notifications@captfix.app>`,
          to: [email], subject, html,
        }),
      });
      if (!mail.ok) {
        const txt = await mail.text();
        return json({ error: `Mailversand fehlgeschlagen: ${txt.slice(0, 200)}` }, 502);
      }
      return json({ ok: true, email, link: url, subject, ruleSet: art.key });
    }

    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
