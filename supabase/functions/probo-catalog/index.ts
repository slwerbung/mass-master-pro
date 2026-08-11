// Edge Function: Gateway zur Probo-Reseller-API für den internen
// Produktkatalog-Generator (/probo-katalog).
//
// Warum diese Function überhaupt existiert:
//   - Der Probo-Token darf nie ins Frontend-Bundle. Er lebt ausschließlich
//     hier als Supabase-Secret `PROBO_API_TOKEN`.
//   - Probos CDN schickt für Produktbilder keine garantiert permissiven
//     CORS-Header. `@react-pdf/renderer` lädt Bilder client-seitig, deshalb
//     holt die Action `image` das Bild serverseitig und gibt eine Data-URL
//     zurück.
//
// Aktionen (Body oder Query-Param `action`):
//   list                  -> GET /products
//   detail  code=<code>   -> GET /products/product/<code>
//   image   url=<cdn-url> -> Bild-Proxy, liefert { dataUrl }
//
// Auth: wie `hero-integration` ein echter signierter Admin- oder
// Employee-Token. Die Route im Frontend ist nur unverlinkt, nicht privat –
// ohne diese Prüfung könnte jeder mit geratenem Pfad unsere Probo-Quota
// verbrauchen.

import { getSessionSecret, verifySessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const PROBO_BASE = "https://api.proboprints.com";

// Hosts, von denen der Bild-Proxy laden darf. Ohne diese Liste wäre die
// Function ein offener Proxy (SSRF): jeder mit gültiger Session könnte
// interne Adressen über unsere Infrastruktur abfragen.
// Base64 bläht um ein Drittel auf und die Function hat begrenzten Speicher –
// ein Produktbild jenseits davon ist ohnehin kein Katalogbild mehr.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_IMAGE_HOSTS = [
  "proboprints.com",
  "probo.nl",
  "probosign.com",
  "cloudfront.net",
];

// Probo hat Rate Limits. Ein kleiner In-Memory-Cache pro Function-Instanz
// reicht für unseren Fall (ein Nutzer, ein Katalog): die Produktliste wird
// beim Zusammenstellen mehrfach gebraucht, Details je Produkt einmal pro
// PDF-Lauf. Instanz stirbt -> Cache weg, das ist in Ordnung.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { ts: number; value: unknown }>();

function cacheGet(key: string): unknown | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key: string, value: unknown) {
  // Der Katalog hat keine tausenden Produkte; trotzdem eine harte Grenze,
  // damit eine lang laufende Instanz nicht unbegrenzt Speicher hält.
  if (cache.size > 200) cache.clear();
  cache.set(key, { ts: Date.now(), value });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getProboToken(): string {
  const token = Deno.env.get("PROBO_API_TOKEN");
  if (!token) {
    throw new Error(
      "PROBO_API_TOKEN ist nicht gesetzt. Secret hinterlegen mit: " +
      "supabase secrets set PROBO_API_TOKEN=<token aus der Probo-Plattform>"
    );
  }
  return token;
}

/**
 * Ruft die Probo-API auf.
 *
 * Auth laut Doku: `Authorization: Basic {{token}}` – der Token wird **1:1**
 * eingesetzt, es wird bewusst kein eigenes user:pass-Base64 gebaut.
 */
async function proboGet(path: string): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(`${PROBO_BASE}${path}`, {
    headers: {
      "Authorization": `Basic ${getProboToken()}`,
      "Accept": "application/json",
    },
  });

  const text = await resp.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: resp.status, body };
}

/** Übersetzt Probo-Statuscodes in eine verständliche deutsche Meldung. */
function proboErrorMessage(status: number, path: string): string {
  if (status === 401 || status === 403) {
    return "Probo-Token ungültig oder abgelaufen (401). PROBO_API_TOKEN prüfen.";
  }
  if (status === 404) {
    return `Bei Probo nicht gefunden: ${path}`;
  }
  if (status === 429) {
    return "Probo-Rate-Limit erreicht (429). Bitte kurz warten und erneut versuchen.";
  }
  return `Probo-API antwortete mit Status ${status}.`;
}

// ---- Normalisierung ----------------------------------------------------
//
// Die exakte Response-Form von `GET /products` konnte beim Bau nicht gegen
// die Doku verifiziert werden (apidocs.proboprints.com war aus der Build-
// Umgebung nicht erreichbar). Deshalb greifen die Normalisierer bewusst
// mehrere plausible Formen ab – Array, { data: [...] }, { products: [...] }
// – und ziehen Felder über Kandidatenlisten. Wenn die echte Form bekannt
// ist, kann das hier gefahrlos zusammengestrichen werden.

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    // Mehrsprachige Felder kommen teils als { en: "...", de: "..." }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      for (const lang of ["de", "en", "nl", "all"]) {
        const candidate = nested[lang];
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      }
    }
  }
  return "";
}

/** Holt die Produktliste aus verschiedenen möglichen Hüllen heraus. */
function extractList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.map(asRecord);
  const record = asRecord(body);
  for (const key of ["products", "data", "items", "results"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.map(asRecord);
    // { data: { products: [...] } }
    if (value && typeof value === "object") {
      const nested = asRecord(value);
      for (const innerKey of ["products", "data", "items"]) {
        if (Array.isArray(nested[innerKey])) {
          return (nested[innerKey] as unknown[]).map(asRecord);
        }
      }
    }
  }
  return [];
}

function normalizeListEntry(entry: Record<string, unknown>) {
  return {
    code: pickString(entry, ["code", "product_code", "productCode", "slug", "id"]),
    name: pickString(entry, ["name", "title", "label", "display_name"]),
    description: pickString(entry, ["description", "short_description", "subtitle", "summary"]),
    category: pickString(entry, ["category", "group", "product_group", "type"]),
  };
}

/**
 * Bild-URLs mit Sprachpriorität: gewünschte Sprache -> "all" -> erstes Bild.
 */
function normalizeImages(entry: Record<string, unknown>): { language: string; url: string }[] {
  const raw = entry["images"];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return { language: "all", url: item };
      const record = asRecord(item);
      return {
        language: pickString(record, ["language", "lang", "locale"]) || "all",
        url: pickString(record, ["url", "src", "href", "image", "link"]),
      };
    })
    .filter((image) => !!image.url);
}

/**
 * Zieht ein paar sprechende Materialeigenschaften aus dem Detail-Datensatz.
 *
 * Probo liefert einen Optionsbaum; für den Katalog reichen zwei bis vier
 * Stichpunkte (Material, Stärke, Anwendung ...). Preise werden hier bewusst
 * **nicht** berechnet – Probo warnt selbst davor, aus gecachten Optionen
 * Preise abzuleiten. Richtpreise kommen im Frontend aus den Overrides.
 */
function normalizeProperties(entry: Record<string, unknown>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const seen = new Set<string>();

  const push = (label: string, value: string) => {
    const cleanLabel = label.trim();
    const cleanValue = value.trim();
    if (!cleanLabel || !cleanValue) return;
    const key = cleanLabel.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: cleanLabel, value: cleanValue });
  };

  // a) Flache Eigenschaften-Listen
  for (const key of ["properties", "specifications", "specs", "attributes", "characteristics"]) {
    const value = entry[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const record = asRecord(item);
        push(
          pickString(record, ["label", "name", "key", "title"]),
          pickString(record, ["value", "text", "description", "content"]),
        );
      }
    } else if (value && typeof value === "object") {
      for (const [label, raw] of Object.entries(asRecord(value))) {
        if (typeof raw === "string" || typeof raw === "number") push(label, String(raw));
      }
    }
  }

  // b) Optionsbaum: die ersten Optionsgruppen als "Material: A, B, C"
  const options = entry["options"];
  if (Array.isArray(options)) {
    for (const option of options.slice(0, 6)) {
      const record = asRecord(option);
      const label = pickString(record, ["name", "label", "title", "code"]);
      const values = record["values"] ?? record["choices"] ?? record["items"];
      let value = pickString(record, ["value", "default", "description"]);
      if (!value && Array.isArray(values)) {
        value = values
          .slice(0, 3)
          .map((item) =>
            typeof item === "string" ? item : pickString(asRecord(item), ["name", "label", "title", "value"])
          )
          .filter(Boolean)
          .join(", ");
      }
      push(label, value);
    }
  }

  return out.slice(0, 4);
}

function normalizeDetail(body: unknown) {
  const record = asRecord(body);
  const looksLikeProduct = (candidate: Record<string, unknown>) =>
    !!(candidate["name"] || candidate["code"] || candidate["images"]);

  // Manche Endpunkte packen das Produkt in { data: {...} } / { product: {...} }
  let source = record;
  if (!looksLikeProduct(record)) {
    for (const key of ["data", "product", "result"]) {
      const nested = asRecord(record[key]);
      if (looksLikeProduct(nested)) {
        source = nested;
        break;
      }
    }
  }

  return {
    code: pickString(source, ["code", "product_code", "productCode", "slug", "id"]),
    name: pickString(source, ["name", "title", "label", "display_name"]),
    description: pickString(source, [
      "description",
      "short_description",
      "long_description",
      "summary",
      "subtitle",
    ]),
    images: normalizeImages(source),
    properties: normalizeProperties(source),
  };
}

// ---- Bild-Proxy --------------------------------------------------------

function isAllowedImageUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_IMAGE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function toBase64(bytes: Uint8Array): string {
  // In Blöcken, sonst sprengt ein großes Bild den Argument-Stack von
  // String.fromCharCode.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchImageAsDataUrl(url: string) {
  const cacheKey = `image:${url}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached as { dataUrl: string; contentType: string };

  const resp = await fetch(url, { headers: { "Accept": "image/*" } });
  if (!resp.ok) {
    throw new Error(`Bild konnte nicht geladen werden (Status ${resp.status}): ${url}`);
  }
  // Ohne das Abschneiden der Parameter landet ein "; charset=..." mitten in
  // der Data-URL und der Browser kann sie nicht mehr lesen.
  const contentType = (resp.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  if (!contentType.startsWith("image/")) {
    throw new Error(`Antwort ist kein Bild (${contentType}): ${url}`);
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Produktbild ist zu groß (${Math.round(bytes.byteLength / 1024 / 1024)} MB): ${url}`
    );
  }
  // Format wird hier absichtlich nicht gefiltert: @react-pdf/renderer kann
  // nur JPEG/PNG, aber der Browser rechnet z. B. WebP über ein Canvas in PNG
  // um (siehe `toPdfCompatibleImage` im Frontend). Deno könnte das nicht.
  const result = { dataUrl: `data:${contentType};base64,${toBase64(bytes)}`, contentType };
  cacheSet(cacheKey, result);
  return result;
}

// ---- Handler -----------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    const param = (key: string): string => {
      const fromBody = body[key];
      if (typeof fromBody === "string" && fromBody) return fromBody;
      return url.searchParams.get(key) || "";
    };

    // Auth: echter signierter Admin- oder Employee-Token.
    const token =
      param("adminToken") || param("employeeToken") || param("sessionToken") || param("token");
    if (!token) return json({ error: "Unauthorized" }, 401);
    const payload = await verifySessionToken(token, getSessionSecret());
    if (!payload || (payload.role !== "admin" && payload.role !== "employee")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const action = param("action") || "list";

    switch (action) {
      case "list": {
        const cached = cacheGet("list");
        if (cached) return json({ products: cached });

        const { status, body: listBody } = await proboGet("/products");
        if (status !== 200) return json({ error: proboErrorMessage(status, "/products") }, status);

        const products = extractList(listBody)
          .map(normalizeListEntry)
          .filter((product) => !!product.code);

        if (!products.length) {
          return json({
            products: [],
            warning:
              "Probo hat geantwortet, aber es ließ sich keine Produktliste erkennen. " +
              "Response-Form in der Doku prüfen und die Normalisierung in probo-catalog anpassen.",
          });
        }

        cacheSet("list", products);
        return json({ products });
      }

      case "detail": {
        const code = param("code");
        if (!code) return json({ error: "Parameter `code` fehlt." }, 400);
        // Nur das, was in einem Produktcode vorkommen darf – verhindert
        // Pfad-Tricks wie `../../`.
        if (!/^[a-zA-Z0-9._-]{1,120}$/.test(code)) {
          return json({ error: `Ungültiger Produktcode: ${code}` }, 400);
        }

        const cacheKey = `detail:${code}`;
        const cached = cacheGet(cacheKey);
        if (cached) return json({ product: cached });

        const path = `/products/product/${encodeURIComponent(code)}`;
        const { status, body: detailBody } = await proboGet(path);
        if (status === 404) {
          // Nicht kalkulierbare Produkte sind bei Probo normal – das
          // Frontend überspringt sie und warnt, statt abzubrechen.
          return json({ error: proboErrorMessage(404, path), notFound: true }, 404);
        }
        if (status !== 200) return json({ error: proboErrorMessage(status, path) }, status);

        const product = normalizeDetail(detailBody);
        cacheSet(cacheKey, product);
        return json({ product });
      }

      case "image": {
        const imageUrl = param("url");
        if (!imageUrl) return json({ error: "Parameter `url` fehlt." }, 400);
        if (!isAllowedImageUrl(imageUrl)) {
          return json({ error: `Bild-URL nicht erlaubt: ${imageUrl}` }, 400);
        }
        const image = await fetchImageAsDataUrl(imageUrl);
        return json(image);
      }

      default:
        return json({ error: `Unbekannte Aktion: ${action}` }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("probo-catalog error:", message);
    return json({ error: message }, 500);
  }
});
