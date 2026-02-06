

## Plan: 4 Verbesserungen

### 1. PDF-Export: Unverzerrte Bilder + Optionen sichtbar

**Problem**: Die `addImage`-Funktion in jsPDF bekommt Pixel-Dimensionen und rechnet korrekt, aber die Export-Optionen (Collapsible) sind moeglicherweise nicht sichtbar oder die Bildverhaeltnisse stimmen nicht.

**Loesung** in `src/pages/Export.tsx`:
- Sicherstellen, dass `getImageDimensions` korrekt aufgeloest wird (Fallback bei Fehler)
- Bei `pdf.addImage` explizit das Seitenverhaeltnis des Originalbildes beibehalten
- Die `PDFExportOptionsUI`-Komponente prominenter darstellen (standardmaessig aufgeklappt oder mit klarem Hinweis)
- Testen, dass bei 2 Bildern die Hoehe korrekt aufgeteilt wird

**Technische Aenderung**: In `exportAsPDF` die Ratio-Berechnung pruefen und sicherstellen, dass `contentWidth` (170mm) und `maxHeightPerImage` korrekt als Grenzen verwendet werden. Das Bild wird zentriert und proportional skaliert.

---

### 2. Bemassungstext parallel zur Linie

**Datei**: `src/lib/measurement.ts`

**Aktuell**: Der Text wird senkrecht zur Linie versetzt positioniert, aber nicht gedreht. Er steht immer horizontal.

**Neu**: Der Text wird um den Winkel der Linie gedreht und leicht unterhalb der Linie positioniert.

```text
Aktuell:           Neu:
                        120 mm
   120 mm          ─────────────────
─────────────────
```

**Technische Aenderung**:
- Winkel berechnen: `angle = Math.atan2(dy, dx) * (180 / Math.PI)`
- `text.angle = angle` setzen (Fabric.js Rotation)
- Text unterhalb der Linie positionieren statt oberhalb (negativer Perpendikular-Offset)
- Falls Linie von rechts nach links verlaeuft (angle > 90 oder < -90): Text um 180 Grad drehen, damit er nicht auf dem Kopf steht

---

### 3. Standorte nachtraeglich bearbeiten

**Neue Route**: `/projects/:projectId/locations/:locationId/edit`

**Aenderungen**:

| Datei | Aenderung |
|-------|-----------|
| `src/App.tsx` | Neue Route hinzufuegen |
| `src/pages/ProjectDetail.tsx` | "Bearbeiten"-Button pro Standort (Stift-Icon neben Loeschen) |
| `src/pages/LocationDetails.tsx` | Erweitern fuer Edit-Modus: bestehende Daten laden, Standortname/Kommentar aendern, speichern |
| `src/lib/indexedDBStorage.ts` | `updateLocation`-Methode hinzufuegen (Metadaten aktualisieren ohne Bilder neu zu speichern) |

**Ablauf**:
1. Nutzer klickt "Bearbeiten" auf einem Standort
2. LocationDetails oeffnet sich mit vorausgefuellten Feldern (Name, Kommentar)
3. Bild wird als Vorschau angezeigt (nicht editierbar - dafuer gibt es Feature 4)
4. Nutzer aendert Felder und speichert

---

### 4. Detailbilder zu Standorten hinzufuegen

**Datenmodell-Erweiterung** in `src/types/project.ts`:

```typescript
export interface DetailImage {
  id: string;
  imageData: string;      // bearbeitetes Bild
  originalImageData: string; // Originalbild
  caption?: string;       // optionale Beschreibung
  createdAt: Date;
}

export interface Location {
  // ... bestehende Felder ...
  detailImages?: DetailImage[];  // neue Eigenschaft
}
```

**IndexedDB-Schema**: Da das Schema Version 1 ist, muss ein Upgrade auf Version 2 erfolgen:
- Neuer Object Store `detail-images` mit Index `by-location`
- Gleiche Blob-Speicherung wie bei Hauptbildern

**Aenderungen**:

| Datei | Aenderung |
|-------|-----------|
| `src/types/project.ts` | `DetailImage` Interface + `detailImages` Feld |
| `src/lib/indexedDBStorage.ts` | DB Version 2, neuer Store, Lade-/Speicher-Logik fuer Detailbilder |
| `src/pages/ProjectDetail.tsx` | Anzeige der Detailbilder unter jedem Standort + "Detailbild hinzufuegen"-Button |
| `src/App.tsx` | Route fuer Detailbild-Kamera und -Editor |
| `src/pages/PhotoEditor.tsx` | Unterstuetzung fuer "Detailbild-Modus" (speichert als Detailbild statt Hauptbild) |
| `src/pages/Export.tsx` | Detailbilder optional im PDF und ZIP mit exportieren |

**Ablauf**:
1. Nutzer oeffnet Standort-Ansicht
2. Klickt "Detailbild hinzufuegen"
3. Kamera oeffnet sich -> Foto aufnehmen
4. PhotoEditor oeffnet sich -> Bearbeiten
5. Bild wird als Detailbild zum Standort gespeichert
6. Detailbilder koennen nachtraeglich bearbeitet werden (gleicher Editor)

---

### Reihenfolge der Implementierung

1. **Bemassungstext** (schnelle Aenderung, eine Datei)
2. **PDF-Export Bilder-Fix** (Export.tsx)
3. **Standorte bearbeiten** (mehrere Dateien, aber einfache Logik)
4. **Detailbilder** (groesste Aenderung: Schema-Upgrade, neue Routes, UI)

