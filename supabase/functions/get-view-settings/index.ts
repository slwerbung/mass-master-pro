import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("app_config")
      .select("key, value")
      .in("key", [
        "internal_show_print_files",
        "customer_show_print_files",
        "internal_show_detail_images",
        "customer_show_detail_images",
      ]);
    if (error) return json({ error: error.message }, 500);
    const lookup = new Map((data || []).map((row: any) => [row.key, row.value]));
    return json({
      settings: {
        internalShowPrintFiles: lookup.get("internal_show_print_files") ?? "true",
        customerShowPrintFiles: lookup.get("customer_show_print_files") ?? "true",
        internalShowDetailImages: lookup.get("internal_show_detail_images") ?? "true",
        customerShowDetailImages: lookup.get("customer_show_detail_images") ?? "false",
      },
    });
  } catch {
    return json({ error: "Server error" }, 500);
  }
});
