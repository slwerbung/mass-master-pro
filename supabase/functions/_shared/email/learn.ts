// Lernen aus Korrekturen: aendert ein Mensch die Kategorie eines Absenders ZWEIMAL gleich,
// entsteht automatisch eine Absenderregel (email_rules, source = gelernt).
//
// Absichtlich vorsichtig: nur die genaue Adresse (nie die ganze Domain), nie fuer Adressen mit
// einer von Hand angelegten Regel, und nur, wenn die LETZTEN beiden Korrekturen dieses Absenders
// zur selben Kategorie fuehrten (eine dazwischenliegende andere Korrektur setzt den Zaehler zurueck).

import { CATEGORIES, type Category } from "./types.ts";

export interface CategoryFeedback { new_value: string | null; created_at: string }

export function learnedCategory(feedbackNewestFirst: CategoryFeedback[]): Category | null {
  const [a, b] = feedbackNewestFirst;
  if (!a || !b || !a.new_value || a.new_value !== b.new_value) return null;
  return (CATEGORIES as readonly string[]).includes(a.new_value) ? (a.new_value as Category) : null;
}

export interface LearnStore {
  recentCategoryFeedback(fromAddr: string, n: number): Promise<CategoryFeedback[]>;
  existingRule(pattern: string): Promise<{ source: string; category: string } | null>;
  saveRule(pattern: string, category: Category): Promise<void>;
}

/** Nach einer Kategorie-Korrektur aufrufen. Gibt die neu gelernte Regel zurueck (oder null). */
export async function learnRule(fromAddr: string, store: LearnStore): Promise<{ pattern: string; category: Category } | null> {
  const pattern = String(fromAddr || "").trim().toLowerCase();
  if (!pattern || !pattern.includes("@")) return null;
  const category = learnedCategory(await store.recentCategoryFeedback(pattern, 2));
  if (!category) return null;
  const existing = await store.existingRule(pattern);
  // Von Hand angelegte (oder Seed-)Regeln gehen vor; eine gleiche gelernte Regel ist schon da.
  if (existing && (existing.source !== "gelernt" || existing.category === category)) return null;
  await store.saveRule(pattern, category);
  return { pattern, category };
}
