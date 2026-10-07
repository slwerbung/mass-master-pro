// Verdrahtung der Angebotsvorbereitung mit Datenbank, HERO und KI.

import { normalizeAutopilot } from "./autopilot.ts";
import { listServices } from "./hero.ts";
import type { LlmDeps } from "./llm.ts";
import { prepareOfferSuggestion, shouldPrepareOffer, type OfferPayload } from "./offer.ts";

export function offerSuggester(sb: any, llm: LlmDeps, heroKey: string) {
  let cache: { id: number; name: string }[] | null = null;
  return {
    /** Legt (falls sinnvoll und erlaubt) den Vorschlag „Angebot vorbereiten" an. Gibt ihn zurueck oder null. */
    async suggest(messageId: string, projectId: number, projectNr: string | null): Promise<OfferPayload | null> {
      const { data: m } = await sb.from("email_messages")
        .select("id, account_id, direction, category, subject, body_text, summary, extracted").eq("id", messageId).maybeSingle();
      if (!m || !shouldPrepareOffer(m)) return null;
      const { data: acc } = await sb.from("email_accounts").select("autopilot").eq("id", m.account_id).maybeSingle();
      if (normalizeAutopilot(acc?.autopilot).prepare_offer === "off") return null;
      return await prepareOfferSuggestion(messageId, projectId, projectNr, {
        llm,
        services: async () => (cache ??= await listServices(heroKey)),
        loadMessage: async () => m,
        createSuggestion: async (id, type, payload) => {
          const { error } = await sb.from("email_suggestions").insert({ message_id: id, type, payload });
          if (error) {
            if (String(error.code) === "23505") return false; // gibt es schon offen
            throw new Error(error.message);
          }
          return true;
        },
      });
    },
  };
}
