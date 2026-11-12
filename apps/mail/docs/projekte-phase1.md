# Projekte – Phase 1: Spiegel, Regeln, Stapel (Schattenmodus)

## Was dazugekommen ist
- Migration `20261112200000_projects_phase1.sql`: alle Tabellen der Spec (RLS, Policies nur Lesen für `is_staff()`, GRANTs), Startbelegung Regeln/Vorlagen/Terminarten/`app_config`. Zusätzlich `project_runs` (letzter Lauf von Sync/Auswertung) sowie `hero_projects.step_key` und `project_cards.bundled`.
- Migration `20261112200100_projects_cron.sql`: pg_cron `hero-sync` (alle 10 Min) und `project-evaluate` (täglich 5:30 UTC). **Erst nach dem Deploy der Functions anwenden.**
- Functions: `hero-sync` (liest alle `project_matches`, spiegelt, wertet danach aus), `project-evaluate`, `project-api` (einzige Schnittstelle der Oberfläche).
- Gemeinsamer Code `_shared/projects/` (`steps`, `docs`, `rules`, `sync`, `evaluate`), Tests daneben.
- Mail-App: Bereich „Projekte“ (Stapel, Karte, Aufräum-Karte, Wiedervorlagen, Tasten J/K/W/H), Admin-Reiter „Projekte“.

## Entscheidungen
- Regeln hängen am Statusnamen (`step_key`, Emoji egal), nicht an IDs. Neue Status legt der Sync mit Standardwerten in `project_step_settings` an (Buchhaltung, Abgeschlossen, Archiviert ausgeschlossen).
- `haengt` gilt nur für Status ohne eigene Regel; `waise` fängt Regelstatus außerhalb der Sollzeit auf. Der Waisen-Check meldet `orphans` in `project_runs.stats`.
- „Tage seit letztem Angebot“ nutzt `customer_documents.created` (HERO liefert kein Versanddatum).
- `angebot_entwurf` greift nur ohne vorhandene AB (sonst würde jedes Projekt in Produktion mit altem Entwurf auffallen).
- Wiedervorlage = Zeile in `followups` + Karte `snoozed`; fällig → Karte wieder `open` (`reasons.manual`, wird nicht automatisch geschlossen, bis jemand sie bearbeitet).
- Mitarbeiter sehen Projekte, bei denen sie Bearbeiter sind oder noch niemand zugewiesen ist; Admin alle. `info@slwerbung.de` ist über `app_config.projects_ignored_assignees` ausgenommen.
- Schattenmodus: Phase 1 schreibt nichts nach HERO und versendet nichts; die lokale Wiedervorlage steht in `project_actions_log`.

## Stand 12.11.2026 – live
Migration ...200000 und die Cron-Migration sind angewendet, `hero-sync`, `project-evaluate` und `project-api` sind deployt (`verify_jwt: false`). Erster vollständiger Abgleich:

| | Ergebnis | Spec (9.11.) |
| --- | --- | --- |
| HERO-Projekte geladen | 1500 | – |
| offene Projekte im Spiegel | 370 | 361 |
| Karten im Stapel | 57 | 55 |
| Aufräum-Karte | 281 | 280 |
| Waisen | 0 | 0 |

Zweiter Lauf: nichts doppelt angelegt, keine unnötigen Updates. Cron: `hero-sync` alle 10 Min, `project-evaluate` täglich 5:30 UTC.

Beim Test aufgefallen und behoben: `jsonb` liefert die Schlüssel in anderer Reihenfolge zurück, der Vergleich der `reasons` hielt jede Karte für geändert (338 Updates je Lauf). Jetzt `canon()` in `evaluate.ts`, mit Test.

## Deploy (für spätere Änderungen)
```bash
supabase db push
supabase functions deploy hero-sync project-evaluate project-api --no-verify-jwt
```
Ändert sich `_shared/projects/*`, `_shared/email/hero.ts` oder `_shared/email/http.ts`, müssen alle drei neu deployt werden (und alle anderen Functions, die `hero.ts`/`http.ts` importieren).

## Abnahme
- [x] `hero_projects` enthält alle offenen Projekte (370), Lauf ohne Fehler.
- [x] Verteilung plausibel zum 9.11. (57 Karten / 281 Aufräum-Karte).
- [x] Waisen-Check meldet 0.
- [x] Nichts nach HERO geschrieben (nur Lesen), keine Mail versendet.
- [ ] Cron-Lauf alle 10 Min (`select * from project_runs order by created_at desc`).
- [ ] Wiedervorlage legen und „Jetzt holen“ in der Oberfläche.
