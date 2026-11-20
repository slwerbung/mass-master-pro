// Reine Logik von „Zu entscheiden“ (ohne React): Reihenfolge und Abbruch von „Ausführen“, Etikett, Kurztexte, Felder je Vorschlag.
import type { Suggestion } from "./suggestions";
import type { Category, TopicReason } from "./shared";
import type { PCategory } from "./projects";

/** Reihenfolge der Entscheidungen in einem Thema: erst das Projekt, dann was daran hängt. */
export const ORDER = ["create_project", "link_project", "create_confirmation", "upload_attachments", "prepare_offer", "change_step", "log_entry", "send_document"];
export const rank = (t: string) => (ORDER.includes(t) ? ORDER.indexOf(t) : ORDER.length);
/** Die beiden Varianten der Projektwahl: Neu anlegen oder bestehendes zuordnen. */
export const ALTERNATIVES = ["create_project", "link_project"];

// ------------------------------------------------------------------ Etikett im Stapel
const CAT_LABEL: Partial<Record<Category, { text: string; style: PCategory }>> = {
  anfrage_neu: { text: "Anfrage", style: "kunde" },
  projekt_kommunikation: { text: "Projekt", style: "auftrag" },
  layout_freigabe: { text: "Freigabe", style: "auftrag" },
  auftrag: { text: "Auftrag", style: "auftrag" },
  reklamation: { text: "Reklamation", style: "kunde" },
  lieferant: { text: "Lieferant", style: "pflege" },
  beleg: { text: "Beleg", style: "pflege" },
  ausschreibung: { text: "Ausschreibung", style: "pflege" },
  verwaltung: { text: "Verwaltung", style: "pflege" },
};
const REASON_LABEL: Partial<Record<TopicReason, { text: string; style: PCategory }>> = {
  nachfassen: { text: "Nachfassen", style: "termine" },
  unbeantwortet: { text: "Unbeantwortet", style: "kunde" },
  wiedervorlage: { text: "Wiedervorlage", style: "termine" },
};

/** Etikett aus der Kategorie der neuesten Mail (kurz); bei Nachfassen/Unbeantwortet/Wiedervorlage stattdessen der Grund. */
export function stackLabel(category: Category | null | undefined, reason: TopicReason | null | undefined): { text: string; style: PCategory } {
  if (reason && REASON_LABEL[reason]) return REASON_LABEL[reason]!;
  return (category && CAT_LABEL[category]) || { text: "Thema", style: "pflege" };
}

/** Uhrzeit im Stapel: heute „07:12“, sonst „19.11.“ (Berliner Zeit). */
export function shortWhen(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => x.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  return day(d) === day(now)
    ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })
    : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
}

// ------------------------------------------------------------------ Felder je Vorschlag (gehobener Zustand)
/* Der Inhalt eines Vorschlags ist je Art ein freies JSON – wie bisher in den Karten ausgelesen. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Edits = Record<string, any>;
export interface Gewerk { short: string; name: string; measure_id: number | null }
export interface EditCtx { gewerke: Gewerk[]; /** gewählte Variante in der Projektwahl (Kopf der Karte) */ projectId?: number | null }

/** Startwerte der Felder einer Vorschlagszeile (so wie die heutige Karte sie vorbelegt). */
export function initialEdits(s: Suggestion): Edits {
  const p = s.payload ?? {};
  switch (s.type) {
    case "link_project": return { text: p.text ?? "" };
    case "log_entry": return { text: p.text ?? "" };
    case "change_step": return { stepId: p.toStepId };
    case "upload_attachments": return { items: p.items ?? [] };
    case "prepare_offer": return { kind: p.kind, positions: p.positions ?? [] };
    case "create_project": return { contact: { ...(p.contact ?? {}) }, name: p.project?.name ?? "", notes: p.project?.notes ?? "", gw: p.project?.gewerk?.short ?? "", useExisting: !!p.existingCustomer };
    case "create_confirmation": return { positions: p.positions ?? [], name: p.project?.name ?? "", contact: { ...(p.contact ?? {}) }, toStepId: p.toStepId ?? "", useExisting: !!p.existingCustomer };
    default: return {};
  }
}

/** Die Felder, die beim Annehmen an `email-action` `decide` gehen (Form wie in den bisherigen Karten). */
export function acceptEdits(s: Suggestion, e: Edits, ctx: EditCtx): Edits | undefined {
  const p = s.payload ?? {};
  switch (s.type) {
    case "link_project": return { projectId: ctx.projectId ?? p.projectId ?? null, text: e.text };
    case "log_entry": return { text: e.text };
    case "change_step": return { toStepId: e.stepId };
    case "upload_attachments": return { items: e.items };
    case "prepare_offer": return { kind: e.kind, positions: e.positions };
    case "create_project": {
      const fromExisting = !!p.existingCustomer && !!e.useExisting;
      return { contact: e.contact, useExisting: fromExisting, project: { name: e.name, notes: e.notes, gewerk: ctx.gewerke.find((g) => g.short === e.gw) ?? null } };
    }
    case "create_confirmation": {
      const newProject = !p.projectId;
      const fromExisting = newProject && !!p.existingCustomer && !!e.useExisting;
      return { positions: e.positions, toStepId: e.toStepId || null, ...(newProject ? { project: { ...p.project, name: e.name }, contact: e.contact, useExisting: fromExisting } : {}) };
    }
    default: return undefined;
  }
}

/** Kann die Zeile angenommen werden? (Link braucht ein Projekt, Hochladen mindestens einen Anhang.) */
export function canAccept(s: Suggestion, e: Edits, ctx: EditCtx): boolean {
  if (s.type === "link_project") return !!(ctx.projectId ?? s.payload?.projectId);
  if (s.type === "upload_attachments") return (e.items ?? []).some((i: { selected: boolean }) => i.selected);
  return true;
}

const nrOf = (p: any) => p?.projectNr ?? (p?.projectId ? `#${p.projectId}` : "?");

/** Kurztext der Vorschlagszeile. */
export function shortText(s: Suggestion, e: Edits, ctx: { linkNr?: string | null; documentNr?: string | null } = {}): string {
  const p = s.payload ?? {};
  switch (s.type) {
    case "change_step": {
      const alts = (p.alternatives ?? []) as { stepId: number; label: string }[];
      const label = e.stepId === p.toStepId || e.stepId == null ? p.toLabel : alts.find((a) => a.stepId === e.stepId)?.label ?? p.toLabel;
      return `Status → ${label ?? "?"}`;
    }
    case "log_entry": return "Logbuch-Eintrag";
    case "upload_attachments": {
      const sel = ((e.items ?? p.items ?? []) as { filename: string; selected: boolean }[]).filter((i) => i.selected);
      if (sel.length === 1) return `${sel[0].filename} hochladen`;
      return `${sel.length} ${sel.length === 1 ? "Anhang" : "Anhänge"} hochladen`;
    }
    case "prepare_offer": return (e.kind ?? p.kind) === "vor_ort" ? "Vor-Ort-Termin statt Angebot" : "Angebotsentwurf anlegen";
    case "create_confirmation": return "AB-Entwurf anlegen";
    case "create_project": return "Kontakt + Projekt anlegen";
    case "link_project": return `Zu ${ctx.linkNr ?? nrOf(p)} zuordnen + Logbuch`;
    case "send_document": return `${p.kind === "offer" ? "Angebot" : "AB"} ${ctx.documentNr ?? p.documentNr ?? `#${p.documentId}`} prüfen & senden`;
    default: return s.type;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const BELEG_TEXT = "An Lexware senden";
export const SKIP_REASONS = ["Schon erledigt", "Brauchen wir nicht", "Mache ich selbst in HERO"];
export const DEFAULT_REASON = "Nicht nötig";

// ------------------------------------------------------------------ „Ausführen“
export interface RunRow {
  key: string;
  /** Vorschlagsart oder „beleg“ */
  type: string;
  /** angehakt = annehmen, Haken weg = verwerfen */
  checked: boolean;
  /** bereits erledigt/verworfen (wird übersprungen) */
  done?: boolean;
}
export type RunStatus = "accepted" | "rejected";
export interface RunOutcome { status: Record<string, RunStatus>; failed: { key: string; error: string } | null }

/** Zeilen in der Reihenfolge von ORDER (Beleg zuletzt, `send_document` nie), ohne bereits erledigte. */
export function runOrder<T extends RunRow>(rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !r.done && r.type !== "send_document")
    .sort((a, b) => rank(a.r.type) - rank(b.r.type) || a.i - b.i)
    .map(({ r }) => r);
}

/**
 * Arbeitet die Zeilen nacheinander ab: angehakt → accept, Haken weg → reject (ein abgewählter Beleg bleibt unberührt).
 * Beim ersten Fehler anhalten; Erledigtes bleibt erledigt und steht in `status`.
 */
export async function runRows<T extends RunRow>(rows: T[], exec: (row: T, mode: "accept" | "reject") => Promise<void>): Promise<RunOutcome> {
  const status: Record<string, RunStatus> = {};
  for (const row of runOrder(rows)) {
    if (!row.checked && row.type === "beleg") continue;
    const mode = row.checked ? "accept" : "reject";
    try { await exec(row, mode); } catch (e) { return { status, failed: { key: row.key, error: e instanceof Error ? e.message : String(e) } }; }
    status[row.key] = mode === "accept" ? "accepted" : "rejected";
  }
  return { status, failed: null };
}

/** Anzahl der Zeilen, die „Ausführen (n)“ annimmt. */
export const acceptCount = (rows: RunRow[]) => runOrder(rows).filter((r) => r.checked).length;
