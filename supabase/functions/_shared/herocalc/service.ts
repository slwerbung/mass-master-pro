// Gemeinsame Abläufe von hero-calc und hero-calc-contract: Lesen/Schreiben, Sperre, Undo. Keine Auth hier.
import { applyCommand, type Command } from "./ops.ts";
import { assertUnchanged, assertWritableDraft, draftHash } from "./guard.ts";
import { overview } from "./overview.ts";
import { summarize } from "./calc.ts";
import { parseEditPage } from "./parse.ts";

export const HERO_BASE = "https://login.hero-software.de";

export interface Ctx {
  supabase: any;
  apiKey: string;
  caller: string;
}

/**
 * Draft lesen: GET der Edit-Seite, JSON unter `DocumentStore.draft` (live belegt, Spec 5.1).
 * WICHTIG: ohne `X-Requested-With`, sonst kommt nur eine leere Hülle zurück.
 */
export async function loadPage(apiKey: string, documentId: number): Promise<{ draft: any; document: any }> {
  const resp = await fetch(`${HERO_BASE}/partner/Documents/edit/${documentId}`, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  if (!resp.ok) throw new Error(`HERO Edit-Seite antwortete mit HTTP ${resp.status}`);
  return parseEditPage(await resp.text(), documentId);
}

export async function loadDraft(apiKey: string, documentId: number): Promise<any> {
  return (await loadPage(apiKey, documentId)).draft;
}

export async function saveDraft(apiKey: string, draft: any): Promise<any> {
  const resp = await fetch(`${HERO_BASE}/partner/Documents/ajax_save/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({ draft, document: {} }),
  });
  if (!resp.ok) throw new Error(`HERO ajax_save antwortete mit HTTP ${resp.status}`);
  return await resp.json();
}

/** Sperre je Dokument (30 s): ein zweiter gleichzeitiger Schreibaufruf bricht ab. */
export async function withLock<T>(supabase: any, docId: number, fn: () => Promise<T>): Promise<T> {
  const { data, error } = await supabase.rpc("hero_calc_acquire_lock", { p_document_id: docId, p_seconds: 30 });
  if (error) throw new Error("Sperre konnte nicht geprüft werden – nicht geschrieben");
  if (data !== true) throw new Error("Entwurf wird gerade bearbeitet – abgebrochen");
  try {
    return await fn();
  } finally {
    await supabase.rpc("hero_calc_release_lock", { p_document_id: docId });
  }
}

/** Undo-Sicherung des aktuellen Stands (mit Hash). Schlägt sie fehl, wird nicht geschrieben. Gibt die undo_id zurück. */
export async function backup(supabase: any, docId: number, draft: any, command: string, caller: string): Promise<number> {
  const { data, error } = await supabase.from("hero_calc_undo").insert({
    document_id: docId, draft_id: draft.id, draft_json: draft, draft_hash: await draftHash(draft), command, caller,
  }).select("id").single();
  if (error || !data) throw new Error("Undo-Sicherung fehlgeschlagen – nicht geschrieben");
  return Number(data.id);
}

/** Übersicht (und mit includeDraft der volle Draft) – nur für Entwürfe. */
export async function getOverview(ctx: Ctx, docId: number, includeDraft: boolean) {
  const draft = await loadDraft(ctx.apiKey, docId);
  assertWritableDraft(draft);
  const data: Record<string, unknown> = { ...overview(draft), hash: await draftHash(draft) };
  if (includeDraft) data.draft = draft;
  return data;
}

/** Befehl ausführen. dryRun=true schreibt nichts. Schreiben: Sperre, frisch lesen, Konfliktprüfung, Undo, speichern. */
export async function runCommand(ctx: Ctx, docId: number, command: Command, dryRun: boolean) {
  const read = await loadDraft(ctx.apiKey, docId);
  assertWritableDraft(read);
  const { draft: next, before, after } = applyCommand(read, command);
  if (dryRun) return { dry_run: true, wrote: false, before, after };

  return await withLock(ctx.supabase, docId, async () => {
    const fresh = await loadDraft(ctx.apiKey, docId);
    assertWritableDraft(fresh);
    await assertUnchanged(read, fresh);
    const undo_id = await backup(ctx.supabase, docId, fresh, command.cmd, ctx.caller);
    await saveDraft(ctx.apiKey, next);
    return { dry_run: false, wrote: true, undo_id, before, after };
  });
}

/**
 * Letzte Sicherung zurückschreiben. Standard: letzte Sicherung, die selbst kein Undo war
 * (wiederholtes Undo ist damit idempotent); mit undoId eine bestimmte.
 */
export async function runUndo(ctx: Ctx, docId: number, undoId: number | undefined, dryRun: boolean) {
  let q = ctx.supabase.from("hero_calc_undo").select("id, created_at, command, draft_json").eq("document_id", docId);
  q = undoId !== undefined ? q.eq("id", undoId) : q.neq("command", "undo");
  const { data: rows, error: qErr } = await q.order("id", { ascending: false }).limit(1);
  if (qErr) throw new Error("Undo-Sicherung konnte nicht gelesen werden");
  const row = rows?.[0];
  if (!row) throw new Error("Keine Undo-Sicherung für dieses Dokument gefunden");
  const restore = row.draft_json;
  assertWritableDraft(restore);
  if (Number(restore.customer_document_id) !== docId) throw new Error("Undo-Sicherung gehört zu einem anderen Dokument");

  const current = await loadDraft(ctx.apiKey, docId);
  assertWritableDraft(current);
  const preview = {
    undo_id: Number(row.id), backup_created_at: row.created_at, backup_command: row.command,
    before: summarize(current), after: summarize(restore),
  };
  if (dryRun) return { dry_run: true, wrote: false, ...preview };

  return await withLock(ctx.supabase, docId, async () => {
    const fresh = await loadDraft(ctx.apiKey, docId);
    assertWritableDraft(fresh);
    await assertUnchanged(current, fresh);
    const newUndoId = await backup(ctx.supabase, docId, fresh, "undo", ctx.caller);
    await saveDraft(ctx.apiKey, restore);
    return { dry_run: false, wrote: true, ...preview, new_undo_id: newUndoId };
  });
}
