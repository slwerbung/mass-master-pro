import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const data = await req.json()
    console.log("Anfrage erhalten für:", data.lastName)
    let heroStatus = "Nicht versucht";

    // 1. HERO API Call mit 4 Sekunden Timeout
    try {
      const HERO_API_URL = "https://api.hero-software.com/graphql"
      const HERO_TOKEN = Deno.env.get('HERO_API_TOKEN')

      if (!HERO_TOKEN) {
        heroStatus = "Übersprungen: Kein HERO_API_TOKEN gesetzt.";
      } else {
        console.log("Versuche HERO-Anbindung...");
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); 

        const heroResponse = await fetch(HERO_API_URL, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${HERO_TOKEN}`,
          },
          body: JSON.stringify({
            query: `mutation CreateContact($attributes: ContactAttributes!) { create_contact(attributes: $attributes) { id } }`,
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
        });
        clearTimeout(timeoutId);
        const heroResult = await heroResponse.json();
        heroStatus = heroResult.errors ? "HERO Fehler: " + JSON.stringify(heroResult.errors) : "Erfolgreich angelegt.";
      }
    } catch (heroErr) {
      heroStatus = "HERO-Timeout oder Fehler: " + heroErr.message;
      console.log(heroStatus);
    }

    // 2. E-Mail Versand
    console.log("Sende E-Mail via Resend...");
    const resendKey = Deno.env.get('RESEND_API_KEY')
    
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: 'info@slwerbung.de',
        subject: 'Neuer Kunde: ' + data.lastName,
        html: `<h2>Neuer Kunde</h2>
               <p><strong>Name:</strong> ${data.firstName} ${data.lastName}</p>
               <p><strong>E-Mail:</strong> ${data.email}</p>
               <p><strong>Status HERO:</strong> ${heroStatus}</p>`
      }),
    });

    console.log("Prozess abgeschlossen.");
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Kritischer Fehler:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
})