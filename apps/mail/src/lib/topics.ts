// Themen aus `email-api` (list_topics / get_message). Gleiche Form wie `Topic` in supabase/functions/_shared/email/topicsDb.ts.
import type { Category, TopicReason, TopicState } from "./shared";

export interface TopicMail {
  id: string; direction: "in" | "out"; from_name: string; from_addr: string; subject: string; sent_at: string | null;
  summary: string | null; category: Category | null; has_attachments: boolean; decided_at: string | null;
}

export interface Topic {
  id: string;
  subject: string;
  state: TopicState;
  due: boolean;
  reason: TopicReason | null;
  reasonText: string;
  nextCheck: string | null;
  snoozedUntil: string | null;
  note: string | null;
  closedAt: string | null;
  projectId: number | null;
  lastActivity: string | null;
  from: string;
  latestId: string;
  lastMail?: { direction: "in" | "out"; from: string; sent_at: string | null; summary: string | null } | null;
  messageCount: number;
  newMessages: TopicMail[];
  suggestionIds: string[];
}

export type TopicView = "entscheiden" | "laufend" | "wiedervorlage" | "erledigt";

/** YYYY-MM-DD in n Tagen (Ortszeit des Geraets) */
export function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}

export const SNOOZE_PRESETS: { label: string; days: number }[] = [
  { label: "Morgen", days: 1 }, { label: "3 Tage", days: 3 }, { label: "1 Woche", days: 7 }, { label: "2 Wochen", days: 14 }, { label: "1 Monat", days: 30 },
];
