# Sync v2 – lokal zuerst, feldgenau, live (Nov. 2026)

## Warum neu

Der alte Sync (`supabaseSync.ts` bis Nov. 2026) hatte drei Grundfehler:

1. **Ganzes Projekt hochladen.** Jede Änderung schickte *alle* Standorte mit *allen* Feldern per `upsert`.
   Ein zweites Gerät, das das Projekt nur offen hatte, überschrieb damit Änderungen anderer mit seinem alten
   Stand. Verstärkt dadurch, dass `saveProject` beim Laden den lokalen Projektstempel auf „jetzt“ setzte – das
   Gerät hielt sich danach immer für neuer.
2. **Bilder an festen Pfaden** (`images/<Standort>/annotated`). Ein neues Foto auf Gerät A kam auf Gerät B nie
   an (B schrieb ein Bild nur, wenn lokal keines da war), und B lud beim nächsten Sync sein altes Bild wieder
   hoch (der Hash-Cache kennt nur selbst hochgeladene Bilder).
3. **Zeitstempel von Handy-Uhren** entschieden, wer gewinnt.

## Prinzip

- **Lokal zuerst.** Jede Änderung landet sofort in IndexedDB. Die App funktioniert ohne Netz vollständig
  (Projekte öffnen, fotografieren, bemaßen, Standorte anlegen/ändern/löschen). Die Engine lädt hoch, sobald
  Netz da ist und die App ruhig ist (`quietTime`).
- **Basis je Einheit** (`sync-base` in IndexedDB): die zuletzt vom Server bestätigte Fassung von Projekt,
  Standort, Detailbild, Grundriss. Lokal ≠ Basis → hier geändert. Server ≠ Basis → woanders geändert.
- **Nur Geändertes hochladen**, jeweils mit dem Basiswert: `sync_push` (Postgres) übernimmt ein Feld nur, wenn
  es dort seitdem niemand anders geändert hat. Verschiedene Felder → automatisch zusammengeführt.
  Dasselbe Feld unterschiedlich → **Konflikt**, der Mitarbeiter entscheidet (Banner + Dialog im Projekt).
- **Bilder: jede Fassung ein neuer Pfad** (`images/<Standort>/annotated-<v>.jpg`, Detailbilder
  `detail-images/<Standort>/<id>/<slot>-<v>.jpg`). `sync_set_image` setzt den Pfad nur, wenn der Server noch die
  Basisfassung hat. Ein Blob ohne `path` in IndexedDB ist hier neu/geändert – jede Schreibstelle legt Blobs ohne
  `path` an, die Engine erkennt neue Fotos dadurch ohne Buchführung. Alte Pfade werden gelöscht, sofern nicht
  geschützt (`sync_path_in_use`: Freigabe-Nachweis, Kundenmarkierung, andere Zeile).
- **Grundriss-Markierungen** werden nie als Konflikt gemeldet, sondern nach `id` zusammengeführt.
- **Löschen** braucht keinen Vermerk mehr: Basis vorhanden, lokal weg → hier gelöscht → `sync_delete`.
  Online gelöscht, hier aber geändert → Konflikt „Wiederherstellen / Auch hier löschen“.
- **Live:** `watchProject()` (Projektseite, Grundriss) abonniert Realtime auf `projects`/`locations`/
  `floor_plans`. Bild- und Detailbild-Änderungen ziehen `locations.updated_at` mit, lösen also auch ein Ereignis
  aus. Fallback: alle 60 s, bei Netz-Rückkehr und beim Zurückkehren in die App.
- **Revision** je Zeile (Trigger), auch bei Änderungen aus Edge Functions/Kundenansicht. Unveränderte Einheiten
  werden beim Herunterladen übersprungen.

## Offline

- Projekte, die man vorher geöffnet hat, liegen komplett auf dem Gerät. Beim Öffnen der Projektliste werden die
  **eigenen, nicht archivierten** Projekte eines Mitarbeiters samt Bildern aufs Gerät geholt
  (`syncAllToSupabase(offlineIds)`), damit sie auch in Gebäuden ohne Empfang da sind.
- Projektliste ohne Netz: zeigt die Projekte auf dem Gerät. Neues Projekt geht offline.
- Feldkonfigurationen werden für offline gemerkt (`offlineCache.ts`).
- Angemeldet bleiben: Ein gemerkter Mitarbeiter bleibt ohne Netz bis 7 Tage nach Token-Ablauf angemeldet
  (`getSession`); mit Netz erneuert `SessionKeeper` das Token.
- Warteschlange übersteht Neustarts (`mmp_sync_dirty_v2` in localStorage + Basisvergleich).
- Nur mit Netz: Projekt löschen, HERO-Aktionen, Kundeneinladungen, Automationen („erster Standort“ feuert offline
  nicht).

## Altbestand

Geräte mit Daten von vor Sync v2 haben keine Basis. Beim ersten Abgleich je Projekt wird eingeordnet
(`pullEntity`, Zweig „Altbestand“): Online-Fassung gilt, außer der Standort ist lokal nachweislich neuer
(lokaler Stempel > `updated_at`) – dann werden seine Felder/Fotos hochgeladen. Nichts wird unnötig neu
hochgeladen. Alte Löschvermerke (`mmp_deleted_v1`) werden noch ausgeführt.

## Dateien

- `supabase/migrations/20261124120000_sync_v2.sql` – Revisionen, `sync_push`, `sync_set_image`, `sync_delete`,
  Nachtrag fehlender `location_images`-Zeilen, Realtime.
- `src/lib/sync/fields.ts` – reine Feldlogik (Abbildung lokal/Server, Diff, Dreiwege-Abgleich).
- `src/lib/sync/engine.ts` – Push, Pull, Downloads, Konflikte, Warteschlange, `watchProject`.
- `src/lib/supabaseSync.ts` – bisherige Funktionsnamen für die Seiten (`scheduleSyncProject` usw.).
- `src/components/SyncConflictBanner.tsx` – Offline-/Upload-Hinweis und Konfliktdialog.

## Tests

- `npx vitest run src/lib/sync/` – Feldlogik (immer).
- `SYNC_PG_URL=postgres://… scripts/test-sync-integration.sh` – SQL-Tests der Migration und **zwei bzw. drei
  simulierte Geräte** gegen eine echte lokale Postgres-DB (Offline-Phase, gleichzeitige Änderungen,
  Bildkonflikte, Löschen, Altbestand). **Nie gegen Produktion** – die DB wird geleert.

## Regeln für neuen Code

- Nach jeder lokalen Änderung `scheduleSyncProject(projectId)` aufrufen. Nie direkt in `projects`/`locations`/
  `location_images`/`detail_images`/`floor_plans` schreiben (außer Projekt löschen).
- Nie `saveProject` mit einem ganzen, vorher geladenen Projekt aufrufen, um eine Einzeländerung zu speichern
  (würde andere Standorte mit altem Stand zurückschreiben). `addLocation`, `deleteLocation`,
  `updateLocationMetadata` (nur geänderte Felder übergeben!), `updateLocationImage` usw. benutzen.
- Formulare speichern nur die Felder, die der Benutzer geändert hat (`LocationDetails`: `initialValuesRef`).
- Bild-Blobs nie mit gleichem Inhalt neu schreiben – ein neu geschriebener Blob gilt als geändertes Foto.
