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

// HERO schema (introspected 2026-04-20):
//   create_contact(contact: CustomerInput, findExisting: Boolean) { id }
//
// We set type="company" when a company name is given so HERO stores
// it as a business contact, not as a private person. category stays
// "customer" (customer vs. supplier vs. interessent).
async function createHeroContact(apiKey: string, data: any): Promise<{ ok: boolean; heroId?: string; error?: string }> {
  const address = (data.street || data.postalCode || data.city) ? {
    street: data.street || null,
    zipcode: data.postalCode || null,
    city: data.city || null,
  } : null;

  const contactType = data.companyName?.trim() ? "company" : "person";

  const contact: any = {
    type: contactType,
    first_name: data.firstName || null,
    last_name: data.lastName,
    company_name: data.companyName || null,
    company_legal_form: data.legalForm || null,
    title: data.salutation || null,
    email: data.email || null,
    phone_home: data.phone || null,
    phone_mobile: data.mobile || null,
    category: "customer",
    source: "Neukunden-Formular Website",
    address,
  };

  console.log("HERO-Payload (contact):", JSON.stringify(contact, null, 2));

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

    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
    const result = JSON.parse(text);
    if (result.errors?.length) return { ok: false, error: result.errors.map((e: any) => e.message).join("; ") };
    const id = result?.data?.create_contact?.id;
    if (!id) return { ok: false, error: "Keine ID in Antwort: " + JSON.stringify(result.data).slice(0, 300) };
    return { ok: true, heroId: String(id) };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Read the contact back after create, so we can verify which fields HERO
// actually stored (e.g. whether company_legal_form was accepted). This
// is a diagnostic call - the result only goes to the log, not to the user.
async function verifyHeroContact(apiKey: string, heroId: string) {
  const query = `
    query ReadContact($id: Int!) {
      partner(id: $id) {
        id
        type
        category
        first_name
        last_name
        company_name
        company_legal_form
        title
        email
        phone_home
        phone_mobile
        source
      }
    }
  `;
  try {
    const resp = await fetch(HERO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, variables: { id: parseInt(heroId, 10) } }),
    });
    const text = await resp.text();
    console.log("=== HERO READ-BACK (was hat HERO gespeichert?) ===");
    console.log(text.slice(0, 2000));
    console.log("=== END READ-BACK ===");
  } catch (e: any) {
    console.log("Read-back fehlgeschlagen (ignoriert):", e.message || e);
  }
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
    let heroIdForReadback: string | undefined;
    let apiKeyForReadback: string | undefined;

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
          heroStatus = `Erfolgreich angelegt (HERO-ID: ${result.heroId})`;
          heroIdForReadback = result.heroId;
          apiKeyForReadback = apiKey;
        } else {
          heroStatus = "HERO-Fehler: " + result.error;
        }
      }
    } catch (heroErr: any) {
      heroStatus = "HERO-Ausnahme: " + (heroErr.message || String(heroErr));
      console.log(heroStatus);
    }

    // Diagnostic read-back - confirms what HERO actually stored
    if (heroIdForReadback && apiKeyForReadback) {
      await verifyHeroContact(apiKeyForReadback, heroIdForReadback);
    }

    // === Mail-Versand mit viel Logging ===
    console.log("=== MAIL-VERSAND START ===");
    const resendKey = Deno.env.get('RESEND_API_KEY')

    if (!resendKey) {
      console.error("!!! RESEND_API_KEY FEHLT - Keine Mail versendet !!!");
    } else {
      console.log("RESEND_API_KEY gefunden (Länge:", resendKey.length, ", beginnt mit:", resendKey.slice(0, 6) + "...)");

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

      const mailPayload: any = {
        from: 'onboarding@resend.dev',
        to: 'info@slwerbung.de',
        subject,
        html,
      };
      if (data.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        mailPayload.reply_to = data.email;
      }

      console.log("Mail-Payload: from='" + mailPayload.from + "' to='" + mailPayload.to + "' subject='" + subject + "'");

      try {
        console.log("Rufe Resend API auf...");
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

        if (!mailRes.ok) {
          console.error("!!! RESEND FEHLER !!! HTTP " + mailRes.status + ": " + mailText);
        } else {
          console.log("=== MAIL ERFOLGREICH VERSENDET ===");
        }
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
