import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface HeroAttempt {
  ok: boolean;
  heroId?: string;
  error?: string;
  attempt?: string;
}

// Try a single HERO mutation variant. Returns {ok, heroId} on success,
// {ok:false, error} on failure. The edge function calls this multiple
// times with different argument shapes until one works.
async function tryHeroMutation(
  apiKey: string,
  mutation: string,
  variables: Record<string, unknown>,
  attemptLabel: string,
): Promise<HeroAttempt> {
  const HERO_API_URL = "https://login.hero-software.de/api/external/v7/graphql";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(HERO_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });
    clearTimeout(timeoutId);

    const text = await resp.text();
    console.log(`[${attemptLabel}] HERO HTTP:`, resp.status);
    console.log(`[${attemptLabel}] HERO Response:`, text.slice(0, 1500));

    if (!resp.ok) {
      return { ok: false, attempt: attemptLabel, error: `HTTP ${resp.status}` };
    }
    const result = JSON.parse(text);

    if (result.errors?.length) {
      return {
        ok: false,
        attempt: attemptLabel,
        error: result.errors.map((e: any) => e.message).join("; "),
      };
    }
    // Look for the id in multiple possible shapes
    const id = result?.data?.create_contact?.id
      || result?.data?.create_contact?.contact?.id
      || result?.data?.create_contact?.data?.id;
    if (id) {
      return { ok: true, heroId: String(id), attempt: attemptLabel };
    }
    return {
      ok: false,
      attempt: attemptLabel,
      error: "Keine ID in Antwort: " + JSON.stringify(result.data).slice(0, 300),
    };
  } catch (e: any) {
    return { ok: false, attempt: attemptLabel, error: e.message || String(e) };
  }
}

// Build the attribute object that gets used inside the wrapper
function buildAttributes(data: any) {
  const address = (data.street || data.postalCode || data.city) ? {
    street: data.street || null,
    zipcode: data.postalCode || null,
    city: data.city || null,
  } : null;

  return {
    first_name: data.firstName || null,
    last_name: data.lastName,
    company_name: data.companyName || null,
    email: data.email || null,
    phone_home: data.phone || null,
    phone_mobile: data.mobile || null,
    address,
  };
}

async function createHeroContact(apiKey: string, data: any): Promise<HeroAttempt> {
  // HERO API responded with "Unknown argument first_name on create_contact of
  // type PartnerMutation" when using top-level named args. This means the
  // mutation expects the fields wrapped in a single input object. HERO's
  // public docs show top-level args, but the real schema clearly wants a
  // wrapper. We try the most likely wrapper names in order.

  const attrs = buildAttributes(data);

  // Attempt 1: `attributes` wrapper (Rails/GraphQL-Ruby convention, also
  // matches the shape SL Werbung had in their first iteration)
  const r1 = await tryHeroMutation(
    apiKey,
    `mutation CreateContact($attributes: ContactAttributes!) {
       create_contact(attributes: $attributes) { id }
     }`,
    { attributes: attrs },
    "attributes:ContactAttributes",
  );
  if (r1.ok) return r1;

  // Attempt 2: `input` wrapper (Relay convention)
  const r2 = await tryHeroMutation(
    apiKey,
    `mutation CreateContact($input: CreateContactInput!) {
       create_contact(input: $input) { id }
     }`,
    { input: attrs },
    "input:CreateContactInput",
  );
  if (r2.ok) return r2;

  // Attempt 3: `contact` wrapper with ContactInput type
  const r3 = await tryHeroMutation(
    apiKey,
    `mutation CreateContact($contact: ContactInput!) {
       create_contact(contact: $contact) { id }
     }`,
    { contact: attrs },
    "contact:ContactInput",
  );
  if (r3.ok) return r3;

  // All attempts failed - return the most informative error.
  // We include all three attempt labels and their errors so we know
  // exactly which field names are wrong next iteration.
  const combined = [
    `Versuch 1 (${r1.attempt}): ${r1.error}`,
    `Versuch 2 (${r2.attempt}): ${r2.error}`,
    `Versuch 3 (${r3.attempt}): ${r3.error}`,
  ].join(" | ");
  return { ok: false, error: combined };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const data = await req.json()
    console.log("Anfrage erhalten für:", data.lastName)

    // Bot protection
    if (data.honeypot && String(data.honeypot).trim() !== "") {
      console.warn("Honeypot ausgelöst");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }
    if (data.formLoadedAt && Date.now() - Number(data.formLoadedAt) < 3000) {
      console.warn("Zu schnell abgesendet");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    let heroStatus = "Nicht versucht";
    let heroOk = false;

    // HERO anbinden
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      const { data: configRows } = await supabase
        .from("app_config")
        .select("key, value")
        .in("key", ["hero_api_key", "hero_enabled"]);

      const config = new Map((configRows || []).map((r: any) => [r.key, r.value]));
      const apiKey = config.get("hero_api_key");
      const heroEnabled = config.get("hero_enabled") === "true" && !!apiKey;

      if (!heroEnabled || !apiKey) {
        heroStatus = "Übersprungen: HERO-Integration ist nicht aktiv oder kein API Key hinterlegt.";
      } else {
        console.log("Versuche HERO-Anbindung...");
        const result = await createHeroContact(apiKey, data);
        if (result.ok) {
          heroOk = true;
          heroStatus = `Erfolgreich angelegt (ID: ${result.heroId}, Variante: ${result.attempt})`;
        } else {
          heroStatus = "Alle HERO-Varianten fehlgeschlagen: " + result.error;
        }
      }
    } catch (heroErr: any) {
      heroStatus = "HERO-Ausnahme: " + (heroErr.message || String(heroErr));
      console.log(heroStatus);
    }

    // Mail senden
    console.log("Sende E-Mail via Resend...");
    const resendKey = Deno.env.get('RESEND_API_KEY')

    const addressLines: string[] = [];
    if (data.street) addressLines.push(esc(data.street));
    if (data.postalCode || data.city) {
      addressLines.push(esc([data.postalCode, data.city].filter(Boolean).join(" ")));
    }

    const fullName = [data.salutation, data.firstName, data.lastName]
      .filter(Boolean).map((s: string) => esc(s)).join(" ").trim();

    const row = (label: string, value: unknown, isLink?: "mail" | "tel") => {
      if (!value || String(value).trim() === "") return "";
      const v = String(value).trim();
      let cell = esc(v);
      if (isLink === "mail") cell = `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
      if (isLink === "tel")  cell = `<a href="tel:${esc(v)}">${esc(v)}</a>`;
      return `<tr>
        <td style="padding:6px 16px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(label)}</td>
        <td style="padding:6px 0;vertical-align:top">${cell}</td>
      </tr>`;
    };

    const heroBadge = heroOk
      ? `<p style="margin:0 0 20px;padding:10px 14px;background:#e8f5e9;color:#2e7d32;border-radius:6px;font-size:14px"><strong>✓ In HERO angelegt.</strong> ${esc(heroStatus.replace(/^Erfolgreich angelegt /, ""))}</p>`
      : `<p style="margin:0 0 20px;padding:10px 14px;background:#ffebee;color:#c62828;border-radius:6px;font-size:14px"><strong>✗ HERO-Anlage fehlgeschlagen.</strong><br><span style="font-size:12px">${esc(heroStatus)}</span><br><span style="font-size:12px;color:#666">Bitte manuell in HERO anlegen.</span></p>`;

    const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:620px;margin:0 auto;padding:20px">
  <h2 style="margin:0 0 16px;color:#111">Neukunden-Anfrage</h2>
  ${heroBadge}
  <table style="border-collapse:collapse;font-size:14px;width:100%">
    ${row("Firma", data.companyName)}
    ${row("Firmierung", data.legalForm)}
    ${fullName ? row("Ansprechpartner", fullName) : row("Nachname", data.lastName)}
    ${row("E-Mail", data.email, "mail")}
    ${row("Telefon", data.phone, "tel")}
    ${row("Mobil", data.mobile, "tel")}
    ${addressLines.length > 0 ? `<tr><td style="padding:6px 16px 6px 0;color:#666;vertical-align:top;white-space:nowrap">Adresse</td><td style="padding:6px 0;vertical-align:top">${addressLines.join("<br>")}</td></tr>` : ""}
  </table>
  <hr style="margin:28px 0 12px;border:none;border-top:1px solid #eee">
  <p style="font-size:12px;color:#888;margin:0">
    Eingegangen ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} ·
    aus dem Neukunden-Formular
  </p>
</body></html>`;

    const subject = heroOk
      ? `Neukunde: ${data.companyName || data.lastName} ✓`
      : `Neukunde: ${data.companyName || data.lastName} (HERO-Fehler)`;

    if (resendKey) {
      const mailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev',
          to: 'info@slwerbung.de',
          reply_to: data.email || undefined,
          subject,
          html,
        }),
      });
      if (!mailRes.ok) {
        console.error("Resend Fehler:", await mailRes.text());
      }
    } else {
      console.warn("RESEND_API_KEY nicht gesetzt");
    }

    console.log("Prozess abgeschlossen. HERO:", heroStatus);
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error("Kritischer Fehler:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
})
