// Vorschlag ausfuehren (Klick in der Mail-App): HERO-Mutationen, Ergebnis zurueckschreiben.
//
//   { action: "decide", suggestionId, decision: "accept" | "reject", edits? }
//   { action: "assign", messageId, projectId }                 manuelle Zuordnung aus der Mail-Ansicht
//   { action: "instruct_plan", messageId, text }               Anweisung -> Plan (nur lesen, KI)
//   { action: "instruct_run", messageId, text, plan }          Plan ausfuehren (Projekt / Angebot / Termin)
//
// Nur mit Admin-Sitzung. Schreibende HERO-Aufrufe passieren ausschliesslich hier und
// nur nach einem Klick.

import { createClient } from "@supabase/supabase-js";
import { decideSuggestion, ActionError } from "../_shared/email/action.ts";
import { fail, ok, preflight, readJson, requireAdmin } from "../_shared/email/http.ts";
import { getConfig } from "../_shared/email/config.ts";
import * as H from "../_shared/email/hero.ts";
import { actionStore } from "../_shared/email/store.ts";
import { storageDownloader } from "../_shared/email/uploader.ts";
import { buildLlmDeps } from "../_shared/email/config.ts";
import { offerSuggester } from "../_shared/email/offerWiring.ts";
import type { Gewerk } from "../_shared/email/gewerke.ts";
import { buildCreateProjectPayload } from "../_shared/email/act.ts";
import { berlinToday, planInstruction, runInstruction, type CustomerLookup, type CustomerOption, type InstructionContext, type InstructionPerson, type InstructionPlan } from "../_shared/email/instruct.ts";
import { emailDomain } from "../_shared/email/match.ts";
import { FREEMAIL_DOMAINS } from "../_shared/email/types.ts";
import { heroCreateAppointment } from "../_shared/booking/hero.ts";

const INSTRUCT_MSG_COLS = "id, account_id, direction, category, subject, summary, body_text, from_name, from_addr, to_addrs, has_attachments, extracted, match_info, hero_project_match_id";

/** HERO-Terminkategorien (aus der Terminbuchung, `appointment_category` mit Quelle hero). */
async function heroCategories(sb: any): Promise<{ id: number; label: string }[]> {
  const { data } = await sb.from("appointment_category").select("key, label").eq("source", "hero").order("label");
  return (data || []).map((c: any) => ({ id: Number(String(c.key).replace(/^hero:/, "")), label: c.label })).filter((c: any) => c.id > 0);
}

/**
 * Mitarbeiter, denen in HERO Termine zugewiesen werden koennen. HERO hat dafuer keine Liste: abgeleitet aus den Terminen
 * (wie die Automationen in admin-manage), ergaenzt um die Zuordnung `employees.hero_partner_id`.
 */
async function heroPeople(sb: any, key: string | null): Promise<InstructionPerson[]> {
  const out = new Map<number, string>();
  if (key) {
    const data = await H.heroGraphql(key, `query { calendar_events(last: 300) { partners { id full_name } } }`).catch(() => null);
    for (const e of data?.calendar_events ?? []) for (const p of e?.partners ?? []) if (Number(p?.id) > 0 && p.full_name) out.set(Number(p.id), String(p.full_name));
  }
  const { data: emps } = await sb.from("employees").select("name, hero_partner_id").not("hero_partner_id", "is", null);
  for (const e of emps || []) if (!out.has(Number(e.hero_partner_id))) out.set(Number(e.hero_partner_id), String(e.name));
  return [...out].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function instructionContext(m: any, categories: { id: number; label: string }[], people: InstructionPerson[]): InstructionContext {
  const mi = m.match_info || {};
  return {
    subject: m.subject || "", summary: m.summary ?? null, fromName: m.from_name || m.from_addr,
    projectNr: m.hero_project_match_id ? (mi.projectNr ?? `#${m.hero_project_match_id}`) : null,
    candidates: (mi.candidates || []).map((c: any) => ({ id: Number(c.id), nr: String(c.nr), name: String(c.name || "") })),
    existingCustomer: mi.customer?.id ? { id: Number(mi.customer.id), name: String(mi.customer.name || "") } : null,
    categories, people, bodyText: m.body_text ?? null, today: berlinToday(),
  };
}

/** HERO-Kundensuche fuer die Anweisung: Treffer je Kunde zusammengefasst, das Original vor Dubletten. */
function customerLookup(key: string): CustomerLookup {
  return {
    async search(term) {
      const hits = H.preferEstablished(await H.searchContacts(key, term));
      const out = new Map<number, CustomerOption>();
      for (const h of hits) {
        const cur = out.get(h.customerId);
        // Name des Kunden selbst bevorzugen; ein Ansprechpartner steht nur da, solange der Kunde nicht selbst getroffen ist.
        if (!cur || (!h.isContactPerson && cur.name.endsWith("(Ansprechpartner)"))) {
          out.set(h.customerId, { id: h.customerId, name: h.isContactPerson ? `${h.name} (Ansprechpartner)` : h.name });
        }
      }
      return [...out.values()];
    },
  };
}

const optionOf = (v: any): CustomerOption | null => (Number(v?.id) > 0 ? { id: Number(v.id), name: String(v.name || "").slice(0, 200) } : null);

/** Plan aus dem Client pruefen: nur bekannte Kategorien und Mitarbeiter, gueltige Zeiten, Pflichtfelder. */
function checkPlan(p: any, categories: { id: number; label: string }[], people: InstructionPerson[]): InstructionPlan {
  if (!p || typeof p !== "object") throw new ActionError("Plan fehlt.");
  const mode = p.project?.mode;
  let project: InstructionPlan["project"] = { mode: "keep" };
  if (mode === "new") {
    const name = String(p.project.name || "").trim();
    if (!name) throw new ActionError("Projektname fehlt.");
    project = {
      mode: "new", name: name.slice(0, 200), existingCustomer: optionOf(p.project.existingCustomer),
      requireExisting: !!p.project.requireExisting,
      customerOptions: (Array.isArray(p.project.customerOptions) ? p.project.customerOptions : []).map(optionOf).filter(Boolean).slice(0, 8) as CustomerOption[],
    };
  } else if (mode === "link") {
    const nr = String(p.project.projectNr || "").trim();
    if (!nr) throw new ActionError("Projektnummer fehlt.");
    project = { mode: "link", projectNr: nr, projectId: Number(p.project.projectId) > 0 ? Number(p.project.projectId) : null };
  }
  const appointments: InstructionPlan["appointments"] = [];
  for (const a of (Array.isArray(p.appointments) ? p.appointments : []).slice(0, 6)) {
    const cat = categories.find((c) => c.id === Number(a.categoryId));
    if (!cat) throw new ActionError("Unbekannte Terminkategorie.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(a.time))) throw new ActionError("Datum oder Uhrzeit ungültig.");
    const person = a.partnerId ? people.find((x) => x.id === Number(a.partnerId)) : null;
    if (a.partnerId && !person) throw new ActionError("Unbekannter Mitarbeiter.");
    appointments.push({
      categoryId: cat.id, categoryLabel: cat.label, date: String(a.date), time: String(a.time),
      durationMin: Math.min(Math.max(Math.round(Number(a.durationMin) || 30), 5), 600), title: String(a.title || cat.label).slice(0, 200),
      partnerId: person?.id ?? null, partnerName: person?.name ?? null,
    });
  }
  return { project, offer: !!p.offer, appointments, notDoable: [], summary: String(p.summary || "") };
}

/** Angebotsvorbereitung nach der Zuordnung – nur wenn HERO aktiv ist; die KI-Schicht wird dafuer erst jetzt aufgebaut. */
async function offersFor(sb: any, key: string | null) {
  if (!key) return undefined;
  const s = offerSuggester(sb, await buildLlmDeps(sb), key);
  return { suggest: async (messageId: string, projectId: number, projectNr: string) => { await s.suggest(messageId, projectId, projectNr); } };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await requireAdmin(req, sb))) return fail("Nicht angemeldet oder keine Admin-Rolle.", { code: "unauthorized" });

  const body = await readJson(req);
  if (!["decide", "assign", "instruct_plan", "instruct_run"].includes(body.action)) return fail("Unbekannte Aktion.");
  if (body.action === "decide" && !["accept", "reject"].includes(body.decision)) return fail("decision: accept oder reject.");

  try {
    const [key, heroCfg, gewerke] = await Promise.all([
      H.loadHeroKey(sb), getConfig<any>(sb, "hero", {}), getConfig<Gewerk[]>(sb, "gewerke", []),
    ]);
    const hero = key
      ? {
        addLogbook: (id: number, t: string) => H.addLogbookEntry(key, id, t),
        setStep: (id: number, s: number) => H.setStep(key, id, s),
        projectById: (id: number) => H.projectById(key, id),
        createContact: (c: H.NewContact, src: string) => H.createContact(key, c, src),
        contactsByEmail: (e: string) => H.contactsByEmail(key, e),
        createProject: (p: H.NewProject) => H.createProject(key, p),
        uploadDocument: (id: number, f: { bytes: Uint8Array; filename: string; mime: string }, dt: number) => H.uploadDocument(key, id, f, dt),
        createDocument: (id: number, dt: number, actions: Record<string, unknown>[]) => H.createDocument(key, id, dt, actions),
        documentById: (id: number) => H.documentById(key, id),
        emailTemplates: (kind: H.DocumentKind) => H.emailTemplates(key, H.DOCUMENT_MAIL_CONTEXT[kind]),
        sendDocumentMail: (m: Parameters<typeof H.sendDocumentMail>[1]) => H.sendDocumentMail(key, m),
        setDocumentSent: (id: number) => H.setDocumentStatus(key, id, "SENT"),
      }
      : null;
    const stepIds = Object.values(heroCfg.steps ?? {}).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    let suggestionId = String(body.suggestionId || "");
    if (body.action === "assign") {
      // Manuelle Zuordnung aus der Mail-Detailansicht: als Vorschlag anlegen und sofort annehmen –
      // so laufen Zuordnung, Logbuch und Lern-Feedback ueber genau einen Weg.
      const projectId = Number(body.projectId);
      if (!Number.isFinite(projectId) || projectId <= 0) return fail("Projekt fehlt.");
      const { data: m } = await sb.from("email_messages").select("id, hero_project_match_id").eq("id", String(body.messageId || "")).maybeSingle();
      if (!m) return fail("Mail nicht gefunden.");
      if (m.hero_project_match_id) {
        await sb.from("email_feedback").insert({ message_id: m.id, field: "hero_project", old_value: String(m.hero_project_match_id), new_value: String(projectId) });
      }
      await sb.from("email_suggestions").update({ status: "abgelehnt", decided_at: new Date().toISOString() }).eq("message_id", m.id).eq("type", "link_project").eq("status", "offen");
      const ins = await sb.from("email_suggestions").insert({ message_id: m.id, type: "link_project", payload: { projectId, manual: true } }).select("id").single();
      if (ins.error) return fail(ins.error.message);
      suggestionId = ins.data.id;
      body.decision = "accept";
    }
    const deps = { hero, store: actionStore(sb), files: { download: storageDownloader(sb) }, offers: await offersFor(sb, key), config: { steps: heroCfg.steps ?? {}, offerTypeId: heroCfg.offer_document_type_id ?? null, confirmationTypeId: heroCfg.confirmation_document_type_id ?? null, documentTypeIds: Object.values(heroCfg.document_types ?? {}).map(Number).filter((n) => Number.isFinite(n) && n > 0), stepIds, projectTypeId: heroCfg.project_type_id ?? null, startStepId: heroCfg.start_step_id ?? null, gewerke } };

    if (body.action === "instruct_plan" || body.action === "instruct_run") {
      const text = String(body.text || "").trim().slice(0, 1000);
      if (text.length < 3) return fail("Bitte die Anweisung eintragen.");
      const { data: m } = await sb.from("email_messages").select(INSTRUCT_MSG_COLS).eq("id", String(body.messageId || "")).maybeSingle();
      if (!m) return fail("Mail nicht gefunden.");
      const [categories, people] = await Promise.all([heroCategories(sb), heroPeople(sb, key)]);
      if (body.action === "instruct_plan") {
        const defaultName = String((buildCreateProjectPayload(m, { gewerke }) as any).project?.name || "");
        const ctx = instructionContext(m, categories, people);
        // Aeltere Mails tragen den erkannten Kunden nicht in match_info: dann direkt in HERO nach der Adresse suchen.
        if (!ctx.existingCustomer && key) {
          const found = await H.contactsByEmail(key, m.from_addr).catch(() => []);
          if (found.length) ctx.existingCustomer = { id: found[0].customerId, name: found[0].name };
        }
        // Sagt die Anweisung „Kontakt gibt es schon“, sucht der Plan den Kunden auch ueber Firma und Firmen-Domain.
        const dom = emailDomain(m.from_addr);
        const terms = [m.extracted?.contact?.company, dom && !FREEMAIL_DOMAINS.includes(dom) ? dom : null].filter(Boolean) as string[];
        const plan = await planInstruction(text, ctx, defaultName, await buildLlmDeps(sb), m.id, key ? customerLookup(key) : undefined, terms);
        return ok({ ...plan, people });
      }
      if (!key || !hero) return fail("HERO ist nicht aktiviert (hero_enabled / hero_api_key).");
      const plan = checkPlan(body.plan, categories, people);
      const openOf = async (type: string) => {
        const { data } = await sb.from("email_suggestions").select("id").eq("message_id", m.id).eq("type", type).eq("status", "offen").maybeSingle();
        return data?.id as string | undefined;
      };
      const insert = async (type: string, payload: Record<string, unknown>) => {
        const r = await sb.from("email_suggestions").insert({ message_id: m.id, type, payload }).select("id").single();
        if (r.error) throw new Error(r.error.message);
        return r.data.id as string;
      };
      const steps = await runInstruction(plan, text, {
        async ensureSuggestion(type, extra) {
          const open = await openOf(type);
          if (open) return open;
          if (type === "create_project") return await insert(type, buildCreateProjectPayload(m, { gewerke }));
          if (type === "link_project") return await insert(type, extra);
          const s = offerSuggester(sb, await buildLlmDeps(sb), key);
          await s.suggest(m.id, Number(extra.projectId), (extra.projectNr as string) ?? null, { force: true });
          return (await openOf(type)) ?? null;
        },
        decide: (id, edits) => decideSuggestion({ suggestionId: id, decision: "accept", edits }, deps),
        async currentProject() {
          const { data } = await sb.from("email_messages").select("hero_project_match_id, match_info").eq("id", m.id).maybeSingle();
          return data?.hero_project_match_id ? { id: Number(data.hero_project_match_id), nr: data.match_info?.projectNr ?? null } : null;
        },
        async projectByNr(nr) {
          const n = Number(String(nr).replace(/\D+/g, ""));
          const p = n > 0 ? await H.projectByNumber(key, n) : null;
          return p ? { id: p.id, nr: p.nr } : null;
        },
        createAppointment: (a) => heroCreateAppointment(key, { heroProjectId: a.projectId, title: a.title, startIso: a.startIso, endIso: a.endIso, categoryId: a.categoryId, description: a.description, partnerId: a.partnerId }),
        async finish(note) {
          const now = new Date().toISOString();
          // Was die Anweisung entschieden hat, ist erledigt: offene Projekt-Vorschlaege dieser Mail schliessen.
          await sb.from("email_suggestions").update({ status: "abgelehnt", decided_at: now, result: { reason: "Anweisung ausgeführt" } })
            .eq("message_id", m.id).eq("status", "offen").in("type", ["link_project", "create_project"]);
          await sb.from("email_feedback").insert({ message_id: m.id, field: "anweisung", old_value: null, new_value: `${text}\n---\n${note}`.slice(0, 2000), from_addr: m.from_addr });
          const { count } = await sb.from("email_suggestions").select("id", { count: "exact", head: true }).eq("message_id", m.id).eq("status", "offen");
          await sb.from("email_messages").update({ status: count ? "wartet" : "erledigt" }).eq("id", m.id);
        },
      });
      return ok({ steps });
    }

    const data = await decideSuggestion(
      { suggestionId, decision: body.decision, edits: body.action === "assign" ? { projectId: Number(body.projectId) } : body.edits }, deps,
    );
    return ok(data);
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 400);
    return fail(e instanceof ActionError || e instanceof H.HeroError ? msg : `Fehler: ${msg}`);
  }
});
