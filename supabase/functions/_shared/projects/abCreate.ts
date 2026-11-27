// „AB erstellen“ direkt in der App (Projekte-Ansicht): Positionen des neuesten abgeschlossenen Angebots werden in HERO als
// ENTWURF einer Auftragsbestaetigung kopiert – derselbe Weg wie in der Mail-App (`confirmation.ts`, `createConfirmationDocument`).
// Versendet wird hier NIE etwas: Pruefen, Abschliessen und Versenden bleibt ein bewusster Schritt in HERO bzw. der Mail-App.
// Schattenmodus: nichts geht nach HERO, die Aktion landet nur in project_actions_log.

import { createConfirmationDocument, mergePositions, type ActionHero } from "../email/action.ts";
import { itemsFromDraft, positionsFromDoc, type ConfirmationPosition, type SourceDoc } from "../email/confirmation.ts";
import type { HeroDocument } from "../email/hero.ts";

export interface AbHero extends Pick<ActionHero, "createDocument"> {
  /** Angebote bzw. ABs dieses Projekts (mit Positionen), neueste zuerst. */
  offers(heroId: number): Promise<HeroDocument[]>;
  confirmations(heroId: number): Promise<HeroDocument[]>;
  addLogbook(heroId: number, text: string): Promise<void>;
}
export interface AbDeps {
  sb: any; hero: AbHero; confirmationTypeId: number | null; shadow: boolean; user: string; now?: Date;
}
export class AbError extends Error {}

export interface AbPreview {
  offer: { id: number; nr: string; date: string | null } | null;
  positions: ConfirmationPosition[];
  existing: { nr: string; status: string }[];
  configured: boolean;
}

/** Abgeschlossene Angebote (PDF da, nicht geloescht) mit Positionen, neueste zuerst. */
function usableOffers(docs: HeroDocument[]): SourceDoc[] {
  return docs.filter((d) => d.statusCode >= 100 && d.statusCode !== 1000)
    .map((d): SourceDoc => ({ id: d.id, nr: d.nr, date: d.date, kind: "angebot", projectId: d.projectId!, projectNr: d.projectNr, items: itemsFromDraft(d.draft) }))
    .filter((d) => d.items.length);
}

/** Nur lesen: Angebot und Positionen, die in die AB kaemen, plus schon vorhandene ABs. */
export async function prepareAb(d: AbDeps, heroId: number): Promise<AbPreview> {
  const [offers, abs] = await Promise.all([d.hero.offers(heroId), d.hero.confirmations(heroId).catch(() => [])]);
  const src = usableOffers(offers)[0] ?? null;
  return {
    offer: src ? { id: src.id, nr: src.nr, date: src.date } : null,
    positions: src ? positionsFromDoc(src) : [],
    existing: abs.filter((a) => a.statusCode !== 1000).map((a) => ({ nr: a.nr, status: a.statusName })),
    configured: !!d.confirmationTypeId,
  };
}

export interface AbResult {
  ok: true; shadow: boolean; message: string; documentId: number | null; documentNr: string | null; positions: number; warnings?: string[]; [k: string]: unknown;
}

/**
 * AB-Entwurf anlegen. Das Angebot wird serverseitig NEU gelesen (nie Namen oder Preise aus dem Client); vom Client kommen nur
 * Auswahl und Mengen (`edited`). Gelingt es, ist die Karte erledigt; der Entwurf muss in HERO noch geprueft und versendet werden.
 */
export async function createAb(d: AbDeps, heroId: number, edited: unknown): Promise<AbResult> {
  const now = d.now ?? new Date();
  const typeId = d.confirmationTypeId;
  if (!typeId) throw new AbError("Der Dokumenttyp „Auftragsbestätigung“ ist nicht eingerichtet (Mail-Einstellungen → Firma & HERO).");
  const src = usableOffers(await d.hero.offers(heroId))[0];
  if (!src) throw new AbError("In HERO gibt es kein abgeschlossenes Angebot mit Positionen – bitte die AB in HERO anlegen.");
  const positions = mergePositions(positionsFromDoc(src), edited);
  const chosen = positions.filter((p) => p.include && p.quantity > 0);
  if (!chosen.length) throw new AbError("Keine Position ausgewählt.");

  const log = (extra: Record<string, unknown>, shadow: boolean) => d.sb.from("project_actions_log").insert({
    user: d.user, action: "create_ab", hero_id: heroId, payload: { offer: src.nr, positions: chosen.length, ...extra }, shadow, hero_response: null, error: null,
  });
  if (d.shadow) {
    await log({}, true);
    return { ok: true, shadow: true, message: `Schattenmodus: Es wäre eine AB mit ${chosen.length} Position(en) aus ${src.nr} als Entwurf angelegt worden.`, documentId: null, documentNr: null, positions: chosen.length };
  }

  const warnings: string[] = [];
  const doc = await createConfirmationDocument(d.hero, heroId, typeId, positions, [{ id: src.id, nr: src.nr, kind: "angebot" }], warnings);
  if (!doc.id) throw new AbError(warnings.at(-1) ?? "Die AB konnte in HERO nicht angelegt werden.");

  const lines = chosen.map((p) => `- ${p.quantity} ${p.unit} ${p.name}`).join("\n");
  await d.hero.addLogbook(heroId, `📋 Auftragsbestätigung${doc.nr ? ` ${doc.nr}` : ""} als Entwurf aus ${src.nr} angelegt (Projekte-Ansicht, ${d.user}) – bitte in HERO prüfen, abschließen und versenden.\n${lines}`.slice(0, 2000))
    .catch((e) => warnings.push(`Logbuch-Eintrag fehlgeschlagen: ${(e as Error).message}`));
  await d.sb.from("project_cards").update({ state: "done", closed_at: now.toISOString(), close_reason: "AB-Entwurf in der App angelegt", locked_until: null, locked_by: null })
    .eq("hero_id", heroId).in("state", ["open", "in_hero"]);
  await log({ documentId: doc.id, documentNr: doc.nr }, false);
  return { ok: true, shadow: false, message: `AB${doc.nr ? ` ${doc.nr}` : ""} als Entwurf angelegt. Bitte in HERO prüfen, abschließen und versenden.`, documentId: doc.id, documentNr: doc.nr, positions: chosen.length, ...(warnings.length ? { warnings } : {}) };
}
