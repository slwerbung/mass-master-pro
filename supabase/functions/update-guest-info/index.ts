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
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16)));
    return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, token, locationId, guestInfo, authorName, feedbackId } = await req.json();

    if (!projectId || !token || !locationId || !(await validateToken(token, projectId))) {
      return json({ error: "Unauthorized" }, 401);
    }

    const sanitizedInfo = typeof guestInfo === "string" ? guestInfo.trim().slice(0, 5000) : "";
    const sanitizedAuthor = typeof authorName === "string" && authorName.trim() ? authorName.trim().slice(0, 120) : "Kunde";
    if (!sanitizedInfo) return json({ error: "Missing guestInfo" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: loc } = await supabase
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("project_id", projectId)
      .single();

    if (!loc) return json({ error: "Location not found" }, 404);

    let feedback: any = null;
    const requestedFeedbackId = typeof feedbackId === "string" && feedbackId ? feedbackId : null;

    try {
      if (requestedFeedbackId) {
        const { data, error } = await supabase
          .from("location_feedback")
          .update({ message: sanitizedInfo, author_name: sanitizedAuthor })
          .eq("id", requestedFeedbackId)
          .eq("location_id", locationId)
          .eq("status", "open")
          .select("*")
          .single();
        if (error) throw error;
        feedback = data;
      } else {
        const { data, error } = await supabase
          .from("location_feedback")
          .insert({
            location_id: locationId,
            author_name: sanitizedAuthor,
            author_customer_id: null,
            message: sanitizedInfo,
            status: "open",
          })
          .select("*")
          .single();
        if (error) throw error;
        feedback = data;
      }
    } catch (feedbackError) {
      // legacy fallback keeps old installs functional, but only as single text field
      const { error } = await supabase
        .from("locations")
        .update({ guest_info: sanitizedInfo })
        .eq("id", locationId);

      if (error) return json({ error: "Update failed" }, 500);
      return json({ success: true, feedback: null, legacy: true, warning: String((feedbackError as any)?.message || feedbackError || "") });
    }

    return json({ success: true, feedback, legacy: false });
  } catch {
    return json({ error: "Server error" }, 500);
  }
});
