// Gemeinsame Pruefungen fuer Standort-Kommentare mit Markierung/Antwort (Spec C), genutzt von customer-data (Kunde)
// und location-feedback (Mitarbeiter). Format: _shared/markup.ts.
import { validateMarkup, validateMediaRef, type Markup, type MediaRef } from "./markup.ts";

export type FeedbackExtras = { parent_id: string | null; markup: Markup | null; media_ref: MediaRef | null };

/** Gehoert die Datei (storagePath) zu diesem Standort? PDFs aus location_pdfs, Bilder aus location_images. */
export async function mediaBelongsToLocation(sb: any, locationId: string, ref: MediaRef): Promise<boolean> {
  const table = ref.kind === "pdf" ? "location_pdfs" : "location_images";
  const { data } = await sb.from(table).select("id").eq("location_id", locationId).eq("storage_path", ref.storagePath).limit(1);
  return !!data?.length;
}

/**
 * Antwort (parentId) oder Markierung (markup + mediaRef) pruefen. Antwort: Eltern-Kommentar existiert, ist selbst
 * Top-Level und haengt am selben Standort – Markierung wird dann ignoriert. Liefert die Spalten oder einen Fehlertext.
 */
export async function prepareFeedbackExtras(
  sb: any,
  locationId: string,
  input: { parentId?: unknown; markup?: unknown; mediaRef?: unknown },
): Promise<{ ok: true; extras: FeedbackExtras } | { ok: false; error: string }> {
  const parentId = input.parentId ? String(input.parentId) : null;
  if (parentId) {
    const { data: parent } = await sb.from("location_feedback").select("id, location_id, parent_id").eq("id", parentId).maybeSingle();
    if (!parent || parent.location_id !== locationId) return { ok: false, error: "Kommentar, auf den geantwortet wird, nicht gefunden." };
    if (parent.parent_id) return { ok: false, error: "Auf eine Antwort kann nicht geantwortet werden." };
    return { ok: true, extras: { parent_id: parentId, markup: null, media_ref: null } };
  }
  if (input.markup == null) return { ok: true, extras: { parent_id: null, markup: null, media_ref: null } };
  const m = validateMarkup(input.markup);
  if (!m.ok) return m;
  const r = validateMediaRef(input.mediaRef);
  if (!r.ok) return r;
  if (!(await mediaBelongsToLocation(sb, locationId, r.ref))) return { ok: false, error: "Die markierte Datei gehört nicht zu diesem Standort." };
  return { ok: true, extras: { parent_id: null, markup: m.markup, media_ref: r.ref } };
}

/** Liegt der Standort in diesem Projekt? */
export async function locationInProject(sb: any, locationId: string, projectId: string): Promise<boolean> {
  const { data } = await sb.from("locations").select("id").eq("id", locationId).eq("project_id", projectId).maybeSingle();
  return !!data;
}
