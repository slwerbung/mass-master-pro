# Probo Produktkatalog — interner PDF-Generator

**Stand:** 11.08.2026. Route `/probo-katalog`, Edge Function `probo-catalog`.

## Was das ist

Ein internes Werkzeug: Produkte aus der Probo-Reseller-API auswählen, Texte
und Richtpreise überschreiben, Deckblatt mit Kundenname/Logo setzen — und ein
PDF herunterladen, das man dem Kunden selbst schickt.

Kein Shop, keine Bestellung, keine Kundenansicht. Nichts wird gespeichert:
die Auswahl lebt im Komponenten-State, es gibt keine DB-Tabelle.

## Warum kein Puppeteer

CaptFix hat nur ein React-Frontend auf Vercel plus Supabase Edge Functions
(Deno). Es gibt keinen Node-Server, auf dem ein Headless-Chrome laufen könnte.
Das PDF entsteht deshalb **client-seitig** mit `@react-pdf/renderer`.

Der Preis dafür: weniger Layout-Freiheit als HTML/CSS (Flexbox-Subset), Fonts
müssen über `Font.register` eingebunden werden (hier Barlow aus
`public/fonts/`), und eingebettet werden nur JPEG und PNG. Andere Formate
(z. B. WebP vom Probo-CDN) rechnet `toPdfCompatibleImage()` im Browser über
ein Canvas in PNG um.

## Aufbau

| Baustein | Datei |
| --- | --- |
| Edge Function (API-Gateway + Bild-Proxy) | `supabase/functions/probo-catalog/index.ts` |
| Frontend-Client | `src/lib/proboCatalog.ts` |
| Bedienoberfläche | `src/pages/ProboCatalog.tsx` |
| PDF-Dokument | `src/components/probo/CatalogDocument.tsx` |
| Route (lazy, unverlinkt) | `src/App.tsx` |

### Edge Function `probo-catalog`

Aktionen über Body oder Query-Param:

- `list` → `GET https://api.proboprints.com/products`
- `detail` + `code` → `GET /products/product/<code>`
- `image` + `url` → lädt das Bild serverseitig, liefert `{ dataUrl }`

Auth zur Probo-API: Header `Authorization: Basic {{token}}` — der Token wird
**1:1** eingesetzt, es wird bewusst kein eigenes `user:pass`-Base64 gebaut.

Auth zu uns: ein echter signierter Admin- oder Employee-Token (wie
`hero-integration`). Die Route ist nur *unlisted*, nicht privat — der Pfad
steht im JS-Bundle. Ohne diese Prüfung könnte jeder mit geratenem Link
unsere Probo-Quota verbrauchen.

Fehler kommen als verständliche deutsche Meldung zurück: 401 → Token prüfen,
404 → Produkt bei Probo nicht gefunden (`notFound: true`, das Frontend
überspringt es), 429 → Rate Limit. Fehlt `PROBO_API_TOKEN`, sagt die Function
genau das, inklusive Setz-Befehl.

Antworten von `list` und `detail` sowie geladene Bilder liegen 5 Minuten in
einem In-Memory-Cache pro Function-Instanz — das reicht, um beim
Zusammenstellen eines Katalogs nicht in die Rate Limits zu laufen.

### Bild-Proxy statt CDN-URL

`@react-pdf/renderer` lädt Bilder client-seitig. Ob Probos CDN permissive
CORS-Header schickt, ist nicht zugesichert. Deshalb geht **kein** Bild direkt
per CDN-URL ins `<Image>`; alles läuft über die Action `image`, die die Bytes
als Data-URL zurückgibt.

Der Proxy nimmt nur `https`-URLs von bekannten Probo-Hosts an
(`ALLOWED_IMAGE_HOSTS`). Ohne diese Liste wäre die Function ein offener Proxy
(SSRF).

## Deployment

```bash
# Token aus der Probo-Plattform als Secret hinterlegen
supabase secrets set PROBO_API_TOKEN=<token>

# Function deployen
supabase functions deploy probo-catalog

# Frontend: git push -> Vercel deployed automatisch
```

## Offener Punkt: Response-Form von `GET /products`

Die Probo-Doku (`apidocs.proboprints.com`) war aus der Build-Umgebung nicht
erreichbar, die exakte Antwortstruktur von `GET /products` konnte also nicht
gegen die Doku verifiziert werden. Die Normalisierer in der Function greifen
deshalb mehrere plausible Formen ab — nacktes Array, `{ data: [...] }`,
`{ products: [...] }` — und ziehen Felder über Kandidatenlisten
(`code`/`product_code`/`slug`, `name`/`title`/`label` …).

Erkennt die Function keine Liste, liefert sie `products: []` plus eine
`warning`, die das Frontend als Toast anzeigt. **Beim ersten echten Testlauf
gegen die API also die Antwort ansehen und die Normalisierung in
`normalizeListEntry` / `normalizeDetail` / `normalizeProperties` auf die
tatsächliche Form zusammenstreichen.**

## Preise

Bewusst **keine** Preisberechnung aus dem Optionsbaum — Probo warnt selbst
davor, weil Produkte und Optionen sich ändern. Im PDF steht nur, was im
Override-Feld „Richtpreis" getippt wurde (z. B. „ab 39 €/m²" oder „auf
Anfrage").

## Bundle

`@react-pdf/renderer` sind ~1,3 MB. Die Seite ist deshalb `lazy()`-geladen
und der Chunk ist in `vite.config.ts` aus dem PWA-Precache ausgenommen
(`globIgnores`), damit ihn nicht jeder Mitarbeiter beim Installieren mitzieht.

## Später, nicht in v1

- Katalog-Konfigurationen je Kunde in einer Supabase-Tabelle speichern —
  dann projektweite Regel beachten: Migration mit expliziten `GRANT`s + RLS
  + Policies, sonst `42501`.
- Zwei Produkte pro Seite als Layout-Option.
- Inhaltsverzeichnis auf dem Deckblatt.
- QR-Code je Produkt (Link zur SL-Werbung-Anfrage).
