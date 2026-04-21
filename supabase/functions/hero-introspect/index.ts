// Targeted introspection: we now know the real type names. Ask HERO for
// the fields of CustomerInput (the thing create_contact expects).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const HERO_API_URL = "https://login.hero-software.de/api/external/v7/graphql";

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: rows } = await supabase
      .from("app_config")
      .select("key, value")
      .eq("key", "hero_api_key")
      .maybeSingle();

    const apiKey = rows?.value;
    if (!apiKey) {
      return new Response("No HERO API key in app_config", { status: 400, headers: corsHeaders });
    }

    // Deep introspection: get full field list with type names, and ALSO the
    // fields of any nested INPUT_OBJECT types that appear (e.g. AddressInput
    // we already know, but also country, phone, etc.)
    const typeQuery = (typeName: string) => `
      query {
        __type(name: "${typeName}") {
          name
          kind
          inputFields {
            name
            description
            type {
              name
              kind
              ofType {
                name
                kind
                ofType { name kind }
              }
            }
          }
        }
      }
    `;

    // Start with CustomerInput and any enum/input types it refers to
    const types = [
      "CustomerInput",
      "CustomerCategoryEnum",
      "CustomerSalutationEnum",
      "PersonInput",          // maybe contact = person?
      "ContactPhoneInput",
      "CustomerAddressInput",
      "PhoneInput",
      "EmailInput",
    ];

    const results: Record<string, string> = {};
    for (const t of types) {
      const r = await fetch(HERO_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query: typeQuery(t) }),
      });
      const text = await r.text();
      results[t] = text.slice(0, 8000);
    }

    let out = "=== HERO CustomerInput INTROSPECTION ===\n\n";
    for (const [t, v] of Object.entries(results)) {
      out += `--- TYPE ${t} ---\n${v}\n\n`;
    }

    return new Response(out, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });

  } catch (e: any) {
    return new Response("Error: " + (e.message || String(e)), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  }
})
