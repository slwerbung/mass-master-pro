# Phase 3 — Storage privat

**Stand:** 29.07.2026. Angewandt und geprüft gegen die Produktions-Instanz.

## Ausgangslage

Der Bucket `project-files` war **public**. Jede Datei — Standortfotos,
Druckdaten, Fahrzeuglayouts, Kunden-Uploads — war ohne jede Anmeldung abrufbar,
sobald jemand den Pfad kannte. Und die Pfade sind vorhersagbar aufgebaut
(`vehicle-images/<projectId>/<uuid>`, `pdfs/<locationId>/…`).

## Was jetzt gilt

`public = false`. Dateien gibt es nur noch über **signierte Links**, die
Supabase anhand der Session ausstellt und die nach einer Stunde ablaufen. Wer
die zugehörige Zeile nicht sehen darf, bekommt auch keinen Link — es greifen
dieselben Storage-Policies wie in Phase 1/2.

Zusätzlich ein Größenlimit von 100 MB pro Datei (vorher keins).

### Neu im Frontend

| Datei | Zweck |
|---|---|
| `src/lib/storageUrl.ts` | `signedFileUrl()` / `signedFileUrls()` mit Cache. Ein Pfad wird pro Stunde einmal signiert, nicht pro Render. |
| `src/hooks/useSignedUrls.ts` | Für Listen: löst alle Pfade einer Ansicht in einem Aufruf auf, `urlFor(path)` liefert den Link. |

Umgestellt: `supabaseSync` (Hydrate), `Export`, `PhotoEditor`, `VehicleDetail`,
`CustomerView` (Fahrzeugteil — der Standortteil nutzte bereits signierte Links).
`getPublicUrl` kommt im Code nicht mehr vor.

Beim Abmelden wird der Link-Cache geleert (`clearSession`), damit keine
fremden Links im Speicher liegenbleiben.

### Serverseitig

`_shared/aufmassPdf.ts` baut sich keine URL mehr, sondern lädt die Dateien mit
`storage.download()` direkt — die Function läuft ohnehin mit `service_role`.

### Storage-Policies danach

| Aktion | Wer |
|---|---|
| SELECT | Mitarbeiter (`is_staff()`), Kunden (`current_customer_id()`) |
| INSERT | Mitarbeiter, Kunden |
| UPDATE | Mitarbeiter |
| DELETE | Mitarbeiter, Kunden |
| `anon` | nichts |

Dabei ist eine Altlast aufgefallen: `Allow authenticated upload` galt für
**jeden** angemeldeten Supabase-Benutzer. Lesen oder in die Datenbank schreiben
konnte damit niemand, Dateien ablegen aber schon. Ersetzt durch eine
Mitarbeiter-Policy.

## Geprüft

Eine zuvor öffentlich abrufbare Datei über ihre alte URL:

```
GET /storage/v1/object/public/project-files/vehicle-images/…/….png
→ 400 {"statusCode":"404","error":"Bucket not found"}
```

Vorher lieferte dieselbe URL das Bild aus.

## Offener Punkt

Drei Edge Functions (`run-automations`, `hero-dropbox-poll`,
`submit-vehicle-request`) tragen in ihrem Bundle noch die **alte** Fassung von
`_shared/aufmassPdf.ts`, die Dateien über eine öffentliche URL laden wollte.
Das ist heute folgenlos: die Aufmaß-PDF-Aktion hängt am Trigger
`project_fully_approved`, und der wird ausschließlich von `send-notification`
ausgelöst — diese Function ist aktualisiert.

Würde jemand im Admin die Aktion „HERO: Aufmaß-PDF hochladen" an einen der
Trigger dieser drei Functions hängen (`first_location_created`,
`vehicle_measured_uploaded`, `hero_customer_created`, `hero_project_created`,
`vehicle_inquiry_submitted`), entstünde ein PDF ohne Bilder statt einer
Fehlermeldung. Die drei Functions sollten beim nächsten Anfassen neu deployed
werden.
