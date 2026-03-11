

## Plan: Zwei Projekttypen und Bilder-Upload

Dieses Feature umfasst zwei Hauptbereiche: (1) optionaler Bilder-Upload als Alternative zur Kamera, und (2) ein neuer Projekttyp "Aufmaß mit Plan" mit Grundriss-PDFs und platzierbaren Standort-Fähnchen.

---

### 1. Bilder-Upload als Kamera-Alternative (beide Projekttypen)

**Änderung in `ProjectDetail.tsx`**: Neben dem "Aufnehmen"-Button wird ein zweiter Button "Bild hochladen" eingefügt. Dieser öffnet einen nativen Datei-Picker (`<input type="file" accept="image/*">`), liest das Bild als base64 und navigiert direkt zum PhotoEditor (wie nach Kamera-Aufnahme).

**Änderung in `Camera.tsx`**: Zusätzlich zum Kamera-Feed wird ein Upload-Button angeboten, falls die Kamera nicht verfügbar ist oder der Nutzer bewusst ein Bild hochladen möchte.

---

### 2. Neuer Projekttyp "Aufmaß mit Plan"

#### 2a. Datenmodell-Erweiterungen

**`src/types/project.ts`** -- Neue Interfaces:

```typescript
export interface FloorPlanMarker {
  id: string;
  locationId: string;  // Verknüpfung zum Standort
  x: number;           // Position auf dem Grundriss (0-1, relativ)
  y: number;
}

export interface FloorPlan {
  id: string;
  name: string;        // z.B. "EG", "1. OG"
  imageData: string;   // Gerenderte PDF-Seite als Bild
  markers: FloorPlanMarker[];
  pageIndex: number;   // Welche Seite der PDF
  createdAt: Date;
}

export interface Project {
  id: string;
  projectNumber: string;
  projectType: 'aufmass' | 'aufmass_mit_plan';  // NEU
  floorPlans?: FloorPlan[];                       // NEU
  locations: Location[];
  createdAt: Date;
  updatedAt: Date;
}
```

**IndexedDB-Schema** (`indexedDBStorage.ts`): Neuer Object Store `floor-plans` mit Index `by-project` und `floor-plan-images` für die gerenderten Bilder als Blobs.

#### 2b. Projekt erstellen (`NewProject.tsx`)

Nach Eingabe der Projektnummer erscheint eine Auswahl (Radio-Buttons):
- **Aufmaß** -- Standard-Workflow wie bisher
- **Aufmaß mit Plan** -- Nach Erstellung wird man zum PDF-Upload weitergeleitet

#### 2c. PDF-Upload und Rendering

**Neue Seite `FloorPlanUpload.tsx`** (`/projects/:projectId/floor-plans/upload`):
- Datei-Picker für eine oder mehrere PDFs
- Jede PDF-Seite wird mit einem Canvas-basierten PDF-Renderer (mittels `pdfjs-dist`) als Bild gerendert
- Jede Seite wird als eigener Grundriss gespeichert, mit optionalem Namen (z.B. "Erdgeschoss")
- Nach Upload wird zur Grundriss-Ansicht navigiert

**Abhängigkeit**: `pdfjs-dist` wird als neues npm-Paket benötigt, um PDF-Seiten clientseitig zu Bildern zu rendern.

#### 2d. Grundriss-Ansicht mit Fähnchen

**Neue Seite `FloorPlanView.tsx`** (`/projects/:projectId/floor-plans`):
- Zeigt den aktuellen Grundriss als Bild (zoom- und panbar)
- Tabs oder Dropdown zum Wechseln zwischen mehreren Grundrissen
- **Tap auf Grundriss**: Platziert ein neues Fähnchen (Marker-Icon) an der geklickten Stelle und navigiert zum Standort-Erstellungs-Workflow (Kamera/Upload → Editor → LocationDetails)
- **Nach Speichern des Standorts**: Automatische Rückkehr zur Grundriss-Ansicht
- **Tap auf bestehendes Fähnchen**: Navigiert zum zugehörigen Standort (LocationCard-Ansicht)
- Fähnchen zeigen die Standortnummer als Label

#### 2e. ProjectDetail-Anpassung für "mit Plan"

Wenn `projectType === 'aufmass_mit_plan'`:
- Statt der Standort-Liste als Hauptansicht wird die **Grundriss-Ansicht** angezeigt
- Ein Button "Grundrisse verwalten" erlaubt das Hinzufügen weiterer PDFs
- Die Standort-Liste bleibt als sekundäre Ansicht verfügbar (z.B. als Tab)

#### 2f. PDF-Export-Erweiterung (`Export.tsx`)

Für "Aufmaß mit Plan"-Projekte:
- PDF beginnt mit den Grundriss-Seiten, wobei die Fähnchen mit Standortnummern eingezeichnet sind
- Danach folgen die einzelnen Standort-Seiten wie bisher
- Die Grundriss-Bilder mit Markern werden per Canvas gerendert und als Bild in die PDF eingefügt

---

### 3. Routing-Erweiterungen (`App.tsx`)

Neue Routes:
- `/projects/:projectId/floor-plans` -- Grundriss-Ansicht
- `/projects/:projectId/floor-plans/upload` -- PDF-Upload

---

### 4. Technische Details

**PDF-Rendering**: `pdfjs-dist` rendert jede Seite in ein `<canvas>`, das als PNG exportiert und in IndexedDB gespeichert wird. Dies vermeidet die Komplexität eines interaktiven PDF-Viewers.

**Marker-Positionierung**: Positionen werden relativ (0-1) gespeichert, damit sie bei unterschiedlichen Bildschirmgrößen korrekt dargestellt werden. Die Anzeige nutzt absolute Positionierung über dem Grundriss-Bild.

**Betroffene Dateien** (Änderungen und Neuerstellungen):
- `src/types/project.ts` -- Erweiterte Interfaces
- `src/lib/indexedDBStorage.ts` -- Neuer DB-Version-Upgrade, Floor-Plan-Stores
- `src/pages/NewProject.tsx` -- Projekttyp-Auswahl
- `src/pages/ProjectDetail.tsx` -- Bilder-Upload-Button, "mit Plan"-Logik
- `src/pages/Camera.tsx` -- Upload-Alternative
- `src/pages/FloorPlanUpload.tsx` -- NEU
- `src/pages/FloorPlanView.tsx` -- NEU
- `src/pages/LocationDetails.tsx` -- Rücknavigation zum Grundriss
- `src/pages/Export.tsx` -- Grundriss-Seiten in PDF
- `src/App.tsx` -- Neue Routes
- `package.json` -- `pdfjs-dist` Abhängigkeit

