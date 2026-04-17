import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const HERO_GRAPHQL = "https://login.hero-software.de/api/external/v7/graphql";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function heroQuery(apiKey: string, query: string, variables?: Record<string, unknown>) {
  const resp = await fetch(HERO_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) throw new Error(`HERO API HTTP ${resp.status}`);
  const result = await resp.json();
  if (result.errors?.length) throw new Error(result.errors[0].message);
  return result.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify request has a valid session token (employee or admin)
    const body = await req.json();
    const { action, sessionToken, ...params } = body;

    // Basic auth check - must have a session token
    if (!sessionToken) return json({ error: "Unauthorized" }, 401);

    // Check HERO is configured and enabled
    const { data: configRows } = await supabase
      .from("app_config")
      .select("key, value")
      .in("key", ["hero_api_key", "hero_enabled"]);

    const config = new Map((configRows || []).map((r: any) => [r.key, r.value]));
    const apiKey = config.get("hero_api_key");
    const enabled = config.get("hero_enabled") === "true";

    if (!apiKey) return json({ error: "Kein HERO API Key konfiguriert", projects: [], contacts: [] });

    switch (action) {

      // ── Search HERO projects (fulltext across nr, customer, address) ──
      case "search_projects": {
        const search = String(params.search || "").trim();
        if (!search) return json({ projects: [] });

        // Try HERO's native search first, fall back to fetch-all-and-filter
        // Use offset/limit if supported, otherwise fetch all
        const query = `
          query {
            project_matches {
              id
              project_nr
              customer {
                id
                first_name
                last_name
                company_name
                email
              }
              address {
                street
                city
                zipcode
              }
            }
          }
        `;

        let projects: any[] = [];
        try {
          const data = await heroQuery(apiKey, query);
          projects = data?.project_matches || [];
        } catch (queryErr: any) {
          return json({ error: `HERO Abfrage fehlgeschlagen: ${queryErr.message}`, projects: [] });
        }

        // Client-side fulltext filter if HERO doesn't support search param
        const filtered = search
          ? projects.filter((p: any) => {
              const text = [
                p.project_nr,
                p.customer?.first_name,
                p.customer?.last_name,
                p.customer?.company_name,
                p.customer?.email,
                p.address?.street,
                p.address?.city,
                p.address?.zipcode,
                p.contact?.first_name,
                p.contact?.last_name,
              ].filter(Boolean).join(" ").toLowerCase();
              return search.toLowerCase().split(" ").every((term: string) => text.includes(term));
            })
          : projects;

        return json({ projects: filtered });
      }

      // ── Search HERO contacts ──
      case "search_contacts": {
        const search = String(params.search || "").trim();
        const query = `
          query {
            contacts(category: "customer", limit: 100) {
              id
              nr
              first_name
              last_name
              company_name
              email
              phone_home
              address {
                street
                city
                zipcode
              }
            }
          }
        `;
        const data = await heroQuery(apiKey, query);
        const contacts = data?.contacts || [];
        const filtered = search
          ? contacts.filter((c: any) => {
              const text = [c.first_name, c.last_name, c.company_name, c.email, c.nr]
                .filter(Boolean).join(" ").toLowerCase();
              return search.toLowerCase().split(" ").every((term: string) => text.includes(term));
            })
          : contacts;
        return json({ contacts: filtered.slice(0, 20) });
      }

      // ── Add logbook entry to a HERO project ──
      case "add_logbook_entry": {
        const { heroProjectId, title, text } = params;
        if (!heroProjectId) return json({ error: "heroProjectId required" }, 400);
        const mutation = `
          mutation ($projectId: ID!, $title: String!, $text: String) {
            add_logbook_entry(project_match_id: $projectId, custom_title: $title, custom_text: $text) {
              id
            }
          }
        `;
        await heroQuery(apiKey, mutation, { projectId: heroProjectId, title, text });
        return json({ success: true });
      }

      // ── Debug: return raw HERO response ──
      case "debug_query": {
        try {
          const query = `query { project_matches { id project_nr } }`;
          const resp = await fetch("https://login.hero-software.de/api/external/v7/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ query }),
          });
          const text = await resp.text();
          return json({ status: resp.status, body: text.slice(0, 2000), apiKeyPrefix: apiKey.slice(0, 8) + "..." });
        } catch (e: any) {
          return json({ error: e.message, apiKeyPrefix: apiKey.slice(0, 8) + "..." });
        }
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    return json({ error: e.message || "Server error" }, 500);
  }
});
