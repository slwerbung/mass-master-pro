// Vorschlag ausfuehren (Klick in der Mail-App): HERO-Mutationen, Ergebnis zurueckschreiben.
//
//   { action: "decide", suggestionId, decision: "accept" | "reject", edits? }
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
  if (body.action !== "decide" && body.action !== "assign") return fail("Unbekannte Aktion.");
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
        createOffer: (id: number, dt: number) => H.createEmptyDocument(key, id, dt),
        uploadDocument: (id: number, f: { bytes: Uint8Array; filename: string; mime: string }, dt: number) => H.uploadDocument(key, id, f, dt),
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
    const data = await decideSuggestion(
      { suggestionId, decision: body.decision, edits: body.action === "assign" ? { projectId: Number(body.projectId) } : body.edits },
      { hero, store: actionStore(sb), files: { download: storageDownloader(sb) }, offers: await offersFor(sb, key), config: { steps: heroCfg.steps ?? {}, offerTypeId: heroCfg.offer_document_type_id ?? null, documentTypeIds: Object.values(heroCfg.document_types ?? {}).map(Number).filter((n) => Number.isFinite(n) && n > 0), stepIds, projectTypeId: heroCfg.project_type_id ?? null, startStepId: heroCfg.start_step_id ?? null, gewerke } },
    );
    return ok(data);
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 400);
    return fail(e instanceof ActionError || e instanceof H.HeroError ? msg : `Fehler: ${msg}`);
  }
});
