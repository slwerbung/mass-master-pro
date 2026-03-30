

## Fix: Projektseiten laden sehr lange

### Ursache

`hydrateProjectFromSupabase` lädt **jedes Bild einzeln und sequentiell** herunter: Standortbilder, Detailbilder und Grundrisse werden nacheinander per `pathToBase64` (fetch → blob → FileReader) verarbeitet. Bei einem Projekt mit z.B. 20 Standorten mit je 2 Bildern sind das 40+ sequentielle HTTP-Requests.

Zusätzlich wird `hydrateProjectFromSupabase` auch aufgerufen, wenn ein lokales Projekt existiert aber eine neuere Remote-Version erkannt wird — d.h. auch bei normalem Laden wird alles neu heruntergeladen.

### Lösung

1. **Bilder parallel laden** (`src/lib/supabaseSync.ts`):
   - Location-Images: `Promise.all` statt `for...of`-Loop
   - Detail-Images: `Promise.all` statt `for...of`-Loop  
   - Floor-Plans: `Promise.all` statt `for...of`-Loop

2. **Lokales Projekt sofort anzeigen** (`src/pages/ProjectDetail.tsx`):
   - Wenn ein lokales Projekt vorhanden ist, dieses sofort anzeigen (`setProject`, `setIsLoading(false)`)
   - Remote-Timestamp-Check und Hydration im Hintergrund ausführen
   - Nur wenn Remote neuer ist, Projekt im Hintergrund aktualisieren

### Änderungen

**`src/lib/supabaseSync.ts`** — 3 sequentielle Loops durch `Promise.all` ersetzen:

```typescript
// Vorher (sequentiell):
for (const row of imageRows || []) {
  const base64 = await pathToBase64(row.storage_path);
  ...
}

// Nachher (parallel):
await Promise.all((imageRows || []).map(async (row) => {
  const base64 = await pathToBase64(row.storage_path);
  ...
}));
```

Gleiche Änderung für Detail-Images und Floor-Plans.

**`src/pages/ProjectDetail.tsx`** — Lokales Projekt sofort anzeigen, Remote-Check in den Hintergrund verschieben:

```typescript
// Lokales Projekt sofort setzen
if (localProject) {
  setProject(localProject);
  setIsLoading(false);
  
  // Remote-Check im Hintergrund
  getProjectRemoteTimestamp(projectId).then(async (remoteUpdatedAt) => {
    if (remoteUpdatedAt && remoteUpdatedAt.getTime() > localProject.updatedAt.getTime() + 1000) {
      const hydrated = await hydrateProjectFromSupabase(projectId);
      if (hydrated) {
        setProject(hydrated);
        setConflictNotice("Neuere Online-Version geladen.");
      }
    }
  });
  return;
}
```

### Erwarteter Effekt

- Lokale Projekte: **sofortige Anzeige** (kein Warten auf Remote-Check)
- Online-Projekte: **3-5x schneller** durch paralleles Laden aller Bilder

