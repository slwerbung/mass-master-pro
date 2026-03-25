

## Fix: Stabile Projektliste mit korrekten Standortzahlen

### Probleme

1. **Standortzahl = 0 bei nicht-lokalen Projekten**: Zeile 56 liest `local?.locations?.length || 0`. Wenn ein Projekt nur in der Cloud existiert (nicht in IndexedDB), ist `local` undefined und die Zahl ist immer 0.
2. **Projekte erscheinen/verschwinden**: Nach dem initialen Render läuft `syncAllToSupabase()` im Hintergrund (Zeile 81). Der Sync kann lokale Daten überschreiben (`remote-won`), aber die UI wird danach nicht aktualisiert. Beim nächsten Laden sieht die Liste anders aus.

### Lösung

**Eine Datei: `src/pages/Projects.tsx`**

**1. Location-Counts aus der Datenbank laden**
- Parallel zum bestehenden Projekt-Query einen zweiten Query ausführen:
  ```sql
  SELECT project_id, COUNT(*) FROM locations GROUP BY project_id
  ```
  (via `supabase.from("locations").select("project_id")` und clientseitig gruppieren, da Supabase JS kein GROUP BY hat)
- Beim Merge: `locationCount` = lokale Zahl wenn vorhanden, sonst DB-Count
- So zeigen auch "Nur online"-Projekte korrekte Zahlen

**2. Nach Background-Sync die Liste neu laden**
- Ein `skipSync`-Flag einführen (z.B. via useRef)
- In `loadProjects()`: Sync nur ausführen wenn `skipSync` nicht gesetzt
- Nach dem Sync: `skipSync = true` setzen, dann `loadProjects()` erneut aufrufen
- So aktualisiert sich die UI nach jedem Sync-Durchlauf, ohne Endlosschleife

### Ablauf

```text
loadProjects(syncAfter = true):
  1. Projekte aus Supabase laden
  2. Location-Counts aus Supabase laden (parallel)
  3. Lokale Projekte aus IndexedDB laden (parallel)
  4. Merge: locationCount = lokal ?? DB-Count
  5. Rendern
  6. Wenn syncAfter: await syncAllToSupabase() → loadProjects(syncAfter = false)
```

