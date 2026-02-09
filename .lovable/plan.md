

## Plan: 3 Verbesserungen

### 1. Bemassungstext parallel und unterhalb der Linie

**Datei: `src/lib/measurement.ts`**

Der aktuelle Code berechnet den Winkel korrekt und setzt `angle` auf dem Text. Allerdings ist die Positionierung mit `- px * textOffset` moeglicherweise nicht konsistent "unterhalb". Das Problem: Der Perpendikular-Vektor `(px, py) = (-dy/len, dx/len)` zeigt je nach Linienrichtung mal nach oben, mal nach unten.

**Loesung**: Nach dem Flip des Winkels (wenn >90 oder <-90) muss auch der Offset-Vektor angepasst werden, damit der Text immer auf der gleichen Seite (unterhalb) landet. Konkret:
- Wenn der Winkel geflippt wird, den Offset-Vektor umkehren
- `originY: "top"` beibehalten, damit der Text vom Ankerpunkt nach unten waechst
- `textOffset` leicht erhoehen fuer bessere Lesbarkeit

---

### 2. Alle Bilder nachtraeglich bearbeiten

Aktuell fuehrt der "Bearbeiten"-Button (Stift) nur zur Metadaten-Bearbeitung (Name/Kommentar). Bilder koennen nicht nochmal im PhotoEditor geoeffnet werden.

**Aenderungen**:

| Datei | Aenderung |
|-------|-----------|
| `src/components/LocationCard.tsx` | Klick auf das Hauptbild oeffnet den Editor mit dem gespeicherten Bild. Klick auf Detailbilder ebenfalls. |
| `src/pages/PhotoEditor.tsx` | Neuen Modus "re-edit" unterstuetzen: Bild aus IndexedDB laden statt aus `location.state`, nach Speichern das bestehende Bild in IndexedDB aktualisieren statt neuen Standort zu erstellen. |
| `src/lib/indexedDBStorage.ts` | `updateLocationImage(projectId, locationId, imageData)` Methode hinzufuegen. `updateDetailImage(detailId, imageData)` Methode hinzufuegen. |
| `src/App.tsx` | Neue Routen: `/projects/:projectId/locations/:locationId/edit-image` und `/projects/:projectId/locations/:locationId/details/:detailId/edit-image` |

**Ablauf Hauptbild bearbeiten**:
1. Nutzer klickt auf Bild-Icon/Button am Standort
2. PhotoEditor oeffnet sich mit dem gespeicherten bemassten Bild
3. Nutzer bearbeitet und klickt Haekchen
4. Bild wird direkt in IndexedDB aktualisiert (kein neuer Standort)
5. Zurueck zur Projektansicht

**Ablauf Detailbild bearbeiten**:
1. Nutzer klickt auf ein Detailbild
2. PhotoEditor oeffnet sich mit dem Detailbild
3. Nach Bearbeitung wird das Detailbild aktualisiert

---

### 3. Detailbilder optional im PDF exportieren

**Datei: `src/components/PDFExportOptions.tsx`**

Neue Option hinzufuegen:
```typescript
interface PDFExportOptions {
  // ... bestehende Optionen ...
  includeDetailImages: boolean;  // NEU
}
```

Neue Checkbox im "Bilder"-Bereich: "Detailbilder"

**Datei: `src/pages/Export.tsx`**

In `exportAsPDF`:
- Nach dem Hauptbild/Originalbild die Detailbilder eines Standorts rendern
- Jedes Detailbild bekommt eigenen Platz, proportional skaliert
- Bei vielen Detailbildern: Auf Folgeseiten umbrechen (nur Detailbilder duerfen ueber Seitengrenzen gehen, Hauptinhalt bleibt auf einer Seite)
- Caption des Detailbilds als kleine Beschriftung unter dem Bild

Layout wenn Detailbilder aktiviert:
```
Seite 1: Header + Hauptbild(er) + Kommentar + Datum
Seite 2 (falls noetig): Detailbilder des Standorts
```

Die verfuegbare Hoehe fuer Hauptbilder wird dynamisch berechnet - wenn keine Detailbilder vorhanden sind, aendert sich nichts am bestehenden Layout.

---

### Zusammenfassung

| Datei | Aenderung |
|-------|-----------|
| `src/lib/measurement.ts` | Text-Offset korrigieren fuer konsistentes "unterhalb" |
| `src/components/LocationCard.tsx` | Bild-Bearbeiten-Buttons hinzufuegen |
| `src/pages/PhotoEditor.tsx` | Re-Edit-Modus (Bild aus DB laden, zurueck speichern) |
| `src/lib/indexedDBStorage.ts` | `updateLocationImage` + `updateDetailImage` Methoden |
| `src/App.tsx` | Neue Routen fuer Bild-Bearbeitung |
| `src/components/PDFExportOptions.tsx` | Option "Detailbilder" hinzufuegen |
| `src/pages/Export.tsx` | Detailbilder im PDF rendern |

