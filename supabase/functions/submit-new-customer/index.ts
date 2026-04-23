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

const HERO_API_URL = "https://login.hero-software.de/api/external/v7/graphql";

// Build the HERO contact payload. If stripEmail is true we omit the email
// entirely - used as a retry when HERO rejects the address as malformed.
function buildHeroContact(data: any, stripEmail: boolean) {
  const address = (data.street || data.postalCode || data.city) ? {
    street: data.street || null,
    zipcode: data.postalCode || null,
    city: data.city || null,
  } : null;

  const hasCompany = !!data.companyName?.trim();

  return {
    is_contact_person: !hasCompany,
    first_name: data.firstName || null,
    last_name: data.lastName,
    company_name: data.companyName || null,
    company_legal_form: data.legalForm || null,
    title: data.salutation || null,
    email: stripEmail ? null : (data.email || null),
    phone_home: data.phone || null,
    phone_mobile: data.mobile || null,
    category: "customer",
    source: "Neukunden-Formular Website",
    address,
  };
}

async function sendHeroMutation(apiKey: string, contact: any): Promise<{ ok: boolean; heroId?: string; error?: string; httpStatus?: number }> {
  const mutation = `
    mutation CreateContact($contact: CustomerInput, $findExisting: Boolean) {
      create_contact(contact: $contact, findExisting: $findExisting) { id }
    }
  `;
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
      body: JSON.stringify({ query: mutation, variables: { contact, findExisting: true } }),
    });
    clearTimeout(timeoutId);

    const text = await resp.text();
    console.log("HERO HTTP:", resp.status);
    console.log("HERO Response:", text.slice(0, 1500));

    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}`, httpStatus: resp.status };
    const result = JSON.parse(text);
    if (result.errors?.length) return { ok: false, error: result.errors.map((e: any) => e.message).join("; "), httpStatus: resp.status };
    const id = result?.data?.create_contact?.id;
    if (!id) return { ok: false, error: "Keine ID in Antwort: " + JSON.stringify(result.data).slice(0, 300) };
    return { ok: true, heroId: String(id), httpStatus: resp.status };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Heuristic: did HERO reject this because the email is malformed?
// Messages we've seen: "email.email: \"Die Emailadresse ist ungültig\""
function isEmailValidationError(error: string | undefined): boolean {
  if (!error) return false;
  const s = error.toLowerCase();
  return s.includes("email") && (
    s.includes("ungültig") ||
    s.includes("ungueltig") ||
    s.includes("invalid") ||
    s.includes("not valid")
  );
}

async function createHeroContact(apiKey: string, data: any): Promise<{ ok: boolean; heroId?: string; error?: string; emailDropped?: boolean }> {
  // First attempt with email
  const firstContact = buildHeroContact(data, false);
  console.log("HERO-Payload (with email):", JSON.stringify(firstContact, null, 2));
  const first = await sendHeroMutation(apiKey, firstContact);
  if (first.ok) return { ok: true, heroId: first.heroId };

  // If the failure is specifically about the email being invalid, retry
  // without the email field. Contact still gets created, we surface the
  // bad email in the notification so it can be fixed manually.
  if (isEmailValidationError(first.error)) {
    console.log("Retry ohne E-Mail, da HERO die Adresse nicht akzeptiert hat...");
    const retryContact = buildHeroContact(data, true);
    const second = await sendHeroMutation(apiKey, retryContact);
    if (second.ok) return { ok: true, heroId: second.heroId, emailDropped: true };
    return { ok: false, error: "Beide Versuche gescheitert. Erster Fehler: " + first.error + " | Retry ohne Mail auch: " + second.error };
  }

  return { ok: false, error: first.error };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const data = await req.json()
    console.log("Anfrage erhalten für:", data.lastName)

    // Bot protection
    if (data.honeypot && String(data.honeypot).trim() !== "") {
      console.warn("Honeypot ausgelöst");
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }
    if (data.formLoadedAt && Date.now() - Number(data.formLoadedAt) < 3000) {
      console.warn("Zu schnell abgesendet");
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    let heroStatus = "Nicht versucht";
    let heroOk = false;
    let emailWasDropped = false;

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
          emailWasDropped = !!result.emailDropped;
          heroStatus = result.emailDropped
            ? `Erfolgreich angelegt ohne E-Mail (HERO-ID: ${result.heroId})`
            : `Erfolgreich angelegt (HERO-ID: ${result.heroId})`;
        } else {
          heroStatus = "HERO-Fehler: " + result.error;
        }
      }
    } catch (heroErr: any) {
      heroStatus = "HERO-Ausnahme: " + (heroErr.message || String(heroErr));
      console.log(heroStatus);
    }

    // Mail-Versand
    console.log("=== MAIL-VERSAND START ===");
    const resendKey = Deno.env.get('RESEND_API_KEY')

    if (!resendKey) {
      console.error("!!! RESEND_API_KEY FEHLT !!!");
    } else {
      const addressLines: string[] = [];
      if (data.street) addressLines.push(esc(data.street));
      if (data.postalCode || data.city) {
        addressLines.push(esc([data.postalCode, data.city].filter(Boolean).join(" ")));
      }
      const fullName = [data.salutation, data.firstName, data.lastName]
        .filter(Boolean).map((s: string) => esc(s)).join(" ").trim();

      const row = (label: string, value: unknown, isLink?: "mail" | "tel", highlight?: boolean) => {
        if (!value || String(value).trim() === "") return "";
        const v = String(value).trim();
        let cell = esc(v);
        if (isLink === "mail" && !highlight) cell = `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
        if (isLink === "tel")  cell = `<a href="tel:${esc(v)}">${esc(v)}</a>`;
        if (highlight) cell = `<span style="background:#fff3cd;color:#856404;padding:2px 6px;border-radius:3px;font-weight:500">${esc(v)} ⚠️ ungültig</span>`;
        return `<tr>
          <td style="padding:6px 16px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(label)}</td>
          <td style="padding:6px 0;vertical-align:top">${cell}</td>
        </tr>`;
      };

      let heroBadge: string;
      if (heroOk && emailWasDropped) {
        heroBadge = `<p style="margin:0 0 20px;padding:10px 14px;background:#fff3cd;color:#856404;border-radius:6px;font-size:14px"><strong>⚠️ In HERO angelegt, aber ohne E-Mail.</strong><br><span style="font-size:13px">HERO hat die eingegebene E-Mail-Adresse als ungültig abgelehnt. Der Kontakt wurde trotzdem angelegt - die E-Mail muss manuell nachgepflegt werden (siehe unten).</span><br><span style="font-size:12px;color:#666;margin-top:4px;display:inline-block">${esc(heroStatus.replace(/^Erfolgreich angelegt /, ""))}</span></p>`;
      } else if (heroOk) {
        heroBadge = `<p style="margin:0 0 20px;padding:10px 14px;background:#e8f5e9;color:#2e7d32;border-radius:6px;font-size:14px"><strong>✓ In HERO angelegt.</strong> ${esc(heroStatus.replace(/^Erfolgreich angelegt /, ""))}</p>`;
      } else {
        heroBadge = `<p style="margin:0 0 20px;padding:10px 14px;background:#ffebee;color:#c62828;border-radius:6px;font-size:14px"><strong>✗ HERO-Anlage fehlgeschlagen.</strong><br><span style="font-size:12px">${esc(heroStatus)}</span><br><span style="font-size:12px;color:#666">Bitte manuell in HERO anlegen.</span></p>`;
      }

      const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:620px;margin:0 auto;padding:20px">
  <h2 style="margin:0 0 16px;color:#111">Neukunden-Anfrage</h2>
  ${heroBadge}
  <table style="border-collapse:collapse;font-size:14px;width:100%">
    ${row("Firma", data.companyName)}
    ${row("Firmierung", data.legalForm)}
    ${fullName ? row("Ansprechpartner", fullName) : row("Nachname", data.lastName)}
    ${row("E-Mail", data.email, "mail", emailWasDropped)}
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

      let subject: string;
      if (heroOk && emailWasDropped) {
        subject = `Neukunde: ${data.companyName || data.lastName} ⚠️ E-Mail ungültig`;
      } else if (heroOk) {
        subject = `Neukunde: ${data.companyName || data.lastName} ✓`;
      } else {
        subject = `Neukunde: ${data.companyName || data.lastName} (HERO-Fehler)`;
      }

      const mailPayload: any = {
        from: 'onboarding@resend.dev',
        to: 'info@slwerbung.de',
        subject,
        html,
      };
      // Only set reply_to if the email looks valid (otherwise Resend itself rejects)
      if (data.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) {
        mailPayload.reply_to = data.email;
      }

      try {
        const mailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendKey}`,
          },
          body: JSON.stringify(mailPayload),
        });
        const mailText = await mailRes.text();
        console.log("Resend HTTP:", mailRes.status);
        console.log("Resend Response:", mailText);
        if (!mailRes.ok) console.error("!!! RESEND FEHLER !!! HTTP " + mailRes.status + ": " + mailText);
        else console.log("=== MAIL ERFOLGREICH VERSENDET ===");
      } catch (mailErr: any) {
        console.error("!!! RESEND AUSNAHME !!!", mailErr.message || mailErr);
      }
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
