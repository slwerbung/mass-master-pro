import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSessionToken, getSessionSecret } from "../_shared/session.ts";

/**
 * Ensures a customer record + project assignment exist for a given name
 * and project, then issues a customer session token. Used both by the
 * regular /kunde login flow (when a known customer signs in) and by the
 * direct-link flow (when an unknown visitor opens a project link and
 * provides their name).
 *
 * Behavior is idempotent: if the customer name already matches an
 * existing record, that one is reused; if the assignment already exists,
 * nothing happens. A new session token is always returned so the
 * frontend can run as the authenticated customer afterwards.
 *
 * The token returned is the same format issued by validate-customer, so
 * the rest of the app sees no difference between a "real" customer login
 * and a direct-link login - both have full customer rights afterwards.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, customerName } = await req.json();
    if (!projectId || !customerName?.trim()) return json({ error: "Missing projectId or customerName" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const normalizedName = customerName.trim().replace(/\s+/g, " ");

    const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).single();
    if (!project) return json({ error: "Project not found" }, 404);

    let customerId: string;
    let customerDisplayName = normalizedName;

    // Step 1: Find or create customer (case-insensitive name match).
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id, name")
      .ilike("name", normalizedName)
      .maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.id;
      customerDisplayName = existingCustomer.name;
    } else {
      const { data: createdCustomer, error: createError } = await supabase
        .from("customers")
        .insert({ name: normalizedName })
        .select("id, name")
        .single();
      if (createError || !createdCustomer) {
        return json({ error: createError?.message || "Could not create customer" }, 500);
      }
      customerId = createdCustomer.id;
      customerDisplayName = createdCustomer.name;
    }

    // Step 2: Ensure assignment (idempotent upsert).
    const { error: assignmentError } = await supabase
      .from("customer_project_assignments")
      .upsert(
        { customer_id: customerId, project_id: projectId },
        { onConflict: "customer_id,project_id", ignoreDuplicates: true }
      );
    if (assignmentError) return json({ error: assignmentError.message }, 500);

    // Step 3: Issue a customer session token (12h validity, same as
    // validate-customer). With this token the client can call
    // customer-data and other authenticated endpoints just like a
    // regular customer login.
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
    const token = await createSessionToken(
      { role: "customer", userId: customerId, exp },
      getSessionSecret()
    );

    return json({
      success: true,
      customer: { id: customerId, name: customerDisplayName },
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  } catch (e: any) {
    console.error("ensure-customer-assignment failed:", e);
    return json({ error: "Server error" }, 500);
  }
});
