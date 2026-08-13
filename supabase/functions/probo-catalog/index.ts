// Edge Function: Gateway zur Probo-Reseller-API für den internen
// Produktkatalog-Generator (/probo-katalog).
//
// Warum diese Function überhaupt existiert:
//   - Der Probo-Token darf nie ins Frontend-Bundle. Er lebt ausschließlich
//     hier als Supabase-Secret `PROBO_API_TOKEN`.
//   - Probos CDN schickt für Produktbilder keine garantiert permissiven
//     CORS-Header. `@react-pdf/renderer` lädt Bilder client-seitig, deshalb
//     liefert `detail` das Bild gleich als Data-URL mit.
//
// Aktionen (Body oder Query-Param `action`):
//   list                  -> GET /products (über alle Seiten)
//   detail  code=<code>   -> GET /products/product/<code> inkl. Bild
//   image   url=<cdn-url> -> Bild-Proxy, liefert { dataUrl } (Rückfallebene)
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

// Base64 bläht um ein Drittel auf und die Function hat begrenzten Speicher –
// ein Produktbild jenseits davon ist ohnehin kein Katalogbild mehr.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Hosts, von denen der Bild-Proxy laden darf. Ohne diese Liste wäre die
// Function ein offener Proxy (SSRF): jeder mit gültiger Session könnte
// interne Adressen über unsere Infrastruktur abfragen.
const ALLOWED_IMAGE_HOSTS = [
  // Probo liefert Produktbilder tatsächlich über print-uploader.com aus –
  // aus den Logs bestätigt, nicht geraten.
  "cdn.print-uploader.com",
  "print-uploader.com",
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

/**
 * Sucht im Antwort-Body den Weg zur nächsten Seite.
 *
 * Probo paginiert `/products`; ohne das kamen nur die ersten paar Produkte
 * an. Welche Spielart genau geliefert wird, ließ sich hier nicht gegen die
 * Doku prüfen, deshalb werden die zwei üblichen abgedeckt:
 *   - `links.next` / `next_page_url` als fertige URL
 *   - `meta.current_page` + `meta.last_page` (Laravel-Stil)
 * Findet sich keins von beidem, wird `?page=N` blind weiterprobiert – die
 * Schleife stoppt ohnehin, sobald eine Seite keine neuen Codes mehr bringt.
 */
function findNextPath(body: unknown, currentPage: number): string | null {
  const record = asRecord(body);
  const links = asRecord(record["links"]);

  const rawNext =
    (typeof links["next"] === "string" && links["next"]) ||
    (typeof record["next_page_url"] === "string" && record["next_page_url"]) ||
    (typeof record["next"] === "string" && record["next"]) ||
    "";

  if (rawNext) {
    // Absolute URL auf den Pfad zurückschneiden, damit PROBO_BASE davor passt.
    try {
      const parsed = new URL(rawNext, PROBO_BASE);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return null;
    }
  }

  const meta = asRecord(record["meta"]);
  const current = Number(meta["current_page"] ?? record["current_page"] ?? currentPage);
  const last = Number(meta["last_page"] ?? record["last_page"] ?? NaN);
  if (Number.isFinite(current) && Number.isFinite(last)) {
    return current < last ? `/products?page=${current + 1}` : null;
  }

  return `/products?page=${currentPage + 1}`;
}

/** Obergrenze, damit eine kaputte Pagination nicht endlos Seiten zieht. */
const MAX_PRODUCT_PAGES = 50;

/**
 * Holt die komplette Produktliste über alle Seiten.
 *
 * Abbruch, sobald eine Seite keinen einzigen neuen Produktcode mehr liefert –
 * das fängt auch den Fall ab, dass die API einen unbekannten `page`-Parameter
 * ignoriert und stur die erste Seite zurückgibt.
 */
async function fetchAllProducts(): Promise<{
  products: ReturnType<typeof normalizeListEntry>[];
  pages: number;
  skipped: number;
}> {
  const products: ReturnType<typeof normalizeListEntry>[] = [];
  const seen = new Set<string>();
  let path: string | null = "/products";
  let pages = 0;
  let skipped = 0;

  while (path && pages < MAX_PRODUCT_PAGES) {
    const { status, body } = await proboGet(path);
    if (status !== 200) {
      // Die erste Seite muss klappen; bricht eine Folgeseite weg, liefern
      // wir lieber die bis dahin gesammelten Produkte als gar nichts.
      if (pages === 0) throw new ProboHttpError(status, path);
      break;
    }

    const entries = extractList(body);
    if (!entries.length) break;

    let added = 0;
    for (const entry of entries) {
      const product = normalizeListEntry(entry);
      if (!product.code || seen.has(product.code)) continue;
      seen.add(product.code);
      // Zählt auch als "gesehen", damit die Schleife nicht wegen lauter
      // ausgemusterter Produkte vorzeitig abbricht.
      added++;
      if (!isActiveProduct(entry)) {
        skipped++;
        continue;
      }
      products.push(product);
    }

    pages++;
    if (!added) break;

    path = findNextPath(body, pages);
  }

  return { products, pages, skipped };
}

/** Trägt den Statuscode, damit der Handler die richtige Meldung bauen kann. */
class ProboHttpError extends Error {
  status: number;
  path: string;

  constructor(status: number, path: string) {
    super(proboErrorMessage(status, path));
    this.name = "ProboHttpError";
    this.status = status;
    this.path = path;
  }
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
// Gegen die echten Antworten gebaut (die Doku war aus der Build-Umgebung
// nicht erreichbar). Probo liefert:
//   Liste:  { meta, data: [{ active, active_to, replaced_by_product, code,
//                            article_group_name, unit_code, translations }] }
//   Detail: { active, active_to, replaced_by_product, code, translations,
//             article_group_name, images, options }
// Namen und Beschreibungen stecken ausschließlich in `translations`.

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

/** Sprachreihenfolge für Texte und Bilder. */
const LANGUAGE_PREFERENCE = ["de", "en", "nl", "all"];

/**
 * Holt einen Text aus dem `translations`-Block.
 *
 * Probo legt Name und Beschreibung nicht flach ans Produkt, sondern in
 * `translations` – aus den Logs bestätigt. Welche Form genau, ist nicht
 * dokumentiert erreichbar, deshalb beide üblichen:
 *   - Liste:  [{ language: "de", name: "...", description: "..." }, ...]
 *   - Objekt: { de: { name: "...", ... }, en: { ... } }
 * Fällt am Ende auf ein flaches Feld am Produkt selbst zurück.
 */
function pickTranslated(entry: Record<string, unknown>, keys: string[]): string {
  const translations = entry["translations"];
  const candidates: Record<string, unknown>[] = [];

  if (Array.isArray(translations)) {
    const byLanguage = (language: string) =>
      translations
        .map(asRecord)
        .find((item) => pickString(item, ["language", "lang", "locale"]).toLowerCase() === language);
    for (const language of LANGUAGE_PREFERENCE) {
      const hit = byLanguage(language);
      if (hit) candidates.push(hit);
    }
    // Falls keine Sprache passt: einfach alle in gegebener Reihenfolge.
    translations.map(asRecord).forEach((item) => candidates.push(item));
  } else if (translations && typeof translations === "object") {
    const record = asRecord(translations);
    for (const language of LANGUAGE_PREFERENCE) {
      const nested = record[language];
      if (nested && typeof nested === "object") candidates.push(asRecord(nested));
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") candidates.push(asRecord(value));
    }
  }

  for (const candidate of candidates) {
    const value = pickString(candidate, keys);
    if (value) return value;
  }
  return pickString(entry, keys);
}

const NAME_KEYS = ["title", "name", "label", "display_name"];
const DESCRIPTION_KEYS = [
  "description",
  "short_description",
  "long_description",
  "summary",
  "subtitle",
  "text",
];

/**
 * Probo wiederholt in `description` oft wortgleich den Titel ("Dekostoff" /
 * "Dekostoff"). Im PDF wäre das nur eine doppelte Zeile.
 */
function dropIfSameAsName(name: string, description: string): string {
  return description.trim().toLowerCase() === name.trim().toLowerCase() ? "" : description;
}

function normalizeListEntry(entry: Record<string, unknown>) {
  const name = pickTranslated(entry, NAME_KEYS);
  return {
    code: pickString(entry, ["code", "product_code", "productCode", "slug", "id"]),
    name,
    description: dropIfSameAsName(name, pickTranslated(entry, DESCRIPTION_KEYS)),
    category: pickString(entry, ["article_group_name", "category", "group", "product_group"]),
    unit: pickString(entry, ["unit_code"]),
  };
}

/**
 * Abgelaufene und ersetzte Produkte gehören nicht in einen Kundenkatalog.
 * Nur aussortieren, wenn Probo das ausdrücklich sagt – ein fehlendes Feld
 * gilt als aktiv.
 */
function isActiveProduct(entry: Record<string, unknown>): boolean {
  const active = entry["active"];
  if (active === false || active === 0 || active === "0") return false;

  const activeTo = entry["active_to"];
  if (typeof activeTo === "string" && activeTo) {
    const until = Date.parse(activeTo);
    if (Number.isFinite(until) && until < Date.now()) return false;
  }
  return true;
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
 * Baut die Stichpunkte für die Produktseite.
 *
 * Wichtig: Probo liefert **keine** Materialeigenschaften. Der Detail-Datensatz
 * besteht aus `translations`, `article_group_name`, `images` und `options` –
 * mehr ist nicht da (aus den echten Antworten bestätigt). Was sich sinnvoll
 * zeigen lässt, ist deshalb die Warengruppe und das, was am Produkt
 * konfigurierbar ist.
 *
 * Preise werden bewusst **nicht** aus dem Optionsbaum berechnet – Probo warnt
 * selbst davor. Richtpreise kommen im Frontend aus den Overrides.
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

  push("Warengruppe", pickString(entry, ["article_group_name"]));

  const options = entry["options"];
  if (Array.isArray(options)) {
    const names = options
      .map(asRecord)
      .filter((option) => {
        // Die Menge ist eine Bestellangabe, keine Produkteigenschaft.
        const code = pickString(option, ["code"]).toLowerCase();
        const typeCode = pickString(option, ["type_code"]).toLowerCase();
        return code !== "amount" && !typeCode.includes("amount");
      })
      .map((option) => pickTranslated(option, ["name", "title", "label"]))
      .filter(Boolean);

    const unique = [...new Set(names)];
    if (unique.length) push("Konfigurierbar", unique.slice(0, 6).join(", "));
  }

  return out.slice(0, 4);
}

function normalizeDetail(body: unknown) {
  const record = asRecord(body);
  const looksLikeProduct = (candidate: Record<string, unknown>) =>
    !!(candidate["name"] || candidate["code"] || candidate["images"] || candidate["translations"]);

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

  const name = pickTranslated(source, NAME_KEYS);
  return {
    code: pickString(source, ["code", "product_code", "productCode", "slug", "id"]),
    name,
    description: dropIfSameAsName(name, pickTranslated(source, DESCRIPTION_KEYS)),
    images: normalizeImages(source),
    properties: normalizeProperties(source),
  };
}

// ---- Bild-Proxy --------------------------------------------------------

/** Hostname nur fürs Logging – wirft nie. */
function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "?";
  }
}

/**
 * Bild mit Sprachpriorität wählen: gewünschte Sprache -> "all" -> erstes.
 */
function pickImageUrl(images: { language: string; url: string }[], language: string): string | null {
  if (!images.length) return null;
  const wanted = images.find((image) => image.language.toLowerCase() === language.toLowerCase());
  if (wanted) return wanted.url;
  const generic = images.find((image) => image.language.toLowerCase() === "all");
  if (generic) return generic.url;
  return images[0].url;
}

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

        let products: ReturnType<typeof normalizeListEntry>[];
        try {
          const result = await fetchAllProducts();
          products = result.products;
          console.log(
            `probo-catalog list: ${products.length} Produkte aus ${result.pages} Seite(n)` +
            `, ${result.skipped} ausgemustert`,
          );
        } catch (error) {
          if (error instanceof ProboHttpError) {
            return json({ error: error.message }, error.status);
          }
          throw error;
        }

        if (!products.length) {
          return json({
            products: [],
            warning:
              "Probo hat geantwortet, aber es ließ sich keine Produktliste erkennen. " +
              "Response-Form prüfen und die Normalisierung in probo-catalog anpassen.",
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

        // Das Bild gleich hier mitliefern, statt das Frontend nochmal mit der
        // CDN-URL zurückkommen zu lassen. Die URL stammt aus Probos eigener
        // Antwort, die wir gerade geholt haben – sie muss also durch keine
        // Host-Allowlist, und es ist egal, auf welchem CDN Probo seine Bilder
        // liegen hat. Genau daran scheiterten Bilder vorher stillschweigend.
        const language = param("language") || "de";
        const imageUrl = pickImageUrl(product.images, language);
        let imageDataUrl: string | null = null;
        if (imageUrl) {
          try {
            imageDataUrl = (await fetchImageAsDataUrl(imageUrl)).dataUrl;
          } catch (imageError) {
            // Ein Produkt ohne Bild ist brauchbar, ein Abbruch nicht.
            console.warn(
              `probo-catalog detail ${code}: Bild fehlgeschlagen (${hostOf(imageUrl)}):`,
              imageError instanceof Error ? imageError.message : imageError,
            );
          }
        }
        console.log(
          `probo-catalog detail ${code}: ${product.images.length} Bild(er)` +
          `${imageUrl ? `, Host ${hostOf(imageUrl)}` : ""}` +
          `, eingebettet: ${imageDataUrl ? "ja" : "nein"}` +
          `, Name "${product.name}"` +
          `, ${product.properties.length} Eigenschaft(en)`,
        );

        const withImage = { ...product, imageDataUrl };
        cacheSet(cacheKey, withImage);
        return json({ product: withImage });
      }

      case "image": {
        const imageUrl = param("url");
        if (!imageUrl) return json({ error: "Parameter `url` fehlt." }, 400);
        if (!isAllowedImageUrl(imageUrl)) {
          // Taucht das im Log auf, gehoert der Host in ALLOWED_IMAGE_HOSTS.
          console.warn(`probo-catalog image: Host abgelehnt: ${hostOf(imageUrl)}`);
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
