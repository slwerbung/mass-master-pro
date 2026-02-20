

## Plan: Bluetooth-Fix, neue Felder, Supabase-Backend mit Gastzugang

Dieses Update umfasst 4 Bereiche: Bluetooth-Fix, neue Standort-Felder, Supabase-Datenbank-Setup und Gastzugang fuer Kunden.

---

### 1. Bluetooth Laser: Messwert-Empfang reparieren

**Problem**: Die Verbindung wird hergestellt, aber die Service-UUIDs (`00001101...`) sind fuer SPP (Serial Port Profile) gedacht, das Web Bluetooth nicht unterstuetzt. Die meisten Leica/Wuerth-Geraete bieten BLE-Services unter anderen UUIDs an.

**Loesung** in `src/components/MeasurementInputDialog.tsx`:
- `acceptAllDevices: true` beibehalten, damit der Nutzer sein Geraet findet
- Nach der Verbindung alle verfuegbaren Services auflisten (`server.getPrimaryServices()`) und alle Characteristics durchsuchen
- Jede Characteristic mit `notify`-Property abonnieren und auf eingehende Werte lauschen
- Zusaetzlich: Characteristics mit `read`-Property einmalig lesen (manche Geraete senden den letzten Messwert so)
- Robustere Wert-Erkennung: Regex fuer verschiedene Formate (z.B. `"1.234m"`, `"1234mm"`, `"D: 1.234"`)
- Debug-Log im UI anzeigen (kleiner Text unter dem Input), damit der Nutzer sieht, welche Rohdaten ankommen

```text
┌─────────────────────────────────┐
│ Maß eingeben                    │
│                                 │
│ Wert in mm: [1200          ]    │
│                                 │
│ [Bluetooth] Laser verbunden     │
│ Empfangen: "D: 1.200 m"        │ <-- Debug-Anzeige
│                                 │
│ [Abbrechen]  [Uebernehmen]     │
└─────────────────────────────────┘
```

---

### 2. Neue Standort-Felder: System, Beschriftung, Art

**Datei: `src/types/project.ts`**
```typescript
export interface Location {
  // ... bestehende Felder ...
  system?: string;        // z.B. "Tuerschilder"
  label?: string;         // Beschriftung
  locationType?: string;  // Art, z.B. "Raum", "Flur", "Eingang"
}
```

**Datei: `src/lib/indexedDBStorage.ts`**
- Location-Schema um die 3 neuen Felder erweitern (kein DB-Version-Upgrade noetig, da die Felder optional sind und IndexedDB schema-frei ist)
- `updateLocationMetadata` um die neuen Felder erweitern

**Datei: `src/pages/LocationDetails.tsx`**
- 3 neue Input-Felder hinzufuegen (System, Beschriftung, Art)
- In Edit-Modus bestehende Werte laden

**Datei: `src/components/LocationCard.tsx`**
- Neue Felder in der Standort-Karte anzeigen

---

### 3. Supabase-Backend einrichten

**Zuerst**: Supabase-Verbindung zum Projekt herstellen (Lovable Cloud oder externes Supabase-Projekt).

**Datenbank-Schema (Migration)**:

```sql
-- Projekte
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number TEXT NOT NULL,
  guest_password TEXT,          -- optionales Passwort fuer Gastzugang
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Standorte
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  location_number TEXT NOT NULL,
  location_name TEXT,
  comment TEXT,
  system TEXT,
  label TEXT,
  location_type TEXT,
  guest_info TEXT,              -- vom Gast ergaenzbare Informationen
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Bilder (URLs zu Supabase Storage)
CREATE TABLE public.location_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  image_type TEXT NOT NULL CHECK (image_type IN ('annotated', 'original')),
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Detailbilder
CREATE TABLE public.detail_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  caption TEXT,
  annotated_path TEXT NOT NULL,
  original_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Druckdaten-PDFs pro Standort
CREATE TABLE public.location_pdfs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

-- Storage Bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('project-files', 'project-files', true);
```

**RLS-Policies**:
- Authentifizierte Nutzer: Volles CRUD auf alle eigenen Projekte
- Oeffentlich (Gaeste): Nur SELECT auf Projekte + Standorte, UPDATE nur auf `guest_info` Feld
- Storage: Oeffentlicher Lesezugriff, Schreibzugriff nur fuer authentifizierte Nutzer

**Supabase-Client** in `src/integrations/supabase/client.ts` wird automatisch erstellt.

---

### 4. Gastzugang

**Neue Route**: `/guest/:projectId`

**Ablauf**:
1. Mitarbeiter teilt Link: `https://app.example.com/guest/abc-123`
2. Optional mit Passwort: Gast muss Passwort eingeben
3. Gast gibt seinen Namen ein (wird im Browser gespeichert)
4. Gast sieht alle Standorte des Projekts (read-only Bilder, Bemassungen)
5. Gast kann pro Standort ein Textfeld "Informationen" ausfuellen
6. Gast kann hochgeladene Druckdaten-PDFs ansehen/herunterladen

**Neue Dateien**:

| Datei | Beschreibung |
|-------|-----------|
| `src/pages/GuestAccess.tsx` | Passwort-/Namenseingabe |
| `src/pages/GuestProject.tsx` | Projekt-Ansicht fuer Gaeste (read-only Bilder, editierbare Info-Felder) |
| `src/components/GuestLocationCard.tsx` | Standort-Karte fuer Gaeste (ohne Bearbeitungs-Buttons, mit Info-Feld und PDF-Viewer) |

**PDF-Upload pro Standort** (fuer Mitarbeiter):
- In `LocationCard.tsx` einen "Druckdatei hochladen"-Button hinzufuegen
- Datei wird in Supabase Storage (`project-files/pdfs/`) gespeichert
- Gaeste koennen die PDF im Browser oeffnen (Link)

---

### 5. Datenmigration: IndexedDB zu Supabase

Da bestehende Projekte in IndexedDB liegen, wird eine einmalige Migration angeboten:
- Beim ersten Login erscheint ein Hinweis: "X lokale Projekte gefunden. Jetzt hochladen?"
- Bilder werden in Supabase Storage hochgeladen
- Projekt-Metadaten in die Datenbank geschrieben
- Nach erfolgreicher Migration werden lokale Daten geloescht

---

### Reihenfolge der Implementierung

1. **Bluetooth-Fix** (eine Datei, sofortiger Effekt)
2. **Neue Standort-Felder** (Datenmodell + UI, lokal)
3. **Supabase einrichten** (Verbindung herstellen, Schema-Migration)
4. **Daten-Layer umschreiben** (IndexedDB durch Supabase ersetzen)
5. **Gastzugang** (neue Seiten, RLS-Policies)
6. **PDF-Upload** (Storage + UI)
7. **Migration** (einmaliger Import)

### Technische Hinweise

- Die App bleibt weiterhin eine React-SPA (kein Server-Rendering)
- Bilder werden in Supabase Storage gespeichert statt als Base64 in der Datenbank
- Der Gastzugang benoetigt keine Registrierung, nur einen Namen
- Fuer den Gastzugang werden die RLS-Policies so gesetzt, dass `anon`-Nutzer lesen koennen und nur das `guest_info`-Feld aktualisieren duerfen

