// Introspection: read back an EXISTING contact that is manually set as
// "Firma" in HERO. The URL takes ?id=<hero_id> and returns all available
// fields for that contact.
//
// Goal: find out HOW HERO marks a contact as company vs. person internally.
// We need either an ID of a known-Firma contact, or the Kirchen contact
// (ID 6901949) which was created as person but we'll check the raw shape.

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
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: rows } = await supabase.from("app_config").select("key, value").eq("key", "hero_api_key").maybeSingle();
    const apiKey = rows?.value;
    if (!apiKey) return new Response("No HERO API key", { status: 400, headers: corsHeaders });

    // Step 1: Introspect the Customer OBJECT type (not Input) - that's what
    // a read query returns. This gives us ALL fields the contact object has,
    // including any that distinguish firma/person.
    const typeIntrospect = (name: string) => `
      query {
        __type(name: "${name}") {
          name
          kind
          fields {
            name
            type { name kind ofType { name kind } }
          }
        }
      }
    `;

    let out = "=== HERO CONTACT TYPE INTROSPECTION ===\n\n";

    for (const typeName of ["Customer", "Contact", "Partner", "Person"]) {
      const r = await fetch(HERO_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ query: typeIntrospect(typeName) }),
      });
      const text = await r.text();
      out += `--- TYPE ${typeName} ---\n${text.slice(0, 5000)}\n\n`;
    }

    // Step 2: Find query fields that read a contact
    const queryFields = `
      query {
        __schema {
          queryType {
            fields {
              name
              args { name type { name kind ofType { name kind } } }
              type { name kind ofType { name kind ofType { name kind } } }
            }
          }
        }
      }
    `;
    const qfRes = await fetch(HERO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ query: queryFields }),
    });
    const qfText = await qfRes.text();

    try {
      const qfData = JSON.parse(qfText);
      const fields = qfData?.data?.__schema?.queryType?.fields || [];
      const relevantFields = fields.filter((f: any) =>
        /customer|contact|partner/i.test(f.name)
      );
      out += "--- RELEVANT QUERY FIELDS ---\n";
      out += JSON.stringify(relevantFields.map((f: any) => ({
        name: f.name,
        args: f.args?.map((a: any) => ({ name: a.name, type: a.type?.name || a.type?.ofType?.name })),
        returns: f.type?.name || f.type?.ofType?.name || f.type?.ofType?.ofType?.name,
      })), null, 2) + "\n\n";
    } catch (e: any) {
      out += `(Query fields parse error: ${e.message})\n\n`;
    }

    // Step 3: If ?id=<num> was passed, also try reading that specific contact
    // via the most promising query candidates
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      out += `\n=== READ-BACK of contact ID ${id} ===\n\n`;

      const idInt = parseInt(id, 10);
      const candidates = ["customer", "contact", "customers", "contacts"];
      for (const qname of candidates) {
        // Try with single-arg (id: Int)
        const readQ = `
          query ReadOne($id: Int!) {
            ${qname}(id: $id) {
              id
              type
              category
              first_name
              last_name
              company_name
              company_legal_form
              title
              email
              is_contact_person
              full_name
            }
          }
        `;
        const rr = await fetch(HERO_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ query: readQ, variables: { id: idInt } }),
        });
        const rrText = await rr.text();
        out += `--- ${qname}(id: ${idInt}) ---\n${rrText.slice(0, 2000)}\n\n`;
      }
    } else {
      out += "\n(Hinweis: ruf diese Function mit ?id=<hero_id> auf, um einen spezifischen Kontakt zu lesen)\n";
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
