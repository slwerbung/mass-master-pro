

## Native Kamera-App statt eigener Kameraansicht nutzen

### Idee

Statt die Kamera selbst über `getUserMedia` zu steuern, kann man einfach ein `<input type="file" accept="image/*" capture="environment">` verwenden. Das öffnet automatisch die native Kamera-App des Smartphones — mit allen Funktionen wie Autofokus, HDR, Zoom, Blitz etc. Nach der Aufnahme wird das Foto direkt an die App zurückgegeben.

### Vorteile
- Alle Kamera-Features des Geräts verfügbar (Fokus, Zoom, Blitz, HDR)
- Kein eigener Kamera-Code nötig — weniger Fehlerquellen
- Funktioniert zuverlässig auf iOS und Android
- Nutzer kann auch aus der Galerie wählen

### Umsetzung

**`src/pages/Camera.tsx`** komplett vereinfachen:
- Die gesamte `getUserMedia`-Logik, Video-Stream, Canvas-Capture entfernen
- Stattdessen beim Laden der Seite automatisch einen versteckten `<input type="file" accept="image/*" capture="environment">` triggern
- Wenn der Nutzer ein Foto macht, wird es als Base64 gelesen und direkt zum Editor navigiert (wie bisher bei `confirmPhoto`)
- Wenn der Nutzer abbricht, zurück zur vorherigen Seite navigieren
- Optional: Vorschau des Fotos mit "OK" / "Neu"-Buttons beibehalten, oder direkt weiterleiten

### Änderungen

| Datei | Was |
|---|---|
| `src/pages/Camera.tsx` | `getUserMedia`/Video/Canvas entfernen; durch `<input capture="environment">` ersetzen, der beim Mount automatisch öffnet |

