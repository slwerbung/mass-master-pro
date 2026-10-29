// Verdrahtung von hero.ts mit den Schnittstellen der Zuordnung und des Handelns:
// Kontakt-Zwischenspeicher (24 h), Thread-Zuordnung aus der Datenbank.

import * as H from "./hero.ts";
import type { ActHero } from "./act.ts";
import type { MatchHero } from "./matchStage.ts";

const CONTACT_TTL_MS = 24 * 3600_000;

export function matchHero(sb: any, apiKey: string, excludedSteps: number[]): MatchHero {
  return {
    async threadProject(threadId) {
      const { data } = await sb.from("email_threads").select("hero_project_match_id").eq("id", threadId).maybeSingle();
      return data?.hero_project_match_id ?? null;
    },
    async sentProject(accountId, messageId) {
      const { data } = await sb.from("email_sent").select("project_id").eq("account_id", accountId).eq("message_id", messageId)
        .not("project_id", "is", null).limit(1).maybeSingle();
      return data?.project_id != null ? Number(data.project_id) : null;
    },
    projectByNumber: (rel) => H.projectByNumber(apiKey, rel),
    projectById: (id) => H.projectById(apiKey, id),
    async contactsByEmail(email) {
      const key = email.toLowerCase();
      const { data } = await sb.from("hero_contact_cache").select("contacts, fetched_at").eq("email", key).maybeSingle();
      if (data && Date.now() - new Date(data.fetched_at).getTime() < CONTACT_TTL_MS) return data.contacts as H.HeroContact[];
      const contacts = await H.contactsByEmail(apiKey, key);
      await sb.from("hero_contact_cache").upsert({ email: key, contacts, fetched_at: new Date().toISOString() });
      return contacts;
    },
    async searchContacts(term) {
      // Gleicher Zwischenspeicher wie oben, eigener Schluessel-Raum (kein @ am Anfang einer Adresse).
      const key = `search:${term.trim().toLowerCase()}`;
      const { data } = await sb.from("hero_contact_cache").select("contacts, fetched_at").eq("email", key).maybeSingle();
      if (data && Date.now() - new Date(data.fetched_at).getTime() < CONTACT_TTL_MS) return data.contacts as H.HeroContactHit[];
      const contacts = await H.searchContacts(apiKey, term);
      await sb.from("hero_contact_cache").upsert({ email: key, contacts, fetched_at: new Date().toISOString() });
      return contacts;
    },
    openProjects: (customerId) => H.openProjectsOfCustomer(apiKey, customerId, excludedSteps),
  };
}

export function actHero(apiKey: string): ActHero {
  return {
    addLogbook: (id, text) => H.addLogbookEntry(apiKey, id, text),
    async projectStep(id) {
      const p = await H.projectById(apiKey, id);
      return p ? { stepId: p.stepId, nr: p.nr, name: p.name } : null;
    },
    setStep: (id, stepId) => H.setStep(apiKey, id, stepId),
  };
}
