

## Problem

In `CustomerManage.tsx` werden Projektzuweisungen mit der internen UUID angezeigt statt mit der Projektnummer, wenn das Projekt nicht lokal in IndexedDB vorhanden ist. Der Fallback `a.project_id.slice(0, 8)` zeigt die ersten 8 Zeichen der UUID.

## Lösung

Beim Laden der Zuweisungen zusätzlich die `projects`-Tabelle aus der Cloud joinen, um die Projektnummer zu bekommen:

**`src/pages/CustomerManage.tsx`** — Zwei Änderungen:

1. **Zeile 43**: Den Supabase-Query um einen Join auf `projects` erweitern:
   ```
   .select("id, customer_id, project_id, customers(name), projects(project_number)")
   ```

2. **Zeile 49**: Beim Enrichment die Cloud-Projektnummer als Fallback nutzen:
   ```
   projectNumber: proj?.projectNumber || (a as any).projects?.project_number || a.project_id.slice(0, 8)
   ```

### Betroffene Datei
- `src/pages/CustomerManage.tsx` (2 Zeilen)

### Was sich nicht ändert
- Keine anderen Dateien, keine DB-Änderungen, keine UI-Layout-Änderungen

