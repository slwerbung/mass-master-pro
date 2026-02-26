import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

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
    ["sign"]
  );
}

async function createSignedToken(projectId: string): Promise<string> {
  const key = await getHmacKey();
  const payload = JSON.stringify({
    projectId,
    ts: Date.now(),
    jti: crypto.randomUUID(),
  });
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return btoa(JSON.stringify({ p: payload, s: sigHex }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { projectId, password } = await req.json();

    if (!projectId || typeof projectId !== "string") {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid project ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("projects")
      .select("id, project_number, guest_password")
      .eq("id", projectId)
      .single();

    if (error || !data) {
      return new Response(
        JSON.stringify({ valid: false, error: "Project not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const needsPassword = !!data.guest_password;

    if (needsPassword) {
      if (!password) {
        return new Response(
          JSON.stringify({ valid: false, needsPassword: true, error: "Password required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Support both bcrypt hashed and legacy plaintext passwords
      let passwordValid = false;
      if (data.guest_password.startsWith("$2")) {
        // bcrypt hash
        passwordValid = await bcrypt.compare(password, data.guest_password);
      } else {
        // Legacy plaintext - compare and upgrade to bcrypt
        passwordValid = data.guest_password === password;
        if (passwordValid) {
          const hashed = await bcrypt.hash(password);
          await supabase
            .from("projects")
            .update({ guest_password: hashed })
            .eq("id", projectId);
        }
      }

      if (!passwordValid) {
        return new Response(
          JSON.stringify({ valid: false, needsPassword: true, error: "Invalid password" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const token = await createSignedToken(data.id);

    return new Response(
      JSON.stringify({
        valid: true,
        needsPassword,
        token,
        projectNumber: data.project_number,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ valid: false, error: "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
