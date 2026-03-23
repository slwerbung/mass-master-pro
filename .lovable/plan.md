
Plan: Vorschau und Publish wieder stabil machen

Was ich jetzt als tatsächliches Problem sehe

- Der Publish scheitert in der Installationsphase, nicht im App-Build selbst: `install exec failed: all attempts returned errors`.
- Im Repo liegen aktuell zwei konkurrierende Lockfile-Strategien gleichzeitig vor:
  - `package-lock.json`
  - `bun.lock`
- Das ist zusätzlich unsauber, weil der aktuell laufende Preview-Client noch mit anderen installierten Paketständen läuft als `package.json` vorgibt (sichtbar z. B. an `@supabase/supabase-js`).
- Es gibt außerdem ein separates Runtime-Problem im Backend-Call:
  - Browser-Requests an `validate-session` schlagen als `NetworkError` fehl
  - ein direkter Funktionsaufruf funktioniert aber
  - das spricht stark für ein CORS-/Preflight-Problem in `supabase/functions/validate-session/index.ts`

Do I know what the issue is?
Ja:
1. Publish ist durch die konkurrierenden/stale Lockfiles blockiert.
2. Die Vorschau ist zusätzlich durch einen fehlerhaften `validate-session`-Aufruf instabil.

Umsetzung

1. Install-/Publish-Problem bereinigen
- Auf eine einzige Paketmanager-Strategie festlegen: npm
- `bun.lock` entfernen
- `package-lock.json` als einzige Lockfile-Quelle beibehalten
- `package.json` nur dann minimal anpassen, wenn es noch von der npm-Lockfile abweicht und dadurch erneut Drift entsteht

2. Preview-/Runtime-Problem beheben
- `supabase/functions/validate-session/index.ts` an die funktionierenden CORS-Header der anderen Funktionen angleichen
- insbesondere dieselben erlaubten Header wie bei `admin-manage`/`validate-admin` verwenden
- danach `validate-session` neu deployen

3. Danach gezielt verifizieren
- Vorschau startet wieder stabil
- `/admin` erzeugt keinen `Network error` mehr durch `validate-session`
- Publish läuft wieder durch
- keine UI- oder Verhaltensänderungen außer den nötigen Stabilitätsfixes

Betroffene Dateien
- `bun.lock` — löschen
- `supabase/functions/validate-session/index.ts` — CORS-Header korrigieren
- eventuell `package.json` — nur falls für die npm-Strategie eine kleine Synchronisierung nötig ist

Was ich bewusst nicht ändern werde
- kein Refactoring
- keine UI-Anpassungen
- keine unnötigen Dependency-Upgrades
- keine unnötigen Backend-Änderungen außerhalb von `validate-session`

Erwartetes Ergebnis
- Preview funktioniert wieder zuverlässig
- Publish ist wieder möglich
- die Session-Prüfung auf Admin-/Mitarbeiter-Routen funktioniert ohne Browser-Netzwerkfehler
