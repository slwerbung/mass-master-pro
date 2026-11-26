// hero-calc: Detailkalkulation eines HERO-Dokument-ENTWURFS ändern (interner Endpoint der HERO-Oberfläche).
// POST { action, document_id, dry_run?, ... } -> immer HTTP 200 { ok: true, data } | { ok: false, error }
// Regeln: nur Entwürfe, dry_run ist Standard, vor jedem Schreiben Undo-Sicherung, nie Key in Logs/Antworten.
// Auth: adminToken/employeeToken/sessionToken (signiert) ODER teamKey (Tabelle hero_team_keys, nur Hash gespeichert).
// Schreiben: Sperre je Dokument (30 s) + Hash-/modified-Prüfung gegen parallele Änderungen (siehe _shared/herocalc/service.ts).
// Actions: get (include_draft?), set_wage_minutes, set_material, set_quantity, set_discount, add_position,
//          remove_position, recalc (alle Summen neu rechnen, z. B. nach create_document), undo (undo_id?).
import { createClient } from "@supabase/supabase-js";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";
import type { Command } from "../_shared/herocalc/ops.ts";
import { getOverview, runCommand, runUndo } from "../_shared/herocalc/service.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const WRITE_CMDS = new Set(["set_wage_minutes", "set_material", "set_discount", "set_quantity", "add_position", "remove_position", "recalc"]);

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { action, sessionToken, adminToken, employeeToken, teamKey, document_id, ...params } = body;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let caller: string;
    if (typeof teamKey === "string" && teamKey.length >= 20) {
      const hash = await sha256Hex(teamKey);
      const { data: k } = await supabase.from("hero_team_keys").select("id,name,active").eq("key_hash", hash).maybeSingle();
      if (!k || !k.active) return reply({ ok: false, error: "Unauthorized" });
      caller = `key:${k.id}`;
      await supabase.from("hero_team_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
    } else {
      const token = adminToken || employeeToken || sessionToken;
      if (!token || typeof token !== "string") return reply({ ok: false, error: "Unauthorized" });
      const payload = await verifySessionToken(token, getSessionSecret());
      if (!payload || (payload.role !== "admin" && payload.role !== "employee")) {
        return reply({ ok: false, error: "Unauthorized" });
      }
      caller = `${payload.role}:${String(payload.userId ?? "?")}`;
    }

    const docId = Number(document_id);
    if (!Number.isInteger(docId) || docId <= 0) return reply({ ok: false, error: "document_id fehlt oder ungültig" });

    const { data: row } = await supabase.from("app_config").select("value").eq("key", "hero_api_key").maybeSingle();
    const apiKey = row?.value as string | undefined;
    if (!apiKey) return reply({ ok: false, error: "Kein HERO API Key konfiguriert" });
    const ctx = { supabase, apiKey, caller };

    if (action === "get") return reply({ ok: true, data: await getOverview(ctx, docId, params.include_draft === true) });

    const dryRun = params.dry_run !== false; // nur ausdrücklich false schreibt

    if (action === "undo") {
      let undoId: number | undefined;
      if (params.undo_id !== undefined) {
        undoId = Number(params.undo_id);
        if (!Number.isInteger(undoId) || undoId <= 0) return reply({ ok: false, error: "undo_id ungültig" });
      }
      return reply({ ok: true, data: await runUndo(ctx, docId, undoId, dryRun) });
    }

    if (!WRITE_CMDS.has(action)) return reply({ ok: false, error: `Unbekannte action ${action}` });
    const { dry_run: _ignored, ...cmdParams } = params;
    return reply({ ok: true, data: await runCommand(ctx, docId, { cmd: action, ...cmdParams } as Command, dryRun) });
  } catch (e) {
    // Nie den Key loggen/zurückgeben: nur die Meldung.
    return reply({ ok: false, error: e instanceof Error ? e.message : "Unbekannter Fehler" });
  }
});
