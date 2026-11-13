# Projekte – Phase 4: HERO-Arbeitsmodus

## Ablauf (Projekt-Karten)
1. **„In HERO erledigen“** (Hauptaktion bei Regeln mit Weg `hero`, sonst als zusätzlicher Knopf) → `project-action` `lock_for_hero`: Karte wird **30 Minuten gesperrt** (`state = in_hero`, `locked_by`, `locked_until`), der **Vorher-Stand** des Projekts (Status + Dokumente) kommt frisch aus HERO in `hero_tasks.before`. HERO öffnet sich in einem **neuen Tab** (im Klick vorab geöffnet, sonst blockiert der Browser ihn). Kein iframe – HERO blockiert das.
2. Die Karte zeigt die **Checkliste** der Aufgabe (Haken bleiben im Browser). Andere sehen „Gerade von … in HERO bearbeitet“, der Start ist für sie gesperrt.
3. **Rückkehr:** Wechselt der Tab zurück nach vorn (`visibilitychange`), fragt ein Dialog **Erledigt / Teilweise / Problem**. Auch manuell über „Zurück aus HERO“.
4. `hero-task-callback` speichert das Ergebnis. Bei **Erledigt** liest die Function das Projekt **neu aus HERO** (nur lesen) und vergleicht mit dem Vorher-Stand:

   | Aufgabe (Regel) | gilt als erledigt, wenn … |
   | --- | --- |
   | Angebot erstellen (`anfrage_ohne_angebot`) | mehr Angebote als vorher |
   | Angebot fertigstellen (`angebot_entwurf`) | ein Angebot neu „Versendet“ ist oder der Status auf „Warten auf Auftrag“ wechselte |
   | AB erstellen (`ab_fehlt`) | mehr Auftragsbestätigungen als vorher |
   | Reklamation (`reklamation`) | Status nicht mehr „Reklamation“ |
   | allgemein (alle anderen Karten) | Status oder Dokumente haben sich geändert |

   Passt es: Karte wird geschlossen (`done`, „In HERO erledigt“), **Logbuch-Eintrag** (nur außerhalb des Schattenmodus), danach der Wiedervorlage-Vorschlag und die nächste Karte. Passt es nicht: Die Karte bleibt **offen mit Hinweis** („In HERO ist noch keine neue Auftragsbestätigung zu sehen …“). **Teilweise/Problem** geben die Karte frei und merken die Notiz als Hinweis.
5. Der Hinweis bleibt 3 Tage an der Karte (aus `hero_tasks.check_result`, nicht in `project_cards.reasons` – die Regelauswertung würde ihn sonst überschreiben).

Abgelaufene Sperren gibt ein pg_cron-Job (`project_release_hero_locks`, alle 5 Min, reines SQL) wieder frei.

## Mail-Karten („Zu entscheiden“)
In der Karte eines Themas mit Projekt gibt es **„In HERO erledigen …“**: Aufgabe wählen (AB erstellen, Angebot erstellen, Angebot fertigstellen, etwas anderes) → `lock_for_hero` mit `kind` und `threadId` (Postfach-Zugriff und Projekt-Zugehörigkeit des Themas werden geprüft) → HERO in neuem Tab → Rückkehr → derselbe Abgleich. **Gelingt er, wird das Thema abgeschlossen** („abgelegt“, `decideTopic` mit Etikett „AB erstellen in HERO erledigt“); sonst bleibt es offen. Die Aufgabe hängt am Thema (`hero_tasks.email_id`); gibt es zum Projekt eine offene Projekt-Karte, wird sie mitgesperrt. Die Projekt-Karte „AB fehlt“ verschwindet beim nächsten Sync von selbst, sobald die AB in HERO da ist (daraus wird bei Bedarf „Termine anlegen“). Die offene Aufgabe zu einem Thema liefert `project-api` `topic_task` (nur eigene, höchstens 24 h alt).

## Checklisten
`app_config.projects_checklists` (JSON je Aufgabe: Name + Punkte), pflegbar im Adminmenü → Projekte → „Checklisten“ (`project-api` `save_checklist`, nur Admin). Fehlende Einträge fallen auf die Standardwerte in `_shared/projects/heroTask.ts` zurück.

## Technik
- Logik rein in `_shared/projects/heroTask.ts` (`checkTask`, `lockForHero`, `finishTask`), Tests in `heroTask.test.ts` (Abgleich je Aufgabe, Sperre, fremde/abgelaufene Sperre, Erledigt/Teilweise/Problem, Schattenmodus, Rechte).
- Neue Function `hero-task-callback` (sendet nie Mails; `send-guard.test.ts` prüft das mit). `lock_for_hero` in `project-action`; `project-api` `list` liefert je Karte `state`, `heroTask`, `hint`.
- Migration `20261113120000_projects_phase4.sql`: `hero_tasks.hero_id`, `created_by_name`, Indizes, Cron für abgelaufene Sperren.

## Stand und Abnahme
Deployt (13.11.2026, über den Lader – siehe unten): Migration, `project-api`, `project-action`, `hero-task-callback`.

- [ ] Eine AB in HERO erzeugen und beim Zurückkehren erkannt bekommen (Karte `ab_fehlt`, „In HERO erledigen“ → AB anlegen → „Erledigt“). **Live noch nicht geprüft.**
- [ ] „Erledigt“ ohne Änderung in HERO lässt die Karte mit Hinweis offen.
- [ ] Zweiter Benutzer sieht die Sperre; nach 30 Minuten ist die Karte wieder frei.
- [ ] **Mail-Karte** („Mail mit Zusage → AB in HERO erstellen → zurück → Abgleich → Mail abgelegt“): gebaut (siehe unten), **live noch nicht geprüft**.

## Deploy-Hinweis: Lader
Wie `email-send` (siehe `docs/mail-assistent/betrieb.md`) laufen `project-api`, `project-action` und `hero-task-callback` als **Lader**: der gebündelte Code (esbuild, CJS, `--charset=utf8`, nur `@supabase/supabase-js` extern) liegt in `public.edge_code` (`<function>@<commit>`), der Lader prüft die SHA-256. Ein normales `supabase functions deploy <name> --no-verify-jwt` ersetzt den Lader durch den Quelltext (der saubere Weg).
