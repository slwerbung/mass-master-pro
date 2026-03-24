

## Problem

Der Fehler in der Konsole ist:

```
VersionError: The operation failed because the stored database is a higher version than the version requested.
```

Das bedeutet: Im Browser des Nutzers existiert eine IndexedDB mit einer **höheren Versionsnummer** als die aktuell im Code angeforderte Version 3. Das passiert, wenn zwischenzeitlich eine Code-Version mit Version 4+ deployt war und dann wieder auf Version 3 zurückgefallen ist.

IndexedDB erlaubt kein Downgrade — wenn die gespeicherte DB Version 4 hat, aber der Code Version 3 anfordert, schlägt `openDB()` mit `VersionError` fehl. Dadurch können keine Projekte geladen werden.

**Wichtig**: Die Daten sind nicht verloren. Sie liegen weiterhin in der lokalen IndexedDB und in der Cloud. Nur der Zugriff scheitert am Versionskonflikt.

## Lösung

In `src/lib/indexedDBStorage.ts` die `getDB()`-Funktion mit einem Fallback erweitern:

1. Wenn `openDB()` mit `VersionError` fehlschlägt, die IndexedDB löschen und neu erstellen
2. Danach werden die Projekte automatisch aus der Cloud neu geladen (der bestehende Sync-Mechanismus in `Projects.tsx` holt Projekte aus der Cloud)
3. Alternativ: Die `DB_VERSION` auf 4 hochsetzen (sicherer, weil keine Daten verloren gehen)

**Empfehlung**: `DB_VERSION` von 3 auf 4 hochsetzen. Das ist die sicherere Variante, weil:
- Ein Upgrade von 3→4 ist ein No-Op (kein neuer Object Store nötig)
- Ein Upgrade von einer noch höheren Version (falls existent) wird weiterhin durch einen `catch`-Block abgefangen, der die DB löscht und neu erstellt

### Betroffene Datei

- `src/lib/indexedDBStorage.ts` — `DB_VERSION` auf 4 setzen + `VersionError`-Fallback in `getDB()`

### Was sich nicht ändert

- Keine UI-Änderungen
- Keine Backend-Änderungen
- Keine Dependency-Änderungen

