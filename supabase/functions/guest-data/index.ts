import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getHmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("GUEST_TOKEN_SECRET")!;
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

async function validateToken(token: string, projectId: string): Promise<boolean> {
  try {
    const { p: payload, s: sigHex } = JSON.parse(atob(token));
    const parsed = JSON.parse(payload);
    if (parsed.projectId !== projectId) return false;
    if (Date.now() - parsed.ts > 24 * 60 * 60 * 1000) return false;

    const key = await getHmacKey();
    const sigBytes = new Uint8Array(
      sigHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16))
    );
    return crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(payload)
    );
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { projectId, token } = await req.json();

    if (!projectId || !token || !(await validateToken(token, projectId))) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: locations } = await supabase
      .from("locations")
      .select("id, location_number, location_name, comment, system, label, location_type, guest_info")
      .eq("project_id", projectId)
      .order("created_at");

    if (!locations || locations.length === 0) {
      return new Response(
        JSON.stringify({ locations: [], images: [], pdfs: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const locationIds = locations.map((l) => l.id);

    const { data: images } = await supabase
      .from("location_images")
      .select("location_id, image_type, storage_path")
      .in("location_id", locationIds);

    const { data: pdfs } = await supabase
      .from("location_pdfs")
      .select("id, location_id, storage_path, file_name")
      .in("location_id", locationIds);

    return new Response(
      JSON.stringify({
        locations: locations || [],
        images: images || [],
        pdfs: pdfs || [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
