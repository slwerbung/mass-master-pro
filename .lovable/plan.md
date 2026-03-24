

## Plan: Bugfix Projekttrennung, Kundenkommentare, Datei-Upload, Präfix-Verwaltung, Flächen-Aufmaß

### 1. BUGFIX: Lokale Projekte anderer Mitarbeiter sichtbar

**Problem**: In `Projects.tsx` Zeile 62-72 werden lokale Projekte ohne Employee-Filter hinzugefuegt. Die Cloud-Query filtert korrekt nach `employee_id`, aber lokale Projekte eines anderen Mitarbeiters (die z.B. durch einen frueheren Sync auf dem Geraet gelandet sind) werden trotzdem angezeigt.

**Loesung** in `Projects.tsx`:
- Beim Hinzufuegen lokaler Projekte (Zeile 62-72) ebenfalls gegen die Cloud pruefen: Nur lokale Projekte anzeigen, die auch in der Cloud-Liste vorkommen ODER die noch nicht synchronisiert sind und vom aktuellen Mitarbeiter stammen
- Konkret: Fuer Employees nur lokale Projekte anzeigen, deren `id` in der gefilterten Supabase-Liste vorkommt

Zusaetzlich in `NewProject.tsx` Zeile 45: `user_id` auf eine gueltige UUID setzen statt den String `"employee"`. Wenn `session.id` kein UUID ist, `employee_id` verwenden oder den Projekt-UUID selbst.

### 2. Kundenkommentare loeschen + Datum/Uhrzeit

**Loeschen**:
- `CustomerView.tsx`: Neben "Bearbeiten" einen "Loeschen"-Button hinzufuegen (nur fuer eigene offene Kommentare)
- Neue `deleteFeedback`-Funktion: Ruft `customer-data` mit action `delete_feedback` auf
- `customer-data/index.ts`: Neuen Case `delete_feedback` hinzufuegen, der den Feedback-Eintrag loescht (Pruefung auf `author_customer_id` und `status = open`)

**Datum/Uhrzeit**:
- In der Feedback-Anzeige (Zeile 621-633) das `created_at` als formatierten Zeitstempel anzeigen (z.B. "24.03.2026, 14:30")

### 3. Kunden-Dateiupload

**Datenbank**: Neue Tabelle `customer_uploads` mit Spalten:
- `id` (uuid), `project_id` (uuid), `customer_id` (uuid), `file_name` (text), `storage_path` (text), `created_at` (timestamptz)
- RLS: SELECT/INSERT/DELETE fuer anon erlauben

**Storage**: Bestehenden `project-files` Bucket nutzen, Pfad: `customer-uploads/{project_id}/{uuid}/{filename}`

**CustomerView.tsx**:
- Upload-Button pro Projekt (neben der Standortliste)
- File-Input mit Accept fuer gaengige Dateitypen (PDF, PNG, JPG, etc.)
- Liste hochgeladener Dateien mit Download-Link und Loeschen-Option

**ProjectDetail.tsx**:
- Im Projekt-Header einen Bereich "Kundendateien" anzeigen, der Uploads aus `customer_uploads` laedt
- Download-Links fuer jede Datei

### 4. Projekt-Praefix konfigurierbar

**Datenbank**: `app_config` um einen Eintrag `project_prefix` erweitern (Default: `"WER-"`)

**Admin.tsx** (Settings-Tab):
- Neues Feld "Projekt-Praefix" mit Textfeld und Speichern-Button
- Speichert ueber `admin-manage` Action `set_config` / `get_config` oder direkt neue Actions `set_project_prefix` / `get_project_prefix`

**admin-manage Edge Function**:
- Neue Actions `get_project_prefix` und `set_project_prefix`

**NewProject.tsx**:
- Beim Laden das Praefix aus `app_config` lesen (ueber eine neue Edge Function Action oder direkt via Supabase — aber `app_config` hat `USING(false)`, also via Edge Function)
- Dynamisch anzeigen statt hartcodiert "WER-"

**Projects.tsx**: Keine Aenderung noetig, da Projektnummer bereits den vollen String enthaelt.

### 5. Flaechen-Aufmass (Area Measurement)

**Neuer Tool-Typ** in `PhotoEditor.tsx`:
- Neuer Tool `"area"` neben `"measure"`
- Button mit `Square`-Icon (oder `RectangleHorizontal`) in der Toolbar
- Workflow: Zwei Klicks definieren die gegenueberliegenden Ecken eines Rechtecks
- Dialog fuer Breite (mm) und Hoehe (mm) — erweiterter `MeasurementInputDialog` oder eigener `AreaMeasurementDialog`
- Auf dem Canvas: Rechteck mit gestricheltem Rand + Breiten-Label an Oberkante + Hoehen-Label an Seitenkante + m²-Wert in der Mitte

**Neuer Dialog** `AreaMeasurementDialog.tsx`:
- Zwei Eingabefelder: Breite (mm) und Hoehe (mm)
- Bestaetigen erstellt die Flaechen-Annotation

**Neues Modul** `src/lib/areaMeasurement.ts`:
- `createAreaMeasurementGroup(x1, y1, x2, y2, widthMm, heightMm, index, color)` — erstellt eine Fabric-Group mit:
  - Gestricheltes Rechteck
  - Breiten-Label oben (z.B. "2000 mm")
  - Hoehen-Label links (z.B. "1000 mm")
  - m²-Label in der Mitte (z.B. "2.00 m²")
  - Flaechen-Label (z.B. "F 1")
- Group bekommt `data: { type: "area", index, widthMm, heightMm }`

**Flaechen-Zusammenfassung im Standort**:
- `types/project.ts`: Interface `AreaMeasurement` mit `index`, `widthMm`, `heightMm`
- `Location` Interface: optionales `areaMeasurements?: AreaMeasurement[]`
- `LocationDetails.tsx`: Beim Speichern die Area-Measurements aus dem Canvas-JSON extrahieren (alle Groups mit `data.type === "area"`) und in `areaMeasurements` speichern
- `ProjectDetail.tsx` / `LocationCard.tsx`: Zusammenfassung anzeigen: "F 1: 2000 x 1000 mm (2.00 m²), F 2: ..." + Gesamtflaeche

### Betroffene Dateien

| Datei | Aenderung |
|---|---|
| `src/pages/Projects.tsx` | Lokale Projekte nach Employee filtern |
| `src/pages/NewProject.tsx` | `user_id`-Fix + dynamisches Praefix |
| `src/pages/CustomerView.tsx` | Kommentar loeschen, Datum anzeigen, Dateiupload |
| `src/pages/ProjectDetail.tsx` | Kundendateien anzeigen, Flaechen-Zusammenfassung |
| `src/pages/Admin.tsx` | Praefix-Verwaltung in Settings |
| `src/pages/PhotoEditor.tsx` | Area-Tool hinzufuegen |
| `src/pages/LocationDetails.tsx` | Area-Measurements extrahieren und speichern |
| `src/components/MeasurementInputDialog.tsx` | Unveraendert |
| Neu: `src/components/AreaMeasurementDialog.tsx` | Dialog fuer Breite/Hoehe |
| Neu: `src/lib/areaMeasurement.ts` | Canvas-Gruppe fuer Flaechenaufmass |
| `src/components/LocationCard.tsx` | Flaechen-Zusammenfassung anzeigen |
| `src/types/project.ts` | `AreaMeasurement` Interface |
| `supabase/functions/customer-data/index.ts` | `delete_feedback` Action |
| `supabase/functions/admin-manage/index.ts` | Praefix Actions |
| Neue Migration | `customer_uploads` Tabelle + RLS |

### Was sich nicht aendert

- Grundriss-Funktionalitaet, Gast-Zugriff, Mitarbeiter-Passwoerter
- Bestehende Kundenansicht-Logik (Freigaben, Kommentar-Bearbeiten)
- Bestehende Linien-Bemassungen bleiben unveraendert

