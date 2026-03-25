

## Kamera/Hochladen-Auswahl beim Standort platzieren

### Problem
Nach dem Platzieren eines Markers auf dem Grundriss wird direkt zur Camera-Seite navigiert, die automatisch die native Kamera öffnet. Der Nutzer sieht kurz "Kamera wird geöffnet…" mit einem schlecht sichtbaren Button. Es fehlt die Wahl zwischen Kamera und Datei-Upload.

### Lösung

**Zwei Änderungen:**

**1. `src/pages/FloorPlanView.tsx`** — Nach Marker-Platzierung nicht mehr direkt zu `/camera` navigieren, sondern ein Dialog/Modal anzeigen mit zwei Buttons:
- **"Kamera"** → navigiert zu `/camera` (wie bisher, öffnet native Kamera)
- **"Hochladen"** → navigiert zu `/camera` mit einem Query-Parameter `?mode=upload` (oder öffnet direkt einen File-Picker)

State hinzufügen: `pendingLocationId` und `showCaptureDialog`. Nach Marker-Platzierung Dialog zeigen statt sofort zu navigieren.

**2. `src/pages/Camera.tsx`** — Den `mode=upload` Query-Parameter auswerten:
- `mode=upload`: File-Input **ohne** `capture="environment"` öffnen (zeigt nur Datei-Auswahl/Galerie)
- Standard (kein mode oder `mode=camera`): File-Input **mit** `capture="environment"` wie bisher (öffnet native Kamera)

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/pages/FloorPlanView.tsx` | Dialog mit "Kamera" / "Hochladen" nach Marker-Platzierung |
| `src/pages/Camera.tsx` | `mode` Query-Param auswerten, `capture` Attribut bedingt setzen |

