
Plan: npm-Publish jetzt sauber absichern und dann neu veröffentlichen

Was ich im aktuellen Stand geprüft habe
- `bun.lock` ist im aktuellen Repo-Snapshot nicht mehr vorhanden.
- `bun.lockb` ist ebenfalls nicht sichtbar.
- Gleichzeitig fehlt aber auch `package-lock.json`.
- In `package.json` gibt es weiterhin keine `packageManager`-Angabe.
- `.gitignore` ignoriert `bun.lock` / `bun.lockb` aktuell nicht.
- Der Projektstatus ist grundsätzlich auf „published/public“, aber das sagt nichts darüber aus, ob der letzte Frontend-Update-Build erfolgreich war.

Schlussfolgerung
- Nur das Löschen von `bun.lock` reicht noch nicht aus.
- Der Build ist weiterhin nicht eindeutig auf npm festgelegt, weil:
  1. kein `package-lock.json` vorhanden ist
  2. kein `packageManager` gesetzt ist
  3. Bun-Lockfiles nicht explizit ausgeschlossen sind
- Ein erneuter Publish-Versuch ohne diese Repo-Bereinigung kann weiterhin in einen falschen Installer-/Cache-Zustand laufen.

Gezielte Umsetzung ohne App-/UI-Änderungen
1. npm als einziges Install-Signal festlegen
- `package.json` minimal ergänzen um `packageManager: "npm@..."`

2. npm-Lockfile als einzige Basis herstellen
- ein frisches `package-lock.json` aus dem aktuellen `package.json` erzeugen
- keine Dependency-Upgrades, nur Lockfile-Erstellung für den bestehenden Stand

3. Wiederauftauchen von Bun-Lockfiles verhindern
- `.gitignore` um `bun.lock` und `bun.lockb` ergänzen

4. Danach frischen Publish anstoßen
- mit dem bereinigten npm-only Repo erneut publishen
- dabei gezielt prüfen, ob der Installer noch fälschlich Bun verwendet

Was ich bewusst nicht ändere
- keine UI
- kein App-Code
- keine Refactorings
- keine Backend-Logik
- keine Dependency-Upgrades

Technische Details
Betroffene Dateien:
- `package.json` — nur `packageManager` ergänzen
- `package-lock.json` — neu erzeugen
- `.gitignore` — `bun.lock` und `bun.lockb` ignorieren

Erwartetes Ergebnis
- npm ist eindeutig der einzige Paketmanager
- `package-lock.json` ist die einzige Lockfile-Basis
- `bun.lock` / `bun.lockb` tauchen nicht mehr aus Repo-Zustand wieder auf
- der nächste Publish-Versuch läuft mit einem frischen, deterministischen npm-Install
