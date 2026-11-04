// Verdrahtung „Bestellung -> AB vorbereiten" mit Datenbank, HERO und KI (nur lesend: der
// Vorschlag aendert nichts in HERO, erst der Klick in der Mail-App, siehe action.ts).

import { normalizeAutopilot } from "./autopilot.ts";
import { itemsFromDraft, pickConfirmationPositions, positionsFromDoc, shouldPrepareConfirmation, type ConfirmationPayload, type SourceDoc } from "./confirmation.ts";
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

const MSG_COLS = "id, account_id, direction, category, subject, body_text, summary, extracted, from_addr, hero_project_match_id, match_info";

const toSource = (d: H.HeroDocument, kind: "ab" | "angebot"): SourceDoc => ({
  id: d.id, nr: d.nr, date: d.date, kind, projectId: d.projectId!, projectNr: d.projectNr, items: itemsFromDraft(d.draft),
});

/** Abgeschlossene Angebote (PDF da, nicht geloescht) eines Projekts mit Positionen, neueste zuerst. */
export function usableOffers(docs: H.HeroDocument[]): SourceDoc[] {
  return docs.filter((d) => d.statusCode >= 100 && d.statusCode !== 1000).map((d) => toSource(d, "angebot")).filter((d) => d.items.length);
}

type Msg = { subject: string; summary: string | null; extracted: any; from_addr: string; match_info: any };

/** Vorschlags-Payload (gemeinsam fuer Bestellung und „AB aus Angebot"). */
function buildPayload(
  m: Msg, projectId: number | null, projectNr: string | null, docs: SourceDoc[], positions: ConfirmationPayload["positions"],
  o: { summary: string; projectName: string | null; openPoints: string[]; fromOffer?: boolean }, cfg: ConfirmationConfig,
) {
  const ex = m.extracted ?? {};
  const c = ex.contact ?? {};
  const g = pickGewerk(cfg.gewerke, { service: ex.request?.service ?? null, text: `${m.subject}\n${m.summary ?? ""}` });
  const stepOptions = (["detailgespraech", "projektplanung"] as (keyof StepIds)[])
    .filter((k) => cfg.steps[k]).map((k) => ({ key: k, stepId: cfg.steps[k]!, label: stepLabel(k) }));
  const payload: ConfirmationPayload & { stepOptions: typeof stepOptions } = {
    projectId, projectNr: projectNr ?? m.match_info?.projectNr ?? null,
    existingCustomer: projectId ? null : (m.match_info?.customer ?? null),
    contact: projectId ? null : {
      salutation: c.salutation ?? null, first_name: c.first_name ?? null, last_name: c.last_name ?? null, company: c.company ?? null,
      email: c.email || m.from_addr, phone: c.phone ?? null, street: c.street ?? null, zip: c.zip ?? null, city: c.city ?? null,
    },
    project: {
      name: (o.projectName || ex.request?.project_name || m.subject || "Bestellung").slice(0, 200),
      gewerk: g ? { short: g.short, measure_id: g.measure_id } : null,
    },
    summary: o.summary || m.summary || "",
    sources: docs.map((d) => ({ id: d.id, nr: d.nr, kind: d.kind, date: d.date, projectNr: d.projectNr })),
    positions,
    openPoints: o.openPoints,
    formality: c.formality ?? null,
    recipient: String(c.email || m.from_addr || "").toLowerCase(),
    toStepId: stepOptions[0]?.stepId ?? null,
    stepOptions,
    ...(o.fromOffer ? { fromOffer: true } : {}),
  };
  return payload;
}

export function confirmationSuggester(sb: any, llm: LlmDeps, heroKey: string, cfg: ConfirmationConfig) {
  return {
    /** Legt (falls sinnvoll und erlaubt) den Vorschlag „Projekt + AB vorbereiten" an. Gibt ihn zurueck oder null. */
    async suggest(messageId: string): Promise<ConfirmationPayload | null> {
      if (!cfg.confirmationTypeId) return null;
      const { data: m } = await sb.from("email_messages")
        .select(MSG_COLS)
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
      if (customerId) {
        const projects = await H.openProjectsOfCustomer(heroKey, customerId, []).catch(() => []);
        const ids = [...new Set([...(projectId ? [projectId] : []), ...projects.map((p) => p.id)])];
        const abs = await H.documentsOfProjects(heroKey, ids, [cfg.confirmationTypeId], 20).catch(() => []);
        // Nur abgeschlossene ABs (PDF da) taugen als Vorlage.
        docs.push(...abs.filter((d) => d.statusCode >= 100).map((d) => toSource(d, "ab")).filter((d) => d.items.length).slice(0, MAX_ABS));
      }
      if (projectId && cfg.offerTypeId) {
        const offers = await H.documentsOfProjects(heroKey, [projectId], [cfg.offerTypeId], 10).catch(() => []);
        docs.push(...usableOffers(offers).slice(0, MAX_OFFERS));
      }

      // Ohne Vorlage gibt es nichts auszuwaehlen – dann kein KI-Aufruf, nur Projekt + leere AB als Vorschlag.
      const { result, positions } = docs.length
        ? await pickConfirmationPositions(m, docs, { llm, reference: await loadReference(sb, "prepare_confirmation") })
        : { result: { summary: "", positions: [], open_points: [], project_name: null }, positions: [] };

      const openPoints = [...result.open_points];
      if (!docs.length) openPoints.unshift("Keine frühere AB und kein Angebot gefunden – Positionen bitte in HERO anlegen.");
      const payload = buildPayload(m, projectId, project?.nr ?? null, docs, positions, { summary: result.summary, projectName: result.project_name, openPoints }, cfg);
      const { error } = await sb.from("email_suggestions").insert({ message_id: messageId, type: "create_confirmation", payload });
      if (error) {
        if (String(error.code) === "23505") return null; // gibt es schon offen
        throw new Error(error.message);
      }
      return payload;
    },

    /**
     * Auf Anweisung („AB aus Angebot erstellen“): Vorschlag mit ALLEN Positionen des neuesten abgeschlossenen
     * Angebots im Projekt – ohne KI, Mengen und Preise wie im Angebot. Ein offener AB-Vorschlag der Mail wird
     * dadurch ersetzt. Gibt die Vorschlags-ID zurueck; wirft, wenn es kein passendes Angebot gibt.
     */
    async fromOffer(messageId: string, projectId: number, projectNr: string | null): Promise<string> {
      if (!cfg.confirmationTypeId) throw new Error("Dokumenttyp „Auftragsbestätigung“ ist nicht konfiguriert (Einstellungen → Firma & HERO).");
      if (!cfg.offerTypeId) throw new Error("Dokumenttyp „Angebot“ ist nicht konfiguriert (Einstellungen → Firma & HERO).");
      const { data: m } = await sb.from("email_messages").select(MSG_COLS).eq("id", messageId).maybeSingle();
      if (!m) throw new Error("Mail nicht gefunden.");
      const offers = usableOffers(await H.documentsOfProjects(heroKey, [projectId], [cfg.offerTypeId], 10));
      const offer = offers[0];
      if (!offer) throw new Error(`In ${projectNr ?? "dem Projekt"} gibt es kein abgeschlossenes Angebot mit Positionen – bitte das Angebot in HERO abschließen oder die AB von Hand anlegen.`);
      const openPoints = offers.length > 1 ? [`Es gibt ${offers.length} Angebote – übernommen ist das neueste (${offer.nr}).`] : [];
      const payload = buildPayload(m, projectId, projectNr, [offer], positionsFromDoc(offer), {
        summary: `Auftragsbestätigung zu Angebot ${offer.nr}`, projectName: null, openPoints, fromOffer: true,
      }, cfg);
      // Hoechstens ein offener AB-Vorschlag je Mail: der bisherige (KI-Auswahl) wird ersetzt.
      await sb.from("email_suggestions").update({ status: "abgelehnt", decided_at: new Date().toISOString(), result: { reason: `Ersetzt: AB aus Angebot ${offer.nr}` } })
        .eq("message_id", messageId).eq("type", "create_confirmation").eq("status", "offen");
      const { data, error } = await sb.from("email_suggestions").insert({ message_id: messageId, type: "create_confirmation", payload }).select("id").single();
      if (error) throw new Error(error.message);
      return String(data.id);
    },
  };
}
