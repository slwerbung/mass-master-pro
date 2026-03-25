

## Logikfehler: Projekttyp geht beim Neuladen verloren

### Problem
Der `projectType` wird nur lokal in IndexedDB gespeichert, aber nie in die Datenbank synchronisiert. Wenn das Projekt aus der Cloud geladen wird (`hydrateProjectFromSupabase`), fehlt der Typ — das Projekt wird als normales "Aufmaß" behandelt.

### Lösung

**1. Datenbank-Migration** — Neue Spalte `project_type` in der `projects`-Tabelle:
```sql
ALTER TABLE projects ADD COLUMN project_type text DEFAULT 'aufmass';
```

**2. `src/lib/supabaseSync.ts`**
- `hydrateProjectFromSupabase`: `project_type` aus der DB lesen und ins Project-Objekt übernehmen
- `syncProjectToSupabase`: `project_type` beim Upsert mitsenden

**3. `src/pages/NewProject.tsx`**
- Beim Erstellen den `project_type` auch in den Supabase-Upsert aufnehmen (aktuell fehlt er dort)

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| Migration | `project_type` Spalte hinzufügen |
| `src/lib/supabaseSync.ts` | Typ lesen und schreiben |
| `src/pages/NewProject.tsx` | Typ beim DB-Insert mitsenden |

