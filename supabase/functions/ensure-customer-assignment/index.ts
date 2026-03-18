import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      if (createError || !createdCustomer) return json({ error: createError?.message || "Could not create customer" }, 500);
      customerId = createdCustomer.id;
      customerDisplayName = createdCustomer.name;
    }

    const { error: assignmentError } = await supabase
      .from("customer_project_assignments")
      .upsert({ customer_id: customerId, project_id: projectId }, { onConflict: "customer_id,project_id", ignoreDuplicates: true });

    if (assignmentError) return json({ error: assignmentError.message }, 500);

    return json({ success: true, customer: { id: customerId, name: customerDisplayName } });
  } catch {
    return json({ error: "Server error" }, 500);
  }
});
