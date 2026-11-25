// hero-calc: Detailkalkulation eines HERO-Dokument-ENTWURFS ändern (interner Endpoint der HERO-Oberfläche).
// POST { action, document_id, dry_run?, ... } -> immer HTTP 200 { ok: true, data } | { ok: false, error }
// Regeln: nur Entwürfe, dry_run ist Standard, vor jedem Schreiben Undo-Sicherung, nie Key in Logs/Antworten.
import { createClient } from "@supabase/supabase-js";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";
import { applyCommand, type Command } from "../_shared/herocalc/ops.ts";
import { assertUnchanged, assertWritableDraft } from "../_shared/herocalc/guard.ts";
import { summarize } from "../_shared/herocalc/calc.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const HERO_BASE = "https://login.hero-software.de";

const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Draft ohne Browser lesen – OFFEN (Spec 5.1). Kandidaten: HTML der Edit-Seite
 * (/partner/Documents/edit/<id>), /Api/graphql. Bis das live gegen WER-1984 geklärt ist,
 * gibt es bewusst KEINEN Lesepfad; ohne Lesen sind weder get noch Schreiben möglich
 * (Konfliktprüfung braucht den aktuellen Stand).
 */
async function loadDraft(_apiKey: string, _documentId: number): Promise<any> {
  throw new Error("Draft lesen ist noch nicht implementiert (Spec 5.1 offen)");
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

const WRITE_CMDS = new Set(["set_wage_minutes", "set_material", "add_position", "remove_position"]);

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
      return reply({ ok: true, data: { document_id: docId, draft_id: draft.id, summary: summarize(draft), draft } });
    }

    if (!WRITE_CMDS.has(action)) return reply({ ok: false, error: `Unbekannte action ${action}` });

    const dryRun = params.dry_run !== false; // nur ausdrückliches false schreibt
    const command = { cmd: action, ...params } as Command;

    const read = await loadDraft(apiKey, docId);
    assertWritableDraft(read);
    const { draft: next, before, after } = applyCommand(read, command);
    if (dryRun) return reply({ ok: true, data: { dry_run: true, wrote: false, before, after } });

    // Schreiben: frisch lesen, Konfliktprüfung, Undo sichern, speichern.
    const fresh = await loadDraft(apiKey, docId);
    assertWritableDraft(fresh);
    assertUnchanged(read, fresh);
    const { error: undoErr } = await supabase.from("hero_calc_undo").insert({
      document_id: docId, draft_id: fresh.id, draft_json: fresh, command: action, caller,
    });
    if (undoErr) throw new Error("Undo-Sicherung fehlgeschlagen – nicht geschrieben");
    await saveDraft(apiKey, next);
    return reply({ ok: true, data: { dry_run: false, wrote: true, before, after } });
  } catch (e) {
    // Nie den Key loggen/zurückgeben: nur die Meldung.
    return reply({ ok: false, error: e instanceof Error ? e.message : "Unbekannter Fehler" });
  }
});
