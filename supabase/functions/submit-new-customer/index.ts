import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HERO_GRAPHQL = "https://login.hero-software.de/api/external/v7/graphql";
const NOTIFICATION_EMAIL = "info@slwerbung.de";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Rate limiting (in-memory, resets on cold start) ─────────────────────────
// Max 5 submissions per IP per hour. This runs in a single worker instance;
// across cold starts the counter resets, but that's fine as a first line of
// defence. If abuse becomes a problem we can move to a persistent counter.
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
// Cleanup periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits) if (now > v.resetTime) rateLimits.delete(k);
}, 60_000);

// ── HTML escape (so form input can't inject into the notification mail) ─────
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Input validation ────────────────────────────────────────────────────────
interface FormInput {
  companyName?: string;
  legalForm?: string;
  salutation?: string;
  firstName?: string;
  lastName: string;
  email: string;
  phone: string;
  mobile?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  // anti-bot fields
  honeypot?: string;        // should always be empty
  formLoadedAt?: number;    // client-set timestamp; too-fast submits = bot
  consent?: boolean;        // DSGVO consent checkbox
}

function validate(input: FormInput): string | null {
  if (!input.lastName?.trim()) return "Nachname fehlt";
  if (!input.email?.trim()) return "E-Mail fehlt";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return "E-Mail-Adresse sieht nicht gültig aus";
  if (!input.phone?.trim()) return "Telefonnummer fehlt";
  if (!input.consent) return "Bitte stimme der Datenschutzerklärung zu";
  // Honeypot: if this field is filled, it's a bot (real users never see it)
  if (input.honeypot && input.honeypot.trim() !== "") return "bot";
  // Minimum time on form: 3 seconds
  if (input.formLoadedAt && Date.now() - input.formLoadedAt < 3000) return "bot";
  return null;
}

// ── HERO call ───────────────────────────────────────────────────────────────
// Schema confirmed from https://hero-software.de/api-doku/graphql-guide
// Key facts:
//   - Mutation name is create_contact
//   - Phone is phone_home (not phone)
//   - Address is a nested object { street, city, zipcode }
//   - PLZ is zipcode (not zip_code)
// Unknowns we handle defensively:
//   - Whether HERO has salutation / legal_form fields. If they do exist,
//     great; if not, HERO will return an error and we'll see it in the logs.
//     Either way, salutation and legal form are always included in the
//     notification mail, so we never lose that information.
//   - Whether category="customer" is the right classification for leads.
//     We pass it because the docs' PHP example uses it.
async function createHeroCustomer(apiKey: string, input: FormInput): Promise<{ ok: boolean; heroId?: string; error?: string }> {
  const mutation = `
    mutation CreateContact(
      $first_name: String,
      $last_name: String,
      $company_name: String,
      $email: String,
      $phone_home: String,
      $phone_mobile: String,
      $address: AddressInput,
      $category: CustomerCategoryEnum
    ) {
      create_contact(
        first_name: $first_name,
        last_name: $last_name,
        company_name: $company_name,
        email: $email,
        phone_home: $phone_home,
        phone_mobile: $phone_mobile,
        address: $address,
        category: $category
      ) { id }
    }
  `;
  const address = (input.street || input.postalCode || input.city) ? {
    street: input.street?.trim() || null,
    zipcode: input.postalCode?.trim() || null,
    city: input.city?.trim() || null,
  } : null;

  const variables = {
    first_name: input.firstName?.trim() || null,
    last_name: input.lastName.trim(),
    company_name: input.companyName?.trim() || null,
    email: input.email.trim(),
    phone_home: input.phone.trim(),
    phone_mobile: input.mobile?.trim() || null,
    address,
    category: "customer",
  };

  try {
    const resp = await fetch(HERO_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error("HERO HTTP error:", resp.status, text.slice(0, 1000));
      return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
    }
    let result: any;
    try { result = JSON.parse(text); } catch {
      return { ok: false, error: `Invalid JSON: ${text.slice(0, 200)}` };
    }
    if (result.errors?.length) {
      console.error("HERO GraphQL errors:", JSON.stringify(result.errors));
      return { ok: false, error: result.errors[0].message };
    }
    const id = result?.data?.create_contact?.id;
    if (!id) {
      console.error("HERO response missing id:", JSON.stringify(result));
      return { ok: false, error: "HERO hat keine ID zurückgegeben" };
    }
    return { ok: true, heroId: String(id) };
  } catch (e: any) {
    console.error("HERO fetch threw:", e);
    return { ok: false, error: e.message || "Unknown fetch error" };
  }
}

// ── Notification email via Resend ───────────────────────────────────────────
async function sendNotificationMail(input: FormInput, heroResult: { ok: boolean; heroId?: string; error?: string }) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.warn("RESEND_API_KEY not set, skipping notification mail");
    return;
  }

  const heroStatus = heroResult.ok
    ? `<p style="color:#2e7d32"><strong>✓ In HERO angelegt</strong> (ID: ${esc(heroResult.heroId)})</p>`
    : `<p style="color:#c62828"><strong>✗ HERO-Anlage fehlgeschlagen:</strong> ${esc(heroResult.error)}<br>
       <span style="font-size:12px;color:#666">Bitte manuell in HERO anlegen.</span></p>`;

  const fullName = [input.salutation, input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  const addressLines: string[] = [];
  if (input.street) addressLines.push(esc(input.street));
  if (input.postalCode || input.city) addressLines.push(esc([input.postalCode, input.city].filter(Boolean).join(" ")));

  const html = `
    <h2 style="margin:0 0 16px">Neukunden-Anfrage</h2>
    ${heroStatus}
    <table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
      ${input.companyName ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Firma</td><td><strong>${esc(input.companyName)}</strong>${input.legalForm ? ` (${esc(input.legalForm)})` : ""}</td></tr>` : ""}
      <tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td><strong>${esc(fullName || input.lastName)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">E-Mail</td><td><a href="mailto:${esc(input.email)}">${esc(input.email)}</a></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Telefon</td><td><a href="tel:${esc(input.phone)}">${esc(input.phone)}</a></td></tr>
      ${input.mobile ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Mobil</td><td><a href="tel:${esc(input.mobile)}">${esc(input.mobile)}</a></td></tr>` : ""}
      ${addressLines.length > 0 ? `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Adresse</td><td>${addressLines.join("<br>")}</td></tr>` : ""}
    </table>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:12px;color:#666">Eingegangen ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} · aus Neukunden-Formular</p>
  `;

  const subject = heroResult.ok
    ? `Neukunde: ${input.companyName || input.lastName} ✓`
    : `Neukunde: ${input.companyName || input.lastName} (HERO-Fehler)`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Neukunden-Formular <noreply@slwerbung.de>",
      to: [NOTIFICATION_EMAIL],
      reply_to: input.email,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.error("Resend error:", await res.text());
  }
}

// ── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!checkRateLimit(`signup:${clientIp}`, 5, 60 * 60 * 1000)) {
      return json({ error: "Zu viele Anfragen. Bitte versuche es später nochmal." }, 429);
    }

    const input: FormInput = await req.json();
    const validationError = validate(input);
    if (validationError === "bot") {
      // Silently reject bots – they don't need a helpful error message
      console.warn("Bot-like submission rejected from", clientIp);
      return json({ success: true }); // pretend success so the bot moves on
    }
    if (validationError) {
      return json({ error: validationError }, 400);
    }

    // Fetch HERO API key from app_config
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: rows } = await supabase.from("app_config").select("key, value")
      .in("key", ["hero_api_key", "hero_enabled"]);
    const config = new Map((rows || []).map((r: any) => [r.key, r.value]));
    const apiKey = config.get("hero_api_key");
    const heroEnabled = config.get("hero_enabled") === "true" && !!apiKey;

    let heroResult: { ok: boolean; heroId?: string; error?: string };
    if (heroEnabled && apiKey) {
      heroResult = await createHeroCustomer(apiKey, input);
    } else {
      heroResult = { ok: false, error: "HERO-Integration ist nicht aktiv" };
    }

    // Send notification mail regardless of HERO result – we never want to
    // lose a lead just because HERO is down or the mutation shape changed.
    await sendNotificationMail(input, heroResult);

    // To the user, always report success once the data has been captured
    // (mail sent or at least attempted). HERO errors are internal.
    return json({ success: true });
  } catch (e: any) {
    console.error("submit-new-customer handler error:", e);
    return json({ error: "Server-Fehler. Bitte versuche es später erneut." }, 500);
  }
});
