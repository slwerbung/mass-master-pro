import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const data = await req.json()

    // 1. HERO API Call (Struktur korrigiert für ContactAttributes)
    const HERO_API_URL = "https://api.hero-software.com/graphql"
    const HERO_TOKEN = Deno.env.get('HERO_API_TOKEN')

    const heroResponse = await fetch(HERO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HERO_TOKEN}`,
      },
      body: JSON.stringify({
        query: `
          mutation CreateContact($attributes: ContactAttributes!) {
            create_contact(attributes: $attributes) {
              id
            }
          }
        `,
        variables: {
          attributes: {
            first_name: data.firstName,
            last_name: data.lastName,
            company_name: data.company || "",
            email: data.email,
            phone_home: data.phone,
            address: data.address,
            category: "Interessent"
          }
        }
      }),
    })

    const heroResult = await heroResponse.json()
    console.log("HERO Response:", JSON.stringify(heroResult))

    // 2. E-Mail Versand via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const emailHtml = `
      <h2>Neuer Kunde über Formular</h2>
      <p><strong>Name:</strong> ${data.firstName} ${data.lastName}</p>
      <p><strong>Firma:</strong> ${data.company || '-'}</p>
      <p><strong>E-Mail:</strong> ${data.email}</p>
      <p><strong>Telefon:</strong> ${data.phone}</p>
      <p><strong>Adresse:</strong> ${data.address}</p>
      <hr />
      <p>Status HERO-Anlage: ${heroResult.errors ? 'Fehler (siehe Log)' : 'Erfolgreich'}</p>
    `

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev', // Funktioniert ohne DNS-Eintrag
        to: 'info@slwerbung.de',
        subject: 'Neuer Kunde: ' + data.lastName,
        html: emailHtml,
      }),
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})