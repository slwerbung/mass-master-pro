

## Bug-Fix Plan: 8 Korrekturen

### 1. Kamera-Querformat funktioniert nicht
**Problem**: Die Kameraanfrage erzwingt `width: 1920, height: 1080`. Auf Mobilgeräten im Querformat kann der Browser diese Constraints nicht erfüllen oder die Videovorschau passt sich nicht an.
**Lösung** (`Camera.tsx`):
- Constraints auf `{ facingMode: "environment" }` vereinfachen (ohne feste Auflösung)
- CSS-Klasse `app-screen` um Landscape-Unterstützung erweitern: `w-screen h-[100dvh]` statt fester Höhe
- Video-Element dynamisch anpassen wenn sich die Orientierung ändert

### 2. Flächenaufmaß sitzt an falscher Position
**Problem**: `createAreaMeasurementGroup` in `areaMeasurement.ts` setzt die Kinder (Rect, Labels) mit absoluten Canvas-Koordinaten (`left`, `top`). Fabric.js Group-Objekte verwenden aber relative Koordinaten zum Gruppen-Mittelpunkt. Deshalb erscheint die Gruppe verschoben.
**Lösung** (`src/lib/areaMeasurement.ts`):
- Alle Positionen relativ zum Gruppen-Zentrum berechnen (0,0 = Mittelpunkt der Gruppe)
- Die Gruppe selbst mit `left: centerX, top: centerY, originX: 'center', originY: 'center'` positionieren
- Gleiches Problem auch in `measurement.ts` prüfen und ggf. korrigieren

### 3. Flächenmaß-Infos verschwinden nach dem Speichern
**Problem**: `areaMeasurements` wird lokal gespeichert, aber beim Sync zur Datenbank ignoriert:
- `buildLocationRows()` (supabaseSync.ts Zeile 229) schreibt `areaMeasurements` nicht in `custom_fields`
- `hydrateProjectFromSupabase()` (Zeile 198) liest `areaMeasurements` nicht zurück
- Bei `remote-won` gehen die Daten verloren

**Lösung** (`src/lib/supabaseSync.ts`):
- In `buildLocationRows()`: `areaMeasurements` als Teil von `custom_fields` mitspeichern (z.B. `custom_fields.__areaMeasurements`)
- In `hydrateProjectFromSupabase()`: `areaMeasurements` aus `custom_fields.__areaMeasurements` wieder extrahieren
- Kein DB-Schema-Change nötig, nutzt bestehendes JSONB-Feld

### 4. Standortfelder laden langsam / fehlen manchmal
**Problem**: `LocationDetails` lädt Feldkonfigurationen per Supabase-Query (`location_field_config`). Auf langsamen Verbindungen dauert das, und bis dahin werden keine Felder angezeigt. `isLoaded` wird schon auf `true` gesetzt bevor die Felder da sind.
**Lösung** (`LocationDetails.tsx`):
- Felder parallel zum restlichen Laden abfragen (nicht sequentiell)
- `isLoaded` erst auf `true` setzen wenn auch `fieldConfigs` geladen sind
- Fallback: Wenn Query nach 3s nicht antwortet, Default-Felder anzeigen

### 5. "Sitzung wird geprüft" dauert lange
**Problem**: `RoleGuard` in `App.tsx` ruft bei jeder Navigation die Edge Function `validate-session` auf. Auf Mobilgeräten mit schlechter Verbindung dauert das mehrere Sekunden.
**Lösung** (`App.tsx`):
- Validierungsergebnis in `sessionStorage` cachen (Key: `role+token+id`, Wert: Timestamp)
- Innerhalb von 5 Minuten kein erneuter Aufruf der Edge Function
- Bei Fehler trotzdem durchlassen (wie jetzt schon: `if (error) setValidated(true)`)

### 6. Allgemeine Performance auf Mobilgeräten
**Problem**: Mehrere unnötige Supabase-Aufrufe bei jedem Seitenaufruf.
**Lösung**: Wird durch Fix 4 und 5 weitgehend behoben. Zusätzlich:
- `location_field_config` einmal global laden und per Context/State teilen statt pro Seite

### 7. Mitarbeiter-Ansicht nicht mobiltauglich
**Problem**: Input für Name + Passwort + Button sind horizontal nebeneinander (`flex gap-2`), auf kleinen Screens zu eng.
**Lösung** (`Admin.tsx`, Mitarbeiter-Tab):
- Inputs untereinander statt nebeneinander auf Mobile: `flex flex-col sm:flex-row gap-2`
- Button volle Breite auf Mobile

### 8. Admin-Tabs nicht mobiltauglich
**Problem**: `grid-cols-5` für 5 Tabs — auf kleinen Screens unleserlich.
**Lösung** (`Admin.tsx`):
- TabsList: `grid-cols-3` auf Mobile mit Zeilenumbruch, oder horizontal scrollbar mit `overflow-x-auto`
- Tab-Labels kürzen auf Mobile oder Icons verwenden

---

### Betroffene Dateien

| Datei | Fixes |
|---|---|
| `src/pages/Camera.tsx` | #1 Querformat |
| `src/lib/areaMeasurement.ts` | #2 Positionierung |
| `src/lib/measurement.ts` | #2 Positionierung prüfen |
| `src/lib/supabaseSync.ts` | #3 areaMeasurements sync |
| `src/pages/LocationDetails.tsx` | #4 Felder-Ladelogik |
| `src/App.tsx` | #5 Session-Cache |
| `src/pages/Admin.tsx` | #7, #8 Mobile Layout |

