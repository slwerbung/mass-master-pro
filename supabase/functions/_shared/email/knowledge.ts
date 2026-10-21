// Wissensdatei (email_knowledge): Saetze, die ein Mensch dem Assistenten beibringt –
// aus einer Freitext-Korrektur („Das ist falsch, richtig waere …") oder von Hand in den
// Einstellungen. Jeder Eintrag gilt entweder fuer alle Mails oder nur fuer einen Absender
// (genaue Adresse oder @domain).
//
// Allgemeines Wissen steht im festen, gecachten Systemteil des Prompts; Wissen zu einem
// Absender und der Hinweis zu genau dieser Mail stehen vor der Mail im Nutzerteil – so
// bleibt der Cache stabil, und fremde Absender sehen nichts voneinander.

import { emailDomain, matchesPattern } from "./mail.ts";
import { FREEMAIL_DOMAINS, type KnowledgeScope } from "./types.ts";

export type { KnowledgeScope };

export interface KnowledgeEntry { id?: string; text: string; from_pattern: string | null }

/** Grenzen, damit die Wissensdatei den Prompt nicht sprengt. Neueste Eintraege zuerst. */
export const KNOWLEDGE_LIMITS = { general: 40, sender: 15, chars: 6000 } as const;

export const KNOWLEDGE_TEXT_MAX = 1000;

/** Muster fuer einen neuen Eintrag aus der gewaehlten Reichweite; `undefined` = nichts merken. */
export function patternForScope(scope: KnowledgeScope, fromAddr: string): string | null | undefined {
  const addr = String(fromAddr || "").trim().toLowerCase();
  if (scope === "alle") return null;
  if (scope === "absender") {
    if (!addr.includes("@")) throw new Error("Die Mail hat keine Absenderadresse.");
    return addr;
  }
  if (scope === "domain") {
    const dom = emailDomain(addr);
    if (!dom) throw new Error("Die Mail hat keine Absenderadresse.");
    if (FREEMAIL_DOMAINS.includes(dom)) throw new Error(`@${dom} ist ein Freemail-Anbieter – bitte „nur dieser Absender“ wählen.`);
    return `@${dom}`;
  }
  return undefined;
}

/** Leeres Muster = allgemein; sonst Adresse oder @domain, klein geschrieben. */
export function normalizePattern(p: unknown): string | null {
  const s = String(p ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^@[^\s@]+\.[^\s@]+$|^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error("Absender: Adresse (a@b.de) oder Domain (@b.de) – oder leer für alle Mails.");
  return s;
}

/** Eintraege (neueste zuerst) in „allgemein" und „passt auf diesen Absender" aufteilen. */
export function splitKnowledge(entries: KnowledgeEntry[], fromAddr: string | null): { general: string[]; sender: string[] } {
  const general: string[] = [];
  const sender: string[] = [];
  let chars = 0;
  for (const e of entries) {
    const text = String(e.text || "").trim();
    if (!text || chars + text.length > KNOWLEDGE_LIMITS.chars) continue;
    if (!e.from_pattern) {
      if (general.length >= KNOWLEDGE_LIMITS.general) continue;
      general.push(text);
    } else if (fromAddr && matchesPattern(fromAddr, e.from_pattern)) {
      if (sender.length >= KNOWLEDGE_LIMITS.sender) continue;
      sender.push(text);
    } else continue;
    chars += text.length;
  }
  return { general, sender };
}

/** Fester Block fuer den Systemteil (leer, wenn es nichts gibt). */
export function generalKnowledgeBlock(general: string[]): string {
  if (!general.length) return "";
  return "\n\nWissensdatei (von Mitarbeitern beigebracht, gilt fuer alle Mails – hat Vorrang vor deiner Einschaetzung):\n" +
    general.map((t) => `- ${t}`).join("\n");
}

/**
 * Hinweise fuer genau diese Mail (vor <mail> im Nutzerteil). Das sind Eingaben von
 * Mitarbeitern, keine Fremddaten – aber `</mail>` wird trotzdem entschaerft.
 */
export function guidanceBlock(o: { sender: string[]; note?: string | null }): string {
  const fence = (t: string) => t.replace(/<\s*\/?\s*mail\s*>/gi, "‹mail›");
  const parts: string[] = [];
  if (o.sender.length) parts.push(`Wissen zu diesem Absender (von Mitarbeitern):\n${o.sender.map((t) => `- ${fence(t)}`).join("\n")}`);
  if (o.note?.trim()) {
    parts.push(
      "Korrektur eines Mitarbeiters zu GENAU DIESER Mail – ein frueheres Ergebnis war falsch. " +
      `Richte dich danach, sie hat Vorrang:\n${fence(o.note.trim().slice(0, KNOWLEDGE_TEXT_MAX))}`,
    );
  }
  return parts.length ? `${parts.join("\n\n")}\n\n` : "";
}
