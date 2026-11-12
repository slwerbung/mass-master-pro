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

## Deploy
```bash
supabase db push                       # nur Migration ...200000 (die Cron-Datei erst danach)
supabase functions deploy hero-sync project-evaluate project-api --no-verify-jwt
```
Dann in der Mail-App → Projekte → „Jetzt abgleichen“, Ergebnis prüfen, danach `20261112200100_projects_cron.sql` anwenden.

## Abnahme (offen, nur live prüfbar)
- [ ] `hero_projects` enthält alle offenen Projekte (≈ 361), Sync alle 10 Min ohne Fehler (`select * from project_runs order by created_at desc`).
- [ ] Verteilung plausibel zum 9.11.: ≈ 55 Karten im Stapel, ≈ 280 in der Aufräum-Karte.
- [ ] `orphans = 0` im letzten `evaluate`-Lauf.
- [ ] Wiedervorlage legen und „Jetzt holen“.
- [ ] Nichts in HERO geschrieben, keine Mail versendet.
