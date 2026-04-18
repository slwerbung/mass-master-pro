import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSessionToken, getSessionSecret } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Simple in-memory rate limiter (per worker instance, resets on cold start).
const rateLimits = new Map<string, { count: number; resetTime: number }>();
function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetTime) {
    rateLimits.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!checkRateLimit(`customer:${clientIp}`, 20, 60_000)) {
      return json({ valid: false, error: "Too many requests" }, 429);
    }

    const { customerName } = await req.json();
    if (!customerName || typeof customerName !== "string") {
      return json({ valid: false, error: "Missing customerName" }, 400);
    }

    const normalized = customerName.trim().replace(/\s+/g, " ");
    if (!normalized) return json({ valid: false, error: "Invalid name" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Case-insensitive match against the customers table.
    const { data: customer } = await supabase
      .from("customers")
      .select("id, name")
      .ilike("name", normalized)
      .maybeSingle();

    if (!customer) return json({ valid: false });

    // Issue a signed session token valid for 12 hours.
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
    const token = await createSessionToken(
      { role: "customer", userId: customer.id, exp },
      getSessionSecret()
    );
    return json({
      valid: true,
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
      customer: { id: customer.id, name: customer.name },
    });
  } catch {
    return json({ valid: false, error: "Server error" }, 500);
  }
});
