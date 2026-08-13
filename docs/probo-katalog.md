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

## Die echte Probo-Antwort

Die Doku (`apidocs.proboprints.com`) war aus der Build-Umgebung per
Egress-Policy gesperrt. Die Normalisierung ist deshalb gegen die echten
Antworten gebaut, abgelesen aus den Supabase-Function-Logs.

**Liste** — `GET /products` ist paginiert: `{ meta, data }`, 20 Einträge je
Seite, rund 29 Seiten, ~560 Produkte. Ein Eintrag:

```
active, active_to, replaced_by_product, code,
article_group_name, unit_code, translations, created_at, updated_at
```

**Detail** — `GET /products/product/{code}`:

```
active, active_to, replaced_by_product, code,
translations, article_group_name, images, options
```

Wichtig, weil es der Stolperstein war: **es gibt kein flaches `name` und kein
flaches `description`.** Beides steckt in `translations`, als Objekt je
Sprache:

```json
"translations": {
  "de": { "title": "Dekostoff", "description": "Dekostoff" },
  "en": { "title": "Dekostof", "description": "Deko fabric" }
}
```

Produkte benutzen dort `title`, Optionen `name` — `pickTranslated()` deckt
beides ab, mit Sprachreihenfolge de → en → nl. `description` wiederholt oft
wortgleich den Titel; solche Dopplungen fliegen raus.

**Bilder** liegen auf `cdn.print-uploader.com`, nicht auf einer
Probo-Domain. Deshalb lädt `detail` das Bild selbst und gibt es als Data-URL
mit, statt das Frontend mit der CDN-URL zurückkommen zu lassen.

**Materialeigenschaften liefert Probo nicht.** Es gibt nur den Optionsbaum
(`options`), und dessen erster Eintrag ist die Bestellmenge. Die Produktseite
zeigt deshalb `Warengruppe` (aus `article_group_name`), `Einheit` (aus
`unit_code` der Liste) und `Konfigurierbar` (die Namen der Optionsgruppen
ohne die Menge). Wer mehr will, müsste die Texte selbst pflegen — dafür sind
die Overrides im Formular da.

Ausgemusterte Produkte (`active: false` oder abgelaufenes `active_to`)
werden aussortiert; beim letzten Lauf waren das 23 von 561.

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
