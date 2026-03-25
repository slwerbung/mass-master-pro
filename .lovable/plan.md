

## Flächenaufmaß optimieren (aktualisierter Plan)

### Änderungen

**1. Labels innerhalb der Fläche, entlang der Kanten** (`src/lib/areaMeasurement.ts`)

Statt die Labels außerhalb des Rechtecks zu positionieren, werden sie **innerhalb** platziert — so kommen sich benachbarte Flächen nicht in die Quere:

- **Breite-Label**: Zentriert auf der oberen Kante, leicht nach innen versetzt, horizontal ausgerichtet (wie beim Linien-Aufmaß mit dynamischer Schriftgröße)
- **Höhe-Label**: Zentriert auf der linken Kante, leicht nach innen versetzt, 90° gedreht, Text läuft parallel zur Kante
- **Index-Badge** (`F 1`, `F 2`): Bleibt in der oberen linken Ecke innerhalb des Rechtecks
- **m²-Label entfernen**: Wird nur noch in der Zusammenfassung angezeigt, nicht auf dem Canvas

Schriftgröße und Padding skalieren dynamisch basierend auf der Kantenlänge (gleiche Logik wie `createMeasurementGroup`).

**2. Genauigkeit der Platzierung** (`src/pages/PhotoEditor.tsx`)

Pointer-Koordinaten via `fabricCanvas.getScenePoint(e.e)` als primäre Quelle nutzen statt `e?.scenePoint || e?.absolutePointer` — liefert exakte Canvas-Koordinaten unabhängig von Zoom/Pan.

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/lib/areaMeasurement.ts` | Labels innerhalb der Fläche entlang Kanten positionieren, Höhe-Label 90° rotiert, m²-Label entfernen |
| `src/pages/PhotoEditor.tsx` | `getScenePoint(e.e)` für präzisere Koordinaten |

