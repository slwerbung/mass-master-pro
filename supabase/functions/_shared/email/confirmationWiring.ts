// Verdrahtung „Bestellung -> AB vorbereiten" mit Datenbank, HERO und KI (nur lesend: der
// Vorschlag aendert nichts in HERO, erst der Klick in der Mail-App, siehe action.ts).

import { normalizeAutopilot } from "./autopilot.ts";
import { itemsFromDraft, pickConfirmationPositions, shouldPrepareConfirmation, type ConfirmationPayload, type SourceDoc } from "./confirmation.ts";
import { pickGewerk, type Gewerk } from "./gewerke.ts";
import * as H from "./hero.ts";
import type { LlmDeps } from "./llm.ts";
import { loadReference } from "./store.ts";
import { stepLabel, type StepIds } from "./steps.ts";

export interface ConfirmationConfig {
  confirmationTypeId: number | null;
  offerTypeId: number | null;
  steps: StepIds;
  gewerke: Gewerk[];
}

/** Hoechstens so viele Vorlagen gehen ans Modell (neueste zuerst). */
const MAX_ABS = 3;
const MAX_OFFERS = 2;

export function confirmationSuggester(sb: any, llm: LlmDeps, heroKey: string, cfg: ConfirmationConfig) {
  return {
    /** Legt (falls sinnvoll und erlaubt) den Vorschlag „Projekt + AB vorbereiten" an. Gibt ihn zurueck oder null. */
    async suggest(messageId: string): Promise<ConfirmationPayload | null> {
      if (!cfg.confirmationTypeId) return null;
      const { data: m } = await sb.from("email_messages")
        .select("id, account_id, direction, category, subject, body_text, summary, extracted, from_addr, hero_project_match_id, match_info")
        .eq("id", messageId).maybeSingle();
      if (!m || !shouldPrepareConfirmation(m)) return null;
      const { data: acc } = await sb.from("email_accounts").select("autopilot").eq("id", m.account_id).maybeSingle();
      if (normalizeAutopilot(acc?.autopilot).create_confirmation === "off") return null;

      // Kunde: ueber das zugeordnete Projekt, sonst ueber die Zuordnung (Adresse, Domain, Firma), zuletzt die Absenderadresse.
      const projectId: number | null = m.hero_project_match_id ?? null;
      const project = projectId ? await H.projectById(heroKey, projectId).catch(() => null) : null;
      let customerId: number | null = project?.customerId ?? m.match_info?.customer?.id ?? null;
      if (!customerId) customerId = (await H.contactsByEmail(heroKey, m.from_addr).catch(() => []))[0]?.customerId ?? null;

      const docs: SourceDoc[] = [];
      const toSource = (d: H.HeroDocument, kind: "ab" | "angebot"): SourceDoc => ({
        id: d.id, nr: d.nr, date: d.date, kind, projectId: d.projectId!, projectNr: d.projectNr, items: itemsFromDraft(d.draft),
      });
      if (customerId) {
        const projects = await H.openProjectsOfCustomer(heroKey, customerId, []).catch(() => []);
        const ids = [...new Set([...(projectId ? [projectId] : []), ...projects.map((p) => p.id)])];
        const abs = await H.documentsOfProjects(heroKey, ids, [cfg.confirmationTypeId], 20).catch(() => []);
        // Nur abgeschlossene ABs (PDF da) taugen als Vorlage.
        docs.push(...abs.filter((d) => d.statusCode >= 100).map((d) => toSource(d, "ab")).filter((d) => d.items.length).slice(0, MAX_ABS));
      }
      if (projectId && cfg.offerTypeId) {
        const offers = await H.documentsOfProjects(heroKey, [projectId], [cfg.offerTypeId], 10).catch(() => []);
        docs.push(...offers.filter((d) => d.statusCode >= 100).map((d) => toSource(d, "angebot")).filter((d) => d.items.length).slice(0, MAX_OFFERS));
      }

      // Ohne Vorlage gibt es nichts auszuwaehlen – dann kein KI-Aufruf, nur Projekt + leere AB als Vorschlag.
      const { result, positions } = docs.length
        ? await pickConfirmationPositions(m, docs, { llm, reference: await loadReference(sb, "prepare_confirmation") })
        : { result: { summary: "", positions: [], open_points: [], project_name: null }, positions: [] };

      const ex = m.extracted ?? {};
      const c = ex.contact ?? {};
      const g = pickGewerk(cfg.gewerke, { service: ex.request?.service ?? null, text: `${m.subject}\n${m.summary ?? ""}` });
      const stepOptions = (["detailgespraech", "projektplanung"] as (keyof StepIds)[])
        .filter((k) => cfg.steps[k]).map((k) => ({ key: k, stepId: cfg.steps[k]!, label: stepLabel(k) }));
      const openPoints = [...result.open_points];
      if (!docs.length) openPoints.unshift("Keine frühere AB und kein Angebot gefunden – Positionen bitte in HERO anlegen.");
      const payload: ConfirmationPayload & { stepOptions: typeof stepOptions } = {
        projectId, projectNr: project?.nr ?? m.match_info?.projectNr ?? null,
        existingCustomer: projectId ? null : (m.match_info?.customer ?? null),
        contact: projectId ? null : {
          salutation: c.salutation ?? null, first_name: c.first_name ?? null, last_name: c.last_name ?? null, company: c.company ?? null,
          email: c.email || m.from_addr, phone: c.phone ?? null, street: c.street ?? null, zip: c.zip ?? null, city: c.city ?? null,
        },
        project: {
          name: (result.project_name || ex.request?.project_name || m.subject || "Bestellung").slice(0, 200),
          gewerk: g ? { short: g.short, measure_id: g.measure_id } : null,
        },
        summary: result.summary || m.summary || "",
        sources: docs.map((d) => ({ id: d.id, nr: d.nr, kind: d.kind, date: d.date, projectNr: d.projectNr })),
        positions,
        openPoints,
        formality: c.formality ?? null,
        recipient: String(c.email || m.from_addr || "").toLowerCase(),
        toStepId: stepOptions[0]?.stepId ?? null,
        stepOptions,
      };
      const { error } = await sb.from("email_suggestions").insert({ message_id: messageId, type: "create_confirmation", payload });
      if (error) {
        if (String(error.code) === "23505") return null; // gibt es schon offen
        throw new Error(error.message);
      }
      return payload;
    },
  };
}
