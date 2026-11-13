// Morgenuebersicht (Phase 5): Zahlen aus dem Projekte-Stapel fuer den 7-Uhr-Task und die Mail-App. Nur lesen.

import { canSee } from "./access.ts";
import { berlinDayStartIso } from "./followup.ts";

const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export interface ProjectDigest {
  cards: number;
  byCategory: { kunde: number; auftrag: number; termine: number; pflege: number };
  cleanup: number;
  followupsToday: number;
  /** die ersten Kunden-Karten (Nummer, Name, Satz „Warum jetzt“) */
  topCustomer: { nr: string; name: string; text: string }[];
  /** ein Satz fuer die Push-Meldung */
  text: string;
}

/** Karten und Wiedervorlagen, die der Benutzer sehen darf (Mitarbeiter: eigene bzw. nicht zugewiesene Projekte). */
export async function projectDigest(sb: any, user: { role: string; email: string | null }, now = new Date()): Promise<ProjectDigest> {
  const [cards, fus] = await Promise.all([
    sb.from("project_cards").select("hero_id, category, bundled, reasons, priority").eq("state", "open").order("priority", { ascending: true }),
    sb.from("followups").select("hero_id, due_at").eq("target_type", "project").is("done_at", null),
  ]);
  if (cards.error) throw new Error(cards.error.message);
  if (fus.error) throw new Error(fus.error.message);
  const ids = [...new Set([...(cards.data || []), ...(fus.data || [])].map((r: any) => Number(r.hero_id)))];
  const projects = new Map<number, any>();
  for (const part of chunk(ids, 100)) {
    const r = await sb.from("hero_projects").select("hero_id, project_nr, name, assignee_emails").in("hero_id", part);
    if (r.error) throw new Error(r.error.message);
    for (const p of r.data || []) projects.set(Number(p.hero_id), p);
  }
  const visible = (id: number) => { const p = projects.get(id); return !!p && canSee(user, p); };

  const byCategory = { kunde: 0, auftrag: 0, termine: 0, pflege: 0 };
  let cleanup = 0;
  const top: ProjectDigest["topCustomer"] = [];
  for (const c of cards.data || []) {
    if (!visible(Number(c.hero_id))) continue;
    if (c.bundled) { cleanup++; continue; }
    if (c.category in byCategory) byCategory[c.category as keyof typeof byCategory]++;
    if (c.category === "kunde" && top.length < 3) {
      const p = projects.get(Number(c.hero_id));
      top.push({ nr: p.project_nr, name: p.name, text: String(c.reasons?.text ?? "") });
    }
  }
  const endOfToday = Date.parse(berlinDayStartIso(now)) + 24 * 3_600_000;
  const followupsToday = (fus.data || []).filter((f: any) => visible(Number(f.hero_id)) && Date.parse(f.due_at) <= endOfToday).length;
  const total = byCategory.kunde + byCategory.auftrag + byCategory.termine + byCategory.pflege;

  const parts: string[] = [];
  if (total) parts.push(`${total} Projekt-Karte${total === 1 ? "" : "n"} (Kunde ${byCategory.kunde}, Auftrag ${byCategory.auftrag}, Termine ${byCategory.termine}, Pflege ${byCategory.pflege})`);
  if (followupsToday) parts.push(`${followupsToday} Wiedervorlage${followupsToday === 1 ? "" : "n"} heute`);
  if (cleanup) parts.push(`${cleanup} in der Aufräum-Karte`);
  return { cards: total, byCategory, cleanup, followupsToday, topCustomer: top, text: parts.length ? `Projekte: ${parts.join(", ")}.` : "Projekte: nichts offen." };
}
