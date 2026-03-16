import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Simple in-memory rate limiter
const rateLimits = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(identifier: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const limit = rateLimits.get(identifier);
  if (!limit || now > limit.resetTime) {
    rateLimits.set(identifier, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (limit.count >= maxRequests) return false;
  limit.count++;
  return true;
}

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

function sanitizeGuestInfo(input: string): string {
  // Remove control characters except newlines and tabs
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  // Limit length
  sanitized = sanitized.slice(0, 5000);
  return sanitized.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Rate limit: 20 requests per minute per IP
  const clientIp = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(`update-guest:${clientIp}`, 20, 60000)) {
    return new Response(
      JSON.stringify({ error: "Too many requests" }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { projectId, token, locationId, guestInfo } = await req.json();

    if (!projectId || !token || !locationId || !(await validateToken(token, projectId))) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sanitizedInfo = typeof guestInfo === "string" ? sanitizeGuestInfo(guestInfo) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: loc } = await supabase
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("project_id", projectId)
      .single();

    if (!loc) {
      return new Response(
        JSON.stringify({ error: "Location not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error } = await supabase
      .from("locations")
      .update({ guest_info: sanitizedInfo })
      .eq("id", locationId);

    if (error) {
      return new Response(
        JSON.stringify({ error: "Update failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
