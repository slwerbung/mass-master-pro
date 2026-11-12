# Projekte – Phase 2: Aktionen scharf

## Was dazugekommen ist
- Function `project-action` (`steps`, `set_step`, `complete`, `archive`, `logbook_note`, `create_events`, `bulk_archive` nur Admin). Logik in `_shared/projects/actions.ts`, HERO-Zugriffe werden hineingereicht (testbar), HERO nur über `_shared/email/hero.ts` und `heroCreateAppointment`.
- `project-api`: `event_setup` (Terminarten, Mitarbeiter mit HERO-Zuordnung), `save_write_enabled` (Admin); gemeinsamer Zugriffscode `_shared/projects/access.ts`.
- Mail-App: „✓ Abschließen“ (E), HERO-Leiste (Status ändern, Logbuch-Notiz, Termine anlegen, Archivieren (A)), Aufräum-Karte mit Auswahl und „Alle archivieren“, Schalter im Admin-Reiter „Projekte“.

## Schattenmodus
`app_config.projects_write_enabled` ist **aus** (`false`). Dann schreibt keine Aktion nach HERO; sie landet nur in `project_actions_log` (`shadow = true`), die Oberfläche zeigt „Schattenmodus: … nichts geschrieben“ und lässt die Karte stehen. Erst der Schalter (Admin → Projekte → „Schreiben nach HERO“) macht die Aktionen scharf.

## Entscheidungen
- **Status-IDs nie fest verdrahtet:** „Abgeschlossen“/„Archiviert“ werden zur Laufzeit in der HERO-Statusliste (`project_types → project_status_steps`) über den Namen gefunden. `setStep` prüft nach, ob HERO den Status übernommen hat.
- **Reihenfolge:** erst Status, dann Logbuch. Schlägt der Status fehl, gibt es keinen Logbuch-Eintrag; schlägt nur das Logbuch fehl, ist es eine Warnung.
- **Spiegel sofort angepasst** (geschlossene Projekte verschwinden aus `hero_projects`, Karte wird „Projekt nicht mehr offen“); der nächste `hero-sync` bestätigt es.
- **Termine:** alle Zeilen werden vorab geprüft (Titel, Dauer, Datum) – ein Tippfehler legt nichts an. Mitarbeiter über `employees.hero_partner_id`. Kategorie (HERO-Pflicht) aus `app_config.projects_event_category_id`, sonst `booking_hero_category_id`. Zeit = Berliner Ortszeit über `toHeroTime`.
- **Aufräumen:** nur Admin, Pakete zu 25 je Aufruf (Function-Laufzeit), Bestätigungsdialog; ein Fehler stoppt die übrigen nicht.
- **Nach einer Aktion:** bleibt das Projekt offen (Status, Notiz, Termine), schlägt die Oberfläche eine Wiedervorlage vor; nach Abschließen/Archivieren kommt die nächste Karte.
- **Noch nicht in Phase 2:** Angebot/AB erstellen (Arbeitsmodus, Phase 4), Stummschalten, Mailwege (Phase 3).

## Deploy
```bash
supabase functions deploy project-action project-api --no-verify-jwt
```
`project-action` importiert `_shared/email/hero.ts`, `_shared/email/http.ts`, `_shared/booking/hero.ts` und `_shared/booking/types.ts` – ändert sich eine davon, `project-action` mit neu deployen. Keine neue Migration.

## Abnahme (live, nach dem Deploy)
Mit Schalter **aus**:
- [ ] „Abschließen“, Status, Notiz, drei Termine, Archivieren zeigen „Schattenmodus“, nichts ändert sich in HERO, Zeilen mit `shadow = true` in `project_actions_log`.

Dann Schalter **an**, an einem Testprojekt (z. B. ein eigenes, später löschbares):
- [ ] ✓ Abschließen setzt den Status in HERO, schreibt das Logbuch und öffnet die nächste Karte.
- [ ] Status ändern und Notiz erscheinen in HERO.
- [ ] „Termine anlegen“ legt alle Zeilen in einem Klick in HERO an (Uhrzeit stimmt, Mitarbeiter gesetzt).
- [ ] Archivieren wirkt in HERO.
- [ ] Alle Aktionen stehen in `project_actions_log` mit `shadow = false`.
