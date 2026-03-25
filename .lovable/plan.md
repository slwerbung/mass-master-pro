

## Performance-Fix: Laden und Speichern massiv beschleunigen

### Problem

Drei Stellen laden unnötig alle Bilder aus IndexedDB und konvertieren sie zu Base64:

1. **Projektliste** (`Projects.tsx`): `getProjects()` lädt alle Bilder aller Projekte — nur um Standorte zu zählen
2. **Standort speichern** (`LocationDetails.tsx`): `syncProjectToSupabase()` ruft `getProject()` auf, das alle Bilder lädt, und dann nochmal `saveProject()` das alle Bilder zurückschreibt
3. **Hintergrund-Sync** (`syncAllToSupabase`): Lädt alle Projekte mit allen Bildern

Auf Mobilgeräten dauert jede Blob→Base64-Konvertierung ~100-500ms pro Bild. Bei 10 Standorten mit je 2 Bildern = 20-60 Sekunden.

### Lösung: 3 Dateien ändern

**1. `src/lib/indexedDBStorage.ts`** — Neue leichtgewichtige Methode

Neue Methode `getProjectsSummary()` die nur Metadaten + Standort-Anzahl zurückgibt, ohne Bilder zu laden. Zusätzlich `getProjectIds()` für den Sync.

**2. `src/pages/Projects.tsx`** — Summary statt Vollladung

- `getProjects()` durch `getProjectsSummary()` ersetzen
- `syncAllToSupabase()` mit `setTimeout` entkoppeln, damit die Liste sofort erscheint

**3. `src/lib/supabaseSync.ts`** — Sync ohne Vollladung

Das Hauptproblem: `syncProjectInternal()` lädt das gesamte Projekt mit allen Bildern (Zeile 273), nur um Metadaten + Bilder zu syncen. Stattdessen:

- Projekt-Metadaten direkt aus IndexedDB lesen (ohne Bilder)
- Standort-Records direkt lesen (ohne Blob-Konvertierung)
- Bilder nur als Blobs an Storage hochladen (kein Base64-Umweg)
- `saveProject()` am Ende entfernen — nur `updatedAt` auf dem Projekt-Record aktualisieren
- `syncAllToSupabase()`: `getProjectIds()` statt `getProjects()` verwenden

**4. `src/pages/Auth.tsx`** — Session-Cache nach Login setzen

Nach erfolgreichem Login den Session-Cache sofort setzen, damit der RoleGuard beim Navigate keinen Edge-Function-Aufruf mehr braucht.

### Erwartete Verbesserung

| Aktion | Vorher | Nachher |
|---|---|---|
| Projektliste laden | 10-30s | < 500ms |
| Standort speichern | 30-60s | 2-5s |
| Navigation nach Login | 3-5s | sofort |

### Betroffene Dateien

- `src/lib/indexedDBStorage.ts` — 2 neue Methoden
- `src/pages/Projects.tsx` — Summary-Methode nutzen
- `src/lib/supabaseSync.ts` — Bilder direkt als Blob syncen, kein Base64-Roundtrip
- `src/pages/Auth.tsx` — Session-Cache setzen

