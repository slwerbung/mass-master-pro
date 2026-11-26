// hero-calc-contract: nächtlicher Vertragstest (und Selbsttest) für hero-calc.
// Aufruf: pg_cron mit Header x-poll-secret (= app_config.hero_calc_poll_secret), Body { mode: "contract" | "selftest" }.
// Läuft NUR gegen die Test-Entwürfe in WER-1984 (hart verdrahtet in _shared/herocalc/contract.ts), nur Entwürfe,
// stellt jeden Entwurf danach wieder her. Ergebnis immer HTTP 200 { ok, data: { mode, steps } } und in hero_calc_contract_log.
// Schlägt der Vertragstest fehl, hat HERO den internen Endpoint (Edit-Seite / ajax_save) geändert: dann Alarm
// (Push an Admin-Geräte der Mail-App + Mail an info@slwerbung.de, höchstens einmal je 24 h, siehe _shared/herocalc/alert.ts).
import { createClient } from "@supabase/supabase-js";
import { allOk, runContract, runSelftest } from "../_shared/herocalc/contract.ts";
import { alertOnFailure } from "../_shared/herocalc/alert.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-poll-secret",
};
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const secret = req.headers.get("x-poll-secret");
    const { data: s } = await supabase.from("app_config").select("value").eq("key", "hero_calc_poll_secret").maybeSingle();
    const expected = typeof s?.value === "string" ? s.value : "";
    if (!secret || !expected || !timingSafeEqual(secret, expected)) return reply({ ok: false, error: "Unauthorized" });

    const body = await req.json().catch(() => ({}));
    const mode = body.mode ?? "contract";
    if (mode !== "contract" && mode !== "selftest") return reply({ ok: false, error: `Unbekannter mode ${mode}` });

    const { data: k } = await supabase.from("app_config").select("value").eq("key", "hero_api_key").maybeSingle();
    if (!k?.value) return reply({ ok: false, error: "Kein HERO API Key konfiguriert" });
    const ctx = { supabase, apiKey: String(k.value), caller: `cron:hero-calc-contract` };

    const steps = mode === "contract" ? await runContract(ctx) : await runSelftest(ctx);
    const ok = allOk(steps);
    // Protokoll (ohne Key); ein Fehler beim Protokollieren darf das Ergebnis nicht verdecken
    const { data: logRow } = await supabase.from("hero_calc_contract_log").insert({ mode, ok, detail: { steps } }).select("id").single()
      .then((r: any) => r, () => ({ data: null }));
    // Alarm nur für den Nachttest (nicht für manuelle Selbsttests), höchstens einmal je 24 h
    const alert = mode === "contract"
      ? await alertOnFailure(supabase, logRow?.id ?? null, mode, steps, { resendKey: Deno.env.get("RESEND_API_KEY") })
      : null;
    return reply({ ok, data: { mode, steps, alert } });
  } catch (e) {
    return reply({ ok: false, error: e instanceof Error ? e.message : "Unbekannter Fehler" });
  }
});
