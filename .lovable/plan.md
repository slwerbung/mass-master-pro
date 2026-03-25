

## Fix: Projektzuordnung wird beim Sync überschrieben

### Ursache

In `syncProjectInternal()` (supabaseSync.ts, Zeile 296-297) wird bei jedem Sync `employee_id` blind auf den aktuell eingeloggten Mitarbeiter gesetzt. Wenn also Gerg sich einloggt und ein Sync läuft, werden alle lokal vorhandenen Projekte Gerg zugeordnet — egal wer sie erstellt hat. Dasselbe Problem existiert in `CustomerManage.tsx` (Zeile 78-82).

### Lösung

**1. Sync-Bug fixen** (`src/lib/supabaseSync.ts`)
- In `syncProjectInternal()`: Vor dem Upsert den bestehenden `employee_id` aus der Datenbank lesen. Wenn bereits ein Owner existiert, diesen beibehalten statt mit der aktuellen Session zu überschreiben. Nur bei neuen Projekten (kein Remote-Eintrag) den aktuellen Mitarbeiter setzen.

**2. CustomerManage-Bug fixen** (`src/pages/CustomerManage.tsx`)
- Beim Upsert in `addAssignment()`: Ebenfalls den bestehenden Owner nicht überschreiben. Stattdessen nur `id` und `project_number` upserten, ohne `employee_id`/`user_id` zu ändern.

**3. Datenbereinigung**
- Die 6 Projekte, die fälschlicherweise Gerg (2d70acc0) zugeordnet sind, werden Layer (fa5dcbdf) zugeordnet:
  - WER-1712, WER-1707, WER-1616, WER-1558, WER-1234, WER-1612
- WER-1684 bleibt bei Langner (755afadb) — das ist korrekt.

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/lib/supabaseSync.ts` | `employee_id` nicht mehr blind überschreiben |
| `src/pages/CustomerManage.tsx` | Upsert ohne Owner-Überschreibung |
| Datenbank (UPDATE) | 6 Projekte von Gerg → Layer umschreiben |

