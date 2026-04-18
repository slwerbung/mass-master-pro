import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HERO_GRAPHQL = "https://login.hero-software.de/api/external/v7/graphql";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function heroPost(apiKey: string, query: string, variables?: Record<string, unknown>) {
  const resp = await fetch(HERO_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const result = await resp.json();
  if (result.errors?.length) throw new Error(result.errors[0].message);
  return result.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, sessionToken, adminToken, employeeToken, ...params } = body;

    // Verify a real signed session token. Accept admin, employee, or the legacy
    // `sessionToken` field as a fallback (still must be signed).
    const candidateToken = adminToken || employeeToken || sessionToken;
    if (!candidateToken || typeof candidateToken !== "string") {
      return json({ error: "Unauthorized" }, 401);
    }
    const payload = await verifySessionToken(candidateToken, getSessionSecret());
    if (!payload || (payload.role !== "admin" && payload.role !== "employee")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load API key
    const { data: configRows } = await supabase
      .from("app_config").select("key, value")
      .in("key", ["hero_api_key", "hero_enabled"]);
    const config = new Map((configRows || []).map((r: any) => [r.key, r.value]));
    const apiKey = config.get("hero_api_key");
    if (!apiKey) return json({ error: "Kein HERO API Key konfiguriert", projects: [] });

    switch (action) {

      case "search_projects": {
        const search = String(params.search || "").trim();
        if (!search) return json({ projects: [] });

        const projectFields = `
          id project_nr name
          customer { id first_name last_name company_name email }
          address { city }
        `;

        // Fetch all pages via offset pagination
        let allProjects: any[] = [];
        for (let offset = 0; offset <= 1000; offset += 50) {
          try {
            // Use GraphQL variables for the pagination offset
            const data = await heroPost(
              apiKey,
              `query($offset: Int!) { project_matches(offset: $offset) { ${projectFields} } }`,
              { offset }
            );
            const batch = data?.project_matches || [];
            allProjects = allProjects.concat(batch);
            if (batch.length < 50) break;
          } catch { break; }
        }

        // Fulltext filter
        const terms = search.toLowerCase().split(" ").filter((t: string) => t.length > 1);
        const filtered = allProjects.filter((p: any) => {
          const haystack = [
            p.project_nr,
            p.name,
            p.customer?.first_name,
            p.customer?.last_name,
            p.customer?.company_name,
            p.customer?.email,
            p.address?.city,
          ].filter(Boolean).join(" ").toLowerCase();
          return terms.every((term: string) => haystack.includes(term));
        });

        return json({ projects: filtered.slice(0, 50), total: allProjects.length });
      }

      case "add_logbook_entry": {
        const { heroProjectId, title, text } = params;
        const projectIdNum = Number(heroProjectId);
        if (!Number.isFinite(projectIdNum)) return json({ error: "heroProjectId required" }, 400);
        // Use GraphQL variables to prevent injection via title/text
        const mutation = `
          mutation($projectId: Int!, $title: String!, $text: String) {
            add_logbook_entry(project_match_id: $projectId, custom_title: $title, custom_text: $text) { id }
          }
        `;
        await heroPost(apiKey, mutation, {
          projectId: projectIdNum,
          title: String(title || "").slice(0, 500),
          text: text ? String(text).slice(0, 5000) : null,
        });
        return json({ success: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    return json({ error: e.message || "Server error" }, 500);
  }
});
