

## Plan: Felder nach Aufmaßart filtern, Pflichtfeld-Option, Sortierung reparieren

### Analyse

**Aktueller Stand der `location_field_config`-Tabelle:**
- Hat keine Spalte für Aufmaßart-Zuordnung
- Hat keine Spalte für Pflicht/Optional
- Sortierung nutzt `sort_order`-Werte, die beim Verschieben nur getauscht werden — wenn zwei Felder denselben `sort_order` haben, ist das Ergebnis unzuverlässig

### Änderungen

#### 1. Datenbank-Migration

Zwei neue Spalten auf `location_field_config`:

```sql
ALTER TABLE location_field_config 
  ADD COLUMN applies_to text NOT NULL DEFAULT 'all',
  ADD COLUMN is_required boolean NOT NULL DEFAULT false;
```

`applies_to` kann sein: `'all'`, `'aufmass'`, `'aufmass_mit_plan'`

Danach alle bestehenden Felder mit aufsteigenden `sort_order`-Werten normalisieren, damit die Sortierung sauber startet.

#### 2. Admin UI (`src/pages/Admin.tsx`)

**Beim Anlegen eines neuen Felds:**
- Dropdown "Gilt für": Alle / Nur Aufmaß / Nur Aufmaß mit Plan
- Checkbox "Pflichtfeld"

**Bei bestehenden Feldern (Bearbeiten-Modus):**
- "Gilt für"-Dropdown editierbar
- "Pflichtfeld"-Toggle editierbar
- Anzeige von Badges: "Pflichtfeld" / "Nur Aufmaß" / "Nur Aufmaß mit Plan"

**Sortierung reparieren:**
- Nach jedem Verschieben alle `sort_order`-Werte sequentiell neu vergeben (0, 1, 2, ...) statt nur zwei Werte zu tauschen
- Das verhindert Duplikate und macht die Reihenfolge deterministisch

#### 3. Standort-Erfassung (`src/pages/LocationDetails.tsx`)

- Projekt-Typ aus IndexedDB laden (`project.projectType`)
- Felder filtern: nur Felder anzeigen, deren `applies_to` entweder `'all'` oder dem aktuellen Projekttyp entspricht
- Bei Pflichtfeldern: Label ohne "(optional)", stattdessen mit Sternchen `*`
- Beim Speichern: Pflichtfelder validieren — wenn leer, Toast-Fehler und Speichern verhindern

#### 4. Edge Function (`supabase/functions/admin-manage/index.ts`)

- `create_field`: neue Parameter `appliesTo` und `isRequired` annehmen und speichern
- `update_field`: `applies_to` und `is_required` in `changes` akzeptieren (bereits generisch — funktioniert automatisch)
- `list_fields`: gibt die neuen Spalten automatisch mit zurück (da `select("*")`)

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| Neue Migration | `applies_to` + `is_required` Spalten, sort_order normalisieren |
| `src/pages/Admin.tsx` | UI für Aufmaßart-Zuordnung + Pflichtfeld + Sortierung-Fix |
| `src/pages/LocationDetails.tsx` | Felder nach Projekttyp filtern, Pflichtfeld-Validierung |
| `supabase/functions/admin-manage/index.ts` | `create_field` um neue Parameter erweitern |

### Was sich nicht ändert

- Keine Änderungen an Kundenansicht, Feedback, Floor Plans, Direktlinks
- Keine Änderungen an der Mitarbeiterverwaltung oder Passwort-Logik
- Keine Änderungen an bestehenden Projektdaten

