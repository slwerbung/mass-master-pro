

## Fix: Erstelldatum statt Sync-Datum anzeigen

### Problem
Die Projektkarten zeigen `updated_at` an (Zeile 61, 179), das bei jedem Sync überschrieben wird. Dadurch steht dort immer das letzte Sync-Datum statt dem tatsächlichen Erstelldatum.

### Lösung

**`src/pages/Projects.tsx`** — 3 kleine Änderungen:

1. **`ProjectListItem` Interface**: `updatedAt` umbenennen zu `createdAt` (oder neues Feld hinzufügen)
2. **Query anpassen** (Zeile 38): `created_at` statt `updated_at` aus Supabase laden — Query wird zu `select("id, project_number, created_at, employee_id")`
3. **Merge-Logik** (Zeile 61): `createdAt: new Date(sp.created_at)` statt `updated_at`
4. **Anzeige** (Zeile 179): `project.createdAt` anzeigen, Label ggf. auf "Erstellt am" anpassen

Die Sortierung kann wahlweise nach `created_at` (chronologisch) oder weiterhin nach `updated_at` (zuletzt bearbeitet oben) erfolgen — je nach Wunsch.

