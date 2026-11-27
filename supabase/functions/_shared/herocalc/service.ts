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

async function heroGql(apiKey: string, query: string, variables: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${HERO_BASE}/api/external/v9/graphql`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`HERO GraphQL HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(`HERO GraphQL: ${j.errors.map((e: any) => e.message).join("; ").slice(0, 300)}`);
  return j.data;
}

const PRODUCT_Q = `query($s:String){supply_product_versions(search:$s, first:15){product_id nr base_price base_data{name unit_type quantity_min quantity_interval price_quantity}}}`;

/** Artikelsuche im Artikelstamm (Name oder Artikelnummer): liefert nr, name, EK, product_id. */
export async function lookupProducts(apiKey: string, search: unknown) {
  if (typeof search !== "string" || search.trim().length < 2) throw new Error("search fehlt (mind. 2 Zeichen)");
  const d = await heroGql(apiKey, PRODUCT_Q, { s: search.trim() });
  return (d.supply_product_versions ?? []).map((p: any) => ({ nr: p.nr, name: p.base_data?.name, unit_type: p.base_data?.unit_type, base_price: p.base_price, product_id: p.product_id }));
}

/** Genau einen Artikel per Artikelnummer auflösen (exakter Treffer), sonst Fehler. */
export async function resolveProduct(apiKey: string, nr: string) {
  const d = await heroGql(apiKey, PRODUCT_Q, { s: nr.trim() });
  const hits = (d.supply_product_versions ?? []).filter((p: any) => String(p.nr).toLowerCase() === nr.trim().toLowerCase());
  if (hits.length !== 1) throw new Error(`Artikel ${nr}: ${hits.length === 0 ? "nicht gefunden" : "nicht eindeutig"} (mit lookup_product suchen)`);
  const p = hits[0];
  const b = p.base_data ?? {};
  return {
    id: String(p.product_id), nr: String(p.nr), name: String(b.name ?? ""), unit_type: b.unit_type ? String(b.unit_type) : undefined,
    base_price: Number(p.base_price), quantity_min: b.quantity_min, quantity_interval: b.quantity_interval, price_quantity: b.price_quantity,
  };
}

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

const sumKey = (d: any) => JSON.stringify(summarize(d));

/**
 * Speichern UND prüfen: HERO legt manchmal einen neuen Entwurfs-Datensatz an (draft.id ändert sich, live 23398603 -> 23426788).
 * Ein Speichern mit der alten id wird dann stillschweigend ignoriert (HTTP 200, Stand bleibt). Deshalb nach dem Speichern
 * neu lesen; weicht der Stand ab, einmal mit der aktuellen id wiederholen. Sonst Fehler.
 */
export async function saveVerified(apiKey: string, draft: any, docId: number): Promise<void> {
  const want = sumKey(draft);
  await saveDraft(apiKey, draft);
  let back = await loadDraft(apiKey, docId);
  assertWritableDraft(back);
  if (sumKey(back) === want) return;
  await saveDraft(apiKey, { ...draft, id: back.id });
  back = await loadDraft(apiKey, docId);
  assertWritableDraft(back);
  if (sumKey(back) !== want) throw new Error("HERO hat das Speichern nicht übernommen (Stand nach dem Speichern weicht ab)");
}

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

export async function backup(supabase: any, docId: number, draft: any, command: string, caller: string): Promise<number> {
  const { data, error } = await supabase.from("hero_calc_undo").insert({
    document_id: docId, draft_id: draft.id, draft_json: draft, draft_hash: await draftHash(draft), command, caller,
  }).select("id").single();
  if (error || !data) throw new Error("Undo-Sicherung fehlgeschlagen – nicht geschrieben");
  return Number(data.id);
}

export async function getOverview(ctx: Ctx, docId: number, includeDraft: boolean) {
  const draft = await loadDraft(ctx.apiKey, docId);
  assertWritableDraft(draft);
  const data: Record<string, unknown> = { ...overview(draft), hash: await draftHash(draft) };
  if (includeDraft) data.draft = draft;
  return data;
}

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
    try {
      await saveVerified(ctx.apiKey, next, docId);
    } catch (e) {
      // Entwurf nicht ladbar oder Stand weicht ab: sofort auf den Stand davor zurück.
      let reset = "Zurücksetzen fehlgeschlagen – bitte Entwurf prüfen (undo_id " + undo_id + ")";
      try {
        await saveDraft(ctx.apiKey, fresh);
        const cur = await loadDraft(ctx.apiKey, docId).catch(() => null);
        if (cur && sumKey(cur) !== sumKey(fresh)) await saveDraft(ctx.apiKey, { ...fresh, id: cur.id });
        reset = "automatisch auf den Stand davor zurückgesetzt";
      } catch { /* Meldung oben */ }
      throw new Error(`Schreiben nicht übernommen (${e instanceof Error ? e.message : "?"}) – ${reset}`);
    }
    return { dry_run: false, wrote: true, undo_id, before, after };
  });
}

export async function runUndo(ctx: Ctx, docId: number, undoId: number | undefined, dryRun: boolean) {
  let q = ctx.supabase.from("hero_calc_undo").select("id, created_at, command, draft_json").eq("document_id", docId);
  q = undoId !== undefined ? q.eq("id", undoId) : q.neq("command", "undo");
  const { data: rows, error: qErr } = await q.order("id", { ascending: false }).limit(1);
  if (qErr) throw new Error("Undo-Sicherung konnte nicht gelesen werden");
  const row = rows?.[0];
  if (!row) throw new Error("Keine Undo-Sicherung für dieses Dokument gefunden");
  const stored = row.draft_json;
  assertWritableDraft(stored);
  if (Number(stored.customer_document_id) !== docId) throw new Error("Undo-Sicherung gehört zu einem anderen Dokument");

  // Der aktuelle Entwurf darf kaputt (nicht ladbar) sein: genau dann soll Undo trotzdem funktionieren.
  let current: any = null;
  try {
    current = await loadDraft(ctx.apiKey, docId);
    assertWritableDraft(current);
  } catch {
    current = null;
  }
  // Mit der AKTUELLEN Entwurfs-id zurückschreiben (HERO ignoriert Speichern auf eine ältere id).
  const restore = current ? { ...stored, id: current.id } : stored;
  const preview = {
    undo_id: Number(row.id), backup_created_at: row.created_at, backup_command: row.command,
    before: current ? summarize(current) : "aktueller Entwurf nicht ladbar", after: summarize(restore),
  };
  if (dryRun) return { dry_run: true, wrote: false, ...preview };

  return await withLock(ctx.supabase, docId, async () => {
    let newUndoId: number | null = null;
    if (current) {
      const fresh = await loadDraft(ctx.apiKey, docId);
      assertWritableDraft(fresh);
      await assertUnchanged(current, fresh);
      newUndoId = await backup(ctx.supabase, docId, fresh, "undo", ctx.caller);
    }
    await saveVerified(ctx.apiKey, restore, docId);
    return { dry_run: false, wrote: true, ...preview, new_undo_id: newUndoId };
  });
}
