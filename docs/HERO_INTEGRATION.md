# HERO Software – Integrationswissen

Diese Datei bündelt das gesamte erarbeitete Wissen über die HERO-Software-API
und wie die einzelnen Anwendungsfälle in Captfix umgesetzt sind. Sie ist als
Nachschlagewerk gedacht, damit das Wissen nicht verloren geht.

Stand: Mai 2026. HERO-Instanz des Betriebs (Partner-Account).

---

## 1. Grundlagen

### Endpunkte

| Zweck | URL | Methode | Auth-Header |
|---|---|---|---|
| GraphQL (Queries + Mutations) | `https://login.hero-software.de/api/external/v7/graphql` | POST | `Authorization: Bearer <API_KEY>` |
| Datei-Upload (Schritt 1) | `https://login.hero-software.de/app/v8/FileUploads/upload` | POST (multipart) | `x-auth-token: <API_KEY>` |
| Lead-API (Projekt anlegen) | `https://login.hero-software.de/api/v1/Projects/create` | POST (JSON) | `Authorization: Bearer <API_KEY>` |

**Wichtig:** Die beiden Auth-Header sind unterschiedlich!
- GraphQL + Lead-API → `Authorization: Bearer ...`
- Datei-Upload → `x-auth-token: ...` (kein "Bearer")

### API-Key

- Liegt in der DB-Tabelle `app_config` unter dem Key `hero_api_key`.
- Aktivierungs-Flag: `hero_enabled` = `"true"`.
- **Wird NICHT vom Browser gelesen** (anon RLS blockt `app_config`). Jeder
  HERO-Aufruf läuft daher server-seitig in einer Edge Function, die den Key
  über die Service-Role aus `app_config` liest.

### GraphQL-Typen (wichtigste)

- **Mutation-Root-Type heißt `PartnerMutation`** (nicht `Mutation`).
- `ProjectMatch` = ein Projekt (das, was im Partner-Portal als Projekt sichtbar ist).
- `CustomerDocument` = ein Dokument an einem Projekt/Kontakt.
- `FileUpload` = eine hochgeladene Datei (vor der Zuordnung).

### Introspection (Schema abfragen)

Per PowerShell (PS 5.1 hat Macken mit `Invoke-RestMethod` + Body – `curl.exe`
ist robuster):

```powershell
$apiKey = "<KEY>"
'{"query":"query { __type(name: \"PartnerMutation\") { fields { name args { name type { name kind ofType { name kind } } } } } }"}' | Out-File -Encoding ascii "$env:TEMP\q.json"
curl.exe -s -X POST "https://login.hero-software.de/api/external/v7/graphql" -H "Authorization: Bearer $apiKey" -H "Content-Type: application/json" -d "@$env:TEMP\q.json" | Out-File -Encoding utf8 "$env:USERPROFILE\Downloads\schema.json"
```

Für einen Input-Type: `__type(name: "ProjectMatchInput") { inputFields { name type { ... } } }`.

---

## 2. ID-Modell (wichtig, häufige Fehlerquelle!)

Ein HERO-Projekt besteht intern aus mehreren Objekten mit **verschiedenen IDs**:

- **`project_match.id`** → das ist die ID, die für (fast) alles gebraucht wird:
  Datei-Uploads, Notizen, Partner-Portal-URL.
- **`project.id`** → eine andere, innere ID. NICHT für Uploads/URLs verwenden.

In Captfix wird die `project_match.id` im Projekt unter
`custom_fields.__hero_project_id` gespeichert (als String). Die zugehörige
Projektnummer (z.B. `WER-1766`) liegt in `custom_fields.__hero_project_nr`.

Im Frontend liest `getHeroProjectMatchId(project)` (in `src/lib/heroSyncHelpers.ts`)
diesen Wert aus `customFields.__hero_project_id` und gibt ihn als Zahl zurück.

> **Merksatz:** Der Bild-Upload funktioniert zuverlässig und nutzt
> `custom_fields.__hero_project_id`. Wenn ein anderer HERO-Aufruf nicht
> funktioniert, an dieser bewährten Kette orientieren.

### Partner-Portal-URL

```
https://login.hero-software.de/partner/Projects/view/<project_match.id>
```

---

## 3. Anwendungsfall: Datei-Upload (Bilder UND Dokumente)

Immer **zwei Schritte**: erst Datei hochladen (→ UUID), dann zuordnen.

### Schritt 1 – Datei hochladen (multipart)

```
POST https://login.hero-software.de/app/v8/FileUploads/upload
Header: x-auth-token: <API_KEY>
Body: multipart/form-data, Feldname "file"
```

Antwort (verschachtelt!):

```json
{ "status": "success", "data": { "uuid": "a11ptylhfago0ogg", "id": 45237629, ... } }
```

**Die UUID liegt unter `data.uuid`**, NICHT unter dem Top-Level `uuid`.
Häufiger Bug: `response.uuid` ist leer → die Zuordnung schlägt mit
`"file_upload_uuid darf nicht leer bleiben"` (422) fehl. Immer `response.data.uuid`
lesen (mit Fallbacks: `json.data?.uuid ?? json.uuid ?? json.file_upload_uuid`).

### Schritt 2a – als BILD zuordnen

```graphql
mutation($uuid: String!, $targetId: Int!) {
  upload_image(file_upload_uuid: $uuid, target: project_match, target_id: $targetId) { id }
}
```

Argumente von `upload_image`:
- `file_upload_uuid: String!`
- `target: LinkTargetEnum` (Literal `project_match`)
- `target_id: Int!`

Bilder brauchen **keinen** Dokumenttyp.

### Schritt 2b – als DOKUMENT zuordnen

```graphql
mutation($doc: CustomerDocumentInput!, $uuid: String!, $targetId: Int!) {
  upload_document(document: $doc, file_upload_uuid: $uuid, target: project_match, target_id: $targetId) { id }
}
```

Argumente von `upload_document` (alle NON_NULL):
- `document: CustomerDocumentInput!` → enthält **nur** `{ document_type_id: <int> }`
- `file_upload_uuid: String!`
- `target: LinkTargetEnum!` (Literal `project_match`)
- `target_id: Int!`

**Häufiger Bug:** `target`, `target_id`, `file_upload_uuid` NICHT in das
`document`-Objekt packen. Sie sind eigenständige Argumente. Nur
`document_type_id` gehört in `document`.

Der **`document_type_id`** ist pro Dokument-Art Pflicht. Die IDs werden im
Admin-Menü pro Anwendungsfall hinterlegt (siehe Abschnitt 6).

---

## 4. Anwendungsfall: Projekt-Notizen schreiben (partner_notes)

Das Notizfeld eines Projekts heißt **`partner_notes`** (String). Es gibt nur
EIN Notizfeld pro Projekt (kein Verlauf). Zum Aktualisieren: komplett
überschreiben.

```graphql
mutation($pm: ProjectMatchInput) {
  update_project_match(project_match: $pm) { id partner_notes }
}
```

Variable:
```json
{ "pm": { "id": <project_match.id>, "partner_notes": "..." } }
```

> Achtung Unterschied zum **Logbuch**: `add_logbook_entry` schreibt einen
> Logbuch-EINTRAG (Verlauf), NICHT ins Notizfeld. Für „immer aktuelle Notiz"
> ist `update_project_match` + `partner_notes` richtig.

In Captfix: Edge Function `update-hero-notes` (server-side, Service-Role).
Sie wird von `src/lib/heroNotesSync.ts` → `updateHeroNotesIfLinked(projectId)`
aufgerufen. Der Aufruf MUSS `await`-ed werden, BEVOR `navigate()` die Seite
wechselt – sonst bricht das Unmount den laufenden Request ab (genau dieser Bug
hat den Notizen-Sync lange verhindert).

---

## 5. Anwendungsfall: Projekt anlegen (Lead-API)

Die Lead-API ist ein separater REST-Endpunkt (kein GraphQL) zum Anlegen neuer
Projekte aus einem Formular heraus.

```
POST https://login.hero-software.de/api/v1/Projects/create
Header: Authorization: Bearer <KEY>, Content-Type: application/json
```

Body (Auszug):
```json
{
  "measure": "PRJ",
  "customer": { "email": "...", "first_name": "...", "last_name": "...", "company_name": "..." },
  "address": { "street": "...", "zipcode": "...", "city": "...", "country_code": "DE" },
  "project_match": {
    "comment": "Erscheint als Logbucheintrag",
    "partner_notes": "Erscheint im Notizfeld",
    "partner_source": "Quelle"
  }
}
```

Pflicht: `customer.email` und `address.zipcode`.

Antwort: `{ "status": "success", "id": <project.id> }`

> **WICHTIG:** Die zurückgegebene `id` ist die innere `project.id`, NICHT die
> `project_match.id`! Für Uploads/Notizen/URL muss danach die echte
> `project_match.id` nachgeschlagen werden:

```graphql
query($projectIds: [Int]) {
  project_matches(project_ids: $projectIds) { id project_nr project { id } }
}
```

Den Treffer nehmen, dessen `project.id` der zurückgegebenen Lead-ID entspricht,
und dessen `id` (= project_match.id) in `custom_fields.__hero_project_id`
speichern.

---

## 6. Dokumenttypen (document_type_id)

Jedes hochgeladene Dokument braucht eine `document_type_id`. Welche ID welcher
Art entspricht, ist HERO-instanzspezifisch und wird im **Admin-Menü →
Integrationen → HERO Dokumenttypen** gepflegt.

Gespeichert in `app_config` unter Keys nach dem Muster `hero_doc_type_<uploadType>`:

| uploadType | app_config-Key | Bedeutung |
|---|---|---|
| `aufmass_pdf` | `hero_doc_type_aufmass_pdf` | Aufmaß-PDF aus dem Projekt-Export |
| `lager_label_pdf` | `hero_doc_type_lager_label_pdf` | Lager-Etiketten-PDF |
| `layout_pdf` | `hero_doc_type_layout_pdf` | Vom Kunden hochgeladenes Fahrzeug-Layout |

Dokumenttypen in HERO auflisten:

```graphql
query { document_types { id name } }
```

Der `document_type_id` wird **server-seitig** in `hero-upload-proxy` aus
`app_config` aufgelöst (Service-Role), nicht im Browser – weil anon-RLS
`app_config` blockt.

---

## 7. Captfix-Architektur der HERO-Anbindung

### Edge Functions (server-side, Deno)

| Function | Zweck |
|---|---|
| `hero-upload-proxy` | Datei-Upload (Bilder + Dokumente). Löst document_type_id server-side auf. |
| `update-hero-notes` | Schreibt `partner_notes` (Flächenmaße). Service-Role. |
| `submit-vehicle-request` | Fahrzeug-Anfrage: Lead-API-Projekt + Bilder + partner_notes. |
| `submit-layout` | Kunden-Layout-PDF: Storage + HERO-Dokument-Upload. |
| `hero-integration` | Diagnose/Verwaltung (Doc-Type-Introspection, Schema). **Braucht Session-Token** – daher NICHT für den Notiz-Sync geeignet. |
| `admin-manage` | u.a. Doc-Type-Config speichern/lesen. |

### Frontend-Helfer

- `src/lib/heroSyncHelpers.ts`
  - `getHeroProjectMatchId(project)` → liest `customFields.__hero_project_id`.
  - `enqueueHeroUploadIfLinked({ project, uploadType, blob, filename })` →
    legt einen Upload in die lokale Queue. Ein Worker schickt ihn an
    `hero-upload-proxy`. **Robust gegen Seitenwechsel** (überlebt Unmount,
    Retry/Backoff).
- `src/lib/heroUploadWorker.ts` → arbeitet die Upload-Queue ab.
- `src/lib/heroNotesSync.ts` → baut den Notiztext + ruft `update-hero-notes`.

### Zwei Upload-Wege – Unterschied

1. **Queue-basiert** (`enqueueHeroUploadIfLinked` → Worker → `hero-upload-proxy`):
   für eingeloggte App. Überlebt Navigation/Unmount, mit Retry. Genutzt für
   Standortbilder, Aufmaß-PDF, Lager-Etikett.
2. **Direkt server-side** (eigene Edge Function, Service-Role): für Aktionen
   ohne eingeloggten User bzw. ohne Queue-Kontext, z.B. `submit-layout`
   (öffentliche Seite) und `update-hero-notes`.

---

## 8. Gelöste Bugs / Stolperfallen (Lessons Learned)

1. **UUID-Extraktion:** UUID liegt in `response.data.uuid`, nicht top-level.
   Leere UUID → 422 „file_upload_uuid darf nicht leer bleiben".
2. **upload_document-Struktur:** `target`/`target_id`/`file_upload_uuid` sind
   eigene Argumente, NICHT Teil von `document`. In `document` gehört nur
   `document_type_id`.
3. **Falsche ID:** `__hero_project_id` muss die `project_match.id` sein. Die
   Lead-API gibt aber `project.id` zurück → nachschlagen nötig, sonst 404 im
   Partner-Portal + fehlschlagende Uploads.
4. **Notiz-Sync brach ab:** `updateHeroNotesIfLinked` wurde ohne `await` vor
   `navigate()` aufgerufen → Component-Unmount cancelte den fetch. Fix: vor
   dem Navigieren `await`-en.
5. **hero-integration braucht Session-Token:** Aufruf aus dem Browser-Sync
   ohne Token → kam nie an (401). Lösung: eigene Service-Role-Function
   `update-hero-notes`.
6. **app_config + anon RLS:** Browser kann `app_config` nicht lesen. Alle
   HERO-Configs (API-Key, Doc-Types) server-seitig per Service-Role lesen.
7. **document_type_id ist Pflicht** für `upload_document`. Fehlt er, lehnt
   HERO ab. Pro uploadType im Admin pflegen.
8. **Mutation-Root heißt `PartnerMutation`**, nicht `Mutation` – bei
   Introspection beachten.
9. **PowerShell 5.1:** `Invoke-RestMethod` mit String-Body wirft teils
   „kein parameterloser Konstruktor". `curl.exe` (in Windows eingebaut)
   verwenden; offene `>>`-Blöcke vorher mit Enter schließen.

---

## 9. Schnelltest-Snippets (PowerShell, curl.exe)

### Notiz schreiben (partner_notes)

```powershell
$apiKey = "<KEY>"; $pmId = 10298240
"{`"query`":`"mutation { update_project_match(project_match: { id: $pmId, partner_notes: \`"Test\`" }) { id partner_notes } }`"}" | Out-File -Encoding ascii "$env:TEMP\m.json"
curl.exe -s -X POST "https://login.hero-software.de/api/external/v7/graphql" -H "Authorization: Bearer $apiKey" -H "Content-Type: application/json" -d "@$env:TEMP\m.json"
```

### Dokument-Upload (zwei Schritte)

```powershell
$apiKey = "<KEY>"; $pmId = 10298240; $docType = 1250455; $pdf = "$env:USERPROFILE\Downloads\test.pdf"
# Schritt 1
$up = curl.exe -s -X POST "https://login.hero-software.de/app/v8/FileUploads/upload" -H "x-auth-token: $apiKey" -F "file=@$pdf"
$uuid = ($up | ConvertFrom-Json).data.uuid
# Schritt 2
"{`"query`":`"mutation { upload_document(document: { document_type_id: $docType }, file_upload_uuid: \`"$uuid\`", target: project_match, target_id: $pmId) { id } }`"}" | Out-File -Encoding ascii "$env:TEMP\a.json"
curl.exe -s -X POST "https://login.hero-software.de/api/external/v7/graphql" -H "Authorization: Bearer $apiKey" -H "Content-Type: application/json" -d "@$env:TEMP\a.json"
```

---

## 10. Sicherheit

- Der API-Key gewährt vollen Zugriff auf die HERO-Instanz. Niemals in Logs,
  Chats, Screenshots oder Commits teilen.
- Bei Verdacht auf Leak: in HERO neuen Key erzeugen, alten widerrufen, neuen
  in `app_config.hero_api_key` (bzw. den genutzten Speicherort) eintragen.
