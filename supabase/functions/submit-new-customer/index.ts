import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Escape HTML so form input can't break the mail markup
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const data = await req.json()
    console.log("Anfrage erhalten für:", data.lastName)

    // Bot protection
    if (data.honeypot && String(data.honeypot).trim() !== "") {
      console.warn("Honeypot ausgelöst - als Bot behandelt");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }
    if (data.formLoadedAt && Date.now() - Number(data.formLoadedAt) < 3000) {
      console.warn("Formular zu schnell abgesendet - als Bot behandelt");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    let heroStatus = "Nicht versucht";
    let heroOk = false;

    // 1. HERO API Call
    // Get the API key from app_config (same place the admin panel writes it,
    // same place the existing hero-integration function reads from).
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        // Endpoint URL and schema according to
        // https://hero-software.de/api-doku/graphql-guide
        const HERO_API_URL = "https://login.hero-software.de/api/external/v7/graphql";

        // Build address object only if at least one address field is filled
        const address = (data.street || data.postalCode || data.city) ? {
          street: data.street || null,
          zipcode: data.postalCode || null,
          city: data.city || null,
        } : null;

        const mutation = `
          mutation CreateContact(
            $first_name: String,
            $last_name: String!,
            $company_name: String,
            $email: String,
            $phone_home: String,
            $phone_mobile: String,
            $address: AddressInput,
            $category: CustomerCategoryEnum
          ) {
            create_contact(
              first_name: $first_name,
              last_name: $last_name,
              company_name: $company_name,
              email: $email,
              phone_home: $phone_home,
              phone_mobile: $phone_mobile,
              address: $address,
              category: $category
            ) { id }
          }
        `;
        const variables: any = {
          first_name: data.firstName || null,
          last_name: data.lastName,
          company_name: data.companyName || null,
          email: data.email || null,
          phone_home: data.phone || null,
          phone_mobile: data.mobile || null,
          address,
          category: "customer",
        };

        const heroResponse = await fetch(HERO_API_URL, {
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

        const heroText = await heroResponse.text();
        console.log("HERO HTTP Status:", heroResponse.status);
        console.log("HERO Response (ersten 2000 Zeichen):", heroText.slice(0, 2000));

        if (!heroResponse.ok) {
          heroStatus = `HTTP ${heroResponse.status}: ${heroText.slice(0, 500)}`;
        } else {
          let heroResult: any;
          try { heroResult = JSON.parse(heroText); }
          catch { heroStatus = "Ungültige HERO-Antwort"; heroResult = null; }

          if (heroResult) {
            if (heroResult.errors?.length) {
              heroStatus = "HERO-Fehler: " + JSON.stringify(heroResult.errors);
            } else if (heroResult.data?.create_contact?.id) {
              heroOk = true;
              heroStatus = `Erfolgreich angelegt (ID: ${heroResult.data.create_contact.id})`;
            } else {
              heroStatus = "HERO-Antwort enthält keine ID: " + JSON.stringify(heroResult).slice(0, 500);
            }
          }
        }
      }
    } catch (heroErr: any) {
      heroStatus = "HERO-Ausnahme: " + (heroErr.message || String(heroErr));
      console.log(heroStatus);
    }

    // 2. E-Mail Versand mit ALLEN Formulardaten
    console.log("Sende E-Mail via Resend...");
    const resendKey = Deno.env.get('RESEND_API_KEY')

    // Build address block
    const addressLines: string[] = [];
    if (data.street) addressLines.push(esc(data.street));
    if (data.postalCode || data.city) {
      addressLines.push(esc([data.postalCode, data.city].filter(Boolean).join(" ")));
    }

    const fullName = [data.salutation, data.firstName, data.lastName]
      .filter(Boolean).map((s: string) => esc(s)).join(" ").trim();

    // Row helper – only show if value exists
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
      console.warn("RESEND_API_KEY nicht gesetzt, Mail wird nicht versendet");
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
