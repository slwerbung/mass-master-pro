

## Fix: Bildvorschau verzieht Proportionen beim Orientierungswechsel

### Problem

Das `<img>`-Element für das aufgenommene Foto nutzt `w-full h-full object-contain` innerhalb eines Flex-Containers. Wenn das Gerät nach der Aufnahme im Querformat ins Hochformat gedreht wird, ändert sich der Container, aber das Bild behält seine natürlichen Proportionen nicht korrekt bei — der Container zwingt es in die falsche Dimension.

### Lösung

Das `<img>`-Tag braucht explizite Constraints, damit `object-contain` korrekt wirkt:
- `max-w-full` und `max-h-full` statt `w-full h-full` verwenden
- Zusätzlich `w-auto h-auto` setzen, damit das Bild seine natürlichen Proportionen behält und sich nur innerhalb des verfügbaren Platzes skaliert

### Änderung

| Datei | Änderung |
|---|---|
| `src/pages/Camera.tsx` (Zeile 148) | `className` von `w-full h-full object-contain` auf `max-w-full max-h-full w-auto h-auto object-contain` ändern |

