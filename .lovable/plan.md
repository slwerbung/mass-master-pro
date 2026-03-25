

## Fix: Mitarbeiter sieht Projekte anderer Mitarbeiter

### Ursache

Die Filterung geschieht aktuell **nur client-seitig** (`eq("employee_id", session.id)`). Es gibt keine serverseitige Absicherung — die RLS-Policy auf `projects` erlaubt `anon` uneingeschränkten SELECT (`USING (true)`). Wenn z.B. zwei Mitarbeiter dasselbe Gerät nutzen oder der Client-Filter durch einen Edge-Case nicht greift, werden alle Projekte angezeigt.

### Lösung

Zweistufige Absicherung:

1. **Client-seitig** (bereits vorhanden, verifiziert): `eq("employee_id", session.id)` — funktioniert korrekt

2. **IndexedDB-Bereinigung beim Login**: Beim Mitarbeiter-Login die lokale IndexedDB leeren, damit keine Projekte eines vorherigen Mitarbeiters auf demselben Gerät übrig bleiben. Das ist vermutlich die Hauptursache — wenn Mitarbeiter A sich auf einem Gerät anmeldet, sind lokal noch Projekte von Mitarbeiter B in IndexedDB gespeichert, und diese werden in die Merge-Logik einbezogen.

### Änderungen

| Datei | Änderung |
|---|---|
| `src/pages/Auth.tsx` | Beim Mitarbeiter-Login: IndexedDB leeren, wenn sich der Mitarbeiter-ID ändert (vorherige Session war ein anderer Mitarbeiter) |
| `src/pages/Projects.tsx` | Lokale Projekte für Mitarbeiter komplett ausblenden — nur Supabase-Ergebnisse anzeigen (die bereits gefiltert sind) |

### Detail

**`src/pages/Projects.tsx`**: In der Merge-Logik (Zeile 67-90) für Mitarbeiter auch die lokalen Projekte, die in der Supabase-Antwort enthalten sind, nicht aus IndexedDB anreichern — stattdessen nur reine Supabase-Daten verwenden. Lokale Projekte (die noch nicht synchronisiert sind) des aktuellen Mitarbeiters weiterhin anzeigen, aber dafür prüfen ob die `employeeId` im lokalen Datensatz übereinstimmt.

**`src/pages/Auth.tsx`**: Beim erfolgreichen Mitarbeiter-Login prüfen, ob die vorherige Session einen anderen Mitarbeiter hatte. Falls ja, `indexedDBStorage.clearAll()` aufrufen, um Altdaten zu entfernen.

