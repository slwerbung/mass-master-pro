// hero-calc: Detailkalkulation eines HERO-Dokument-ENTWURFS ändern (interner Endpoint der HERO-Oberfläche).
// POST { action, document_id, dry_run?, ... } -> immer HTTP 200 { ok: true, data } | { ok: false, error }
// Regeln: nur Entwürfe, dry_run ist Standard, vor jedem Schreiben Undo-Sicherung, nie Key in Logs/Antworten.
// Auth: adminToken UND employeeToken sind gewollt (jeder signierte Admin-/Mitarbeiter-Token).
// Schreiben: Sperre je Dokument (30 s) + Hash-/modified-Prüfung gegen parallele Änderungen.
// Actions: get (include_draft?), set_wage_minutes, set_material, set_quantity, set_discount, add_position,
//          remove_position, undo (undo_id?).
import { createClient } from "@supabase/supabase-js";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";
import { applyCommand, type Command } from "../_shared/herocalc/ops.ts";
import { assertUnchanged, assertWritableDraft, draftHash } from "../_shared/herocalc/guard.ts";
import { overview } from "../_shared/herocalc/overview.ts";
import { summarize } from "../_shared/herocalc/calc.ts";
import { parseDraftFromEditHtml } from "../_shared/herocalc/parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const HERO_BASE = "https://login.hero-software.de";

const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Draft lesen: GET der Edit-Seite, JSON unter `DocumentStore.draft` (live belegt, Spec 5.1).
 * WICHTIG: ohne `X-Requested-With`, sonst kommt nur eine leere Hülle zurück.
 */
async function loadDraft(apiKey: string, documentId: number): Promise<any> {
  const resp = await fetch(`${HERO_BASE}/partner/Documents/edit/${documentId}`, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  if (!resp.ok) throw new Error(`HERO Edit-Seite antwortete mit HTTP ${resp.status}`);
  return parseDraftFromEditHtml(await resp.text(), documentId);
}

async function saveDraft(apiKey: string, draft: any): Promise<any> {
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

/** Sperre je Dokument: zweiter gleichzeitiger Schreibaufruf bricht ab. */
async function withLock<T>(supabase: any, docId: number, fn: () => Promise<T>): Promise<T> {
  const { data, error } = await supabase.rpc("hero_calc_acquire_lock", { p_document_id: docId, p_seconds: 30 });
  if (error) throw new Error("Sperre konnte nicht geprüft werden – nicht geschrieben");
  if (data !== true) throw new Error("Entwurf wird gerade bearbeitet – abgebrochen");
  try {
    return await fn();
  } finally {
    await supabase.rpc("hero_calc_release_lock", { p_document_id: docId });
  }
}

/** Undo-Sicherung des aktuellen Stands (mit Hash). Schlägt sie fehl, wird nicht geschrieben. */
async function backup(supabase: any, docId: number, draft: any, command: string, caller: string) {
  const { error } = await supabase.from("hero_calc_undo").insert({
    document_id: docId, draft_id: draft.id, draft_json: draft, draft_hash: await draftHash(draft), command, caller,
  });
  if (error) throw new Error("Undo-Sicherung fehlgeschlagen – nicht geschrieben");
}

const WRITE_CMDS = new Set(["set_wage_minutes", "set_material", "set_discount", "set_quantity", "add_position", "remove_position"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { action, sessionToken, adminToken, employeeToken, document_id, ...params } = body;

    const token = adminToken || employeeToken || sessionToken;
    if (!token || typeof token !== "string") return reply({ ok: false, error: "Unauthorized" });
    const payload = await verifySessionToken(token, getSessionSecret());
    if (!payload || (payload.role !== "admin" && payload.role !== "employee")) {
      return reply({ ok: false, error: "Unauthorized" });
    }
    const caller = `${payload.role}:${String(payload.userId ?? "?")}`;

    const docId = Number(document_id);
    if (!Number.isInteger(docId) || docId <= 0) return reply({ ok: false, error: "document_id fehlt oder ungültig" });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await supabase.from("app_config").select("value").eq("key", "hero_api_key").maybeSingle();
    const apiKey = row?.value as string | undefined;
    if (!apiKey) return reply({ ok: false, error: "Kein HERO API Key konfiguriert" });

    if (action === "get") {
      const draft = await loadDraft(apiKey, docId);
      assertWritableDraft(draft);
      const data: Record<string, unknown> = { ...overview(draft), hash: await draftHash(draft) };
      if (params.include_draft === true) data.draft = draft;
      return reply({ ok: true, data });
    }

    if (action === "undo") {
      // Standard: letzte Sicherung, die selbst kein Undo war (wiederholtes Undo ist damit idempotent).
      let q = supabase.from("hero_calc_undo").select("id, created_at, command, draft_json").eq("document_id", docId);
      q = params.undo_id !== undefined ? q.eq("id", Number(params.undo_id)) : q.neq("command", "undo");
      const { data: rows, error: qErr } = await q.order("id", { ascending: false }).limit(1);
      if (qErr) throw new Error("Undo-Sicherung konnte nicht gelesen werden");
      const row = rows?.[0];
      if (!row) throw new Error("Keine Undo-Sicherung für dieses Dokument gefunden");
      const restore = row.draft_json;
      assertWritableDraft(restore);
      if (Number(restore.customer_document_id) !== docId) throw new Error("Undo-Sicherung gehört zu einem anderen Dokument");

      const current = await loadDraft(apiKey, docId);
      assertWritableDraft(current);
      const preview = { undo_id: row.id, backup_created_at: row.created_at, backup_command: row.command, before: summarize(current), after: summarize(restore) };
      if (params.dry_run !== false) return reply({ ok: true, data: { dry_run: true, wrote: false, ...preview } });

      return await withLock(supabase, docId, async () => {
        const fresh = await loadDraft(apiKey, docId);
        assertWritableDraft(fresh);
        await assertUnchanged(current, fresh);
        await backup(supabase, docId, fresh, "undo", caller);
        await saveDraft(apiKey, restore);
        return reply({ ok: true, data: { dry_run: false, wrote: true, ...preview } });
      });
    }

    if (!WRITE_CMDS.has(action)) return reply({ ok: false, error: `Unbekannte action ${action}` });

    const dryRun = params.dry_run !== false; // nur ausdrückliches false schreibt
    const command = { cmd: action, ...params } as Command;

    const read = await loadDraft(apiKey, docId);
    assertWritableDraft(read);
    const { draft: next, before, after } = applyCommand(read, command);
    if (dryRun) return reply({ ok: true, data: { dry_run: true, wrote: false, before, after } });

    // Schreiben: Sperre, frisch lesen, Konfliktprüfung (modified + Hash), Undo sichern, speichern.
    return await withLock(supabase, docId, async () => {
      const fresh = await loadDraft(apiKey, docId);
      assertWritableDraft(fresh);
      await assertUnchanged(read, fresh);
      await backup(supabase, docId, fresh, action, caller);
      await saveDraft(apiKey, next);
      return reply({ ok: true, data: { dry_run: false, wrote: true, before, after } });
    });
  } catch (e) {
    // Nie den Key loggen/zurückgeben: nur die Meldung.
    return reply({ ok: false, error: e instanceof Error ? e.message : "Unbekannter Fehler" });
  }
});
