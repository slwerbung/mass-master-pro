

## Plan: Flächenaufmaß-Zusammenfassung, Kundenkommentar-Löschfehler, Präfix-Bug

### 1. Flächenaufmaß-Zusammenfassung in Standortdetails

**Problem**: Die Flächen werden nur in der LocationCard (Projektübersicht) angezeigt, nicht in den Standortdetails selbst. Beim erneuten Bearbeiten startet die Zählung von F1 neu statt fortzufahren.

**Lösung**:

**`src/pages/LocationDetails.tsx`**:
- Beim Laden eines bestehenden Standorts (Edit-Mode) die `areaMeasurements` aus der Location lesen und als State speichern
- Zusammenfassung unterhalb des Bildes anzeigen (gleiche Darstellung wie in LocationCard): Einzelflächen + Gesamt-m²
- Wenn neue `stateAreaMeasurements` vom PhotoEditor kommen, diese mit den bestehenden mergen (bestehende behalten, neue anhängen)

**`src/pages/PhotoEditor.tsx`** — Zeile 200-207 (`getNextAreaIndex`):
- Beim Re-Edit eines Standorts: Bestehende `areaMeasurements` aus IndexedDB laden, um den höchsten Index zu kennen
- `getNextAreaIndex` berücksichtigt sowohl Canvas-Objekte als auch gespeicherte Measurements
- Beim Speichern (Zeile 256-259): Bestehende + neue Area Measurements zusammenführen statt nur die neuen zu speichern

**`src/pages/LocationDetails.tsx`** — Zusammenführung beim Speichern:
- Neue `stateAreaMeasurements` werden an bestehende `location.areaMeasurements` angehängt (nicht ersetzt)

### 2. Kundenkommentare löschen — Fehler fixen

**Problem**: Die `deleteFeedback`-Funktion in `CustomerView.tsx` (Zeile 479-481) ruft `customer-data` mit `assignmentId` auf. Die Edge Function prüft ob die Assignment zum Customer gehört. Das sollte funktionieren — aber der Fehler liegt wahrscheinlich daran, dass `selectedAssignment` nicht gesetzt ist oder dass die `assignmentId` `undefined` ist, wenn der Kunde nur eine Zuweisung hat und `selectedAssignment` nicht initialisiert wurde.

**Lösung** in `CustomerView.tsx`:
- Prüfen ob `selectedAssignment?.id` definiert ist bevor der Delete aufgerufen wird
- Fallback: Assignment-ID aus dem Feedback-Kontext ableiten (die Funktion wird innerhalb einer Assignment-Iteration aufgerufen, also ist die Assignment bekannt)
- Sicherstellen, dass bei einem einzelnen Projekt `selectedAssignment` korrekt gesetzt wird

### 3. Projekt-Präfix — Netzwerkfehler + leerer Präfix

**Problem**: `invoke` in Admin.tsx (Zeile 84) wirft `"Network error"` wenn `supabase.functions.invoke` einen `error` zurückgibt. Das kann passieren wenn die Edge Function einen Fehler im Response-Body hat, aber die `invoke`-Funktion unterscheidet nicht zwischen echtem Netzwerk-Error und einem Antwort-Body mit Error.

Zweites Problem: Der `set_project_prefix`-Handler trimmt den Wert (Zeile 242). Ein leerer String `""` ist valide für `value TEXT NOT NULL`, aber logisch sollte das System dann keinen Präfix verwenden.

**Lösung**:

**`src/pages/Admin.tsx`**:
- `invoke`-Funktion (Zeile 80-87): Bessere Fehlerbehandlung — den eigentlichen Fehlertext aus `data?.error` oder `error?.message` durchreichen statt generisches "Network error"
- UI erlaubt leeren Präfix mit Hinweis "Kein Präfix"

**`supabase/functions/admin-manage/index.ts`** — Zeile 242:
- Leeren Präfix-Wert akzeptieren (kein `.trim()` das schon korrekt ist, aber sicherstellen dass leerer String als `""` gespeichert wird)

**`src/pages/NewProject.tsx`**:
- Wenn Präfix leer ist, Projektnummer ohne Präfix generieren

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/pages/LocationDetails.tsx` | Flächen-Zusammenfassung anzeigen, Merge beim Speichern |
| `src/pages/PhotoEditor.tsx` | Bestehende Flächen-Indizes laden, Merge beim Re-Edit-Save |
| `src/pages/CustomerView.tsx` | `deleteFeedback` Assignment-ID sicherstellen |
| `src/pages/Admin.tsx` | `invoke` Fehlerbehandlung verbessern, leerer Präfix erlaubt |
| `src/pages/NewProject.tsx` | Leeren Präfix korrekt handhaben |

### Was sich nicht ändert
- Keine DB-Migrationen nötig
- Keine Edge-Function-Änderungen (Logik ist korrekt, Problem liegt client-seitig)
- Keine UI-Layout-Änderungen an anderen Seiten

