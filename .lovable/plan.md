

## Fix: Flächenmaß-Daten gehen nach dem Speichern verloren

### Ursache

`areaMeasurements` wird an zwei Stellen in `indexedDBStorage.ts` nicht berücksichtigt:

1. **`saveProject()`** (Zeile 426-438): Speichert die Location-Records **ohne** `areaMeasurements` — das Feld geht beim Schreiben verloren
2. **`getLocationsByProject()`** (Zeile 270-284): Liest `areaMeasurements` **nicht** aus dem Record zurück — selbst wenn es gespeichert wäre, würde es nicht angezeigt

### Lösung: 2 Stellen in einer Datei

**`src/lib/indexedDBStorage.ts`**:

1. In `saveProject()` (Zeile 426-438): `areaMeasurements` mitspeichern:
```typescript
areaMeasurements: location.areaMeasurements ? JSON.stringify(location.areaMeasurements) : undefined,
```

2. In `getLocationsByProject()` (Zeile 270-284): `areaMeasurements` aus dem Record lesen:
```typescript
areaMeasurements: record.areaMeasurements ? JSON.parse(record.areaMeasurements) : undefined,
```

### Betroffene Datei

| Datei | Änderung |
|---|---|
| `src/lib/indexedDBStorage.ts` | 2 Zeilen ergänzen |

