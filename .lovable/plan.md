

## Projekt löschen direkt aus der Projektübersicht + Mehrfachauswahl

### Funktionsumfang

1. **Einzelnes Projekt löschen**: Trash-Icon auf jeder Projekt-Card, mit Bestätigungs-Dialog
2. **Mehrfachauswahl-Modus**: Button in der Header-Leiste aktiviert Checkboxen auf den Cards. Ausgewählte Projekte können gesammelt gelöscht werden.
3. **Löschung vollständig**: Lokal (IndexedDB via `deleteProject()`) UND remote (Supabase: Locations, Images, Detail-Images, Floor-Plans, Feedback, Approvals, PDFs, Assignments, dann Projekt selbst)

### Änderungen

**`src/pages/Projects.tsx`** — Hauptdatei

- State: `selectionMode` (boolean), `selectedIds` (Set)
- **Header**: Neuer "Auswählen"-Toggle-Button. Im Auswahlmodus: "X ausgewählt" + "Löschen"-Button (rot) + "Abbrechen"
- **Projekt-Cards**: Im Auswahlmodus Checkbox statt Navigation-Click. Im Normalmodus Trash-Icon-Button (mit `e.stopPropagation()`)
- **Bestätigungs-Dialog** (AlertDialog): Sowohl für Einzel- als auch Mehrfachlöschung. Text passt sich an ("1 Projekt" vs. "3 Projekte")
- **`deleteProjects(ids)`-Funktion**: 
  - Für jede ID: Supabase-Cascade-Delete (locations → location_images, detail_images, location_feedback, location_approvals, location_pdfs, floor_plans → project)
  - Lokal: `indexedDBStorage.deleteProject(id)`
  - Danach `loadProjects(false)` aufrufen

### UI-Verhalten

```text
Normal-Modus:
┌─────────────────────────────┐
│ 📂 Projekt-2025-001    [🗑] │
│ Erstellt am 15. Mar 2025    │
│ 3 Standorte                 │
└─────────────────────────────┘

Auswahl-Modus:
┌─────────────────────────────┐
│ ☑ 📂 Projekt-2025-001      │
│ Erstellt am 15. Mar 2025    │
│ 3 Standorte                 │
└─────────────────────────────┘
Header: [3 ausgewählt] [Löschen] [Abbrechen]
```

### Betroffene Datei

| Datei | Änderung |
|---|---|
| `src/pages/Projects.tsx` | Selection-Mode, Delete-Logik, AlertDialog, Trash-Icons |

