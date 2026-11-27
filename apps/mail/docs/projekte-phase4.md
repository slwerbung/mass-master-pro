# Projekte – Phase 4: HERO-Arbeitsmodus

## Ablauf (Projekt-Karten)
1. **„In HERO erledigen“** → `project-action` `lock_for_hero`: Karte wird **30 Minuten gesperrt** (`state = in_hero`), der **Vorher-Stand** (Status + Dokumente) kommt frisch aus HERO in `hero_tasks.before`. HERO öffnet in **einem wiederverwendeten Popup-Fenster** (im Klick vorab geöffnet, sonst blockiert der Browser es). **Einbetten (iframe) geht nicht:** HERO ist im Iframe einer fremden Domain ohne Cookies, der Login schlägt dort fehl („Passwort falsch“), obwohl man angemeldet ist.
2. Während die Aufgabe läuft, zeigt die Karte nur noch die Aufgabe (Abschließen, Wiedervorlage, Archivieren, Kürzel sind ausgeblendet). Andere sehen „Gerade von … in HERO bearbeitet“.
3. **Selbstständig erkannt:** Die Karte fragt alle 20 s und beim Zurückkehren `hero-task-callback` `{action:"check"}` ab (nur lesen). Das **verlängert auch die Sperre**, sie läuft also nicht mitten in der Arbeit ab. Ist es erledigt, wird die Box grün: ein Klick auf **Abschließen**.
4. **„Fertig“** gleicht direkt ab. Passt es → Karte zu, Logbuch-Eintrag (nicht im Schattenmodus), nächste Karte. Passt es nicht: **Aufgabe und Sperre bleiben**, ein Dialog fragt: *Noch nicht fertig* (Karte frei, später weiter), *Ist trotzdem erledigt* (`force`, ohne Abgleich, Logbuch „manuell bestätigt“), *Problem* (Notiz). Bei *Noch nicht fertig/Problem* gilt beim nächsten Start der **alte Vorher-Stand** weiter (3 Tage), damit ein in der ersten Sitzung angelegtes Dokument noch als „neu“ zählt.

   | Aufgabe (Regel) | gilt als erledigt, wenn … |
   | --- | --- |
   | Angebot erstellen (`anfrage_ohne_angebot`) | mehr Angebote als vorher |
   | Angebot fertigstellen (`angebot_entwurf`) | ein Angebot neu „Versendet“ ist oder der Status auf „Warten auf Auftrag“ wechselte |
   | AB erstellen (`ab_fehlt`) | mehr Auftragsbestätigungen als vorher |
   | Reklamation (`reklamation`) | Status nicht mehr „Reklamation“ |
   | allgemein (alle anderen Karten) | Status oder Dokumente haben sich geändert |

5. Der Hinweis aus „Noch nicht fertig/Problem“ bleibt 3 Tage an der Karte (aus `hero_tasks.check_result`, nicht in `project_cards.reasons`).

Abgelaufene Sperren gibt ein pg_cron-Job (`project_release_hero_locks`, alle 5 Min, reines SQL) wieder frei.

## Direkt in der App erledigen (statt HERO-Fenster)
Wo es die HERO-Schnittstelle hergibt, wird die Aufgabe in der App selbst erledigt; das HERO-Popup bleibt für alles andere.
- **AB erstellen** (Karte `ab_fehlt`, `AbPanel.tsx`): zeigt die Positionen des neuesten abgeschlossenen Angebots (Auswahl und Menge änderbar). „AB-Entwurf in HERO anlegen“ → `project-action` `ab_create` (Vorschau: `ab_prepare`, nur lesen). Das Angebot wird serverseitig neu gelesen, vom Client kommen nur Auswahl und Mengen. Der Entwurf entsteht wie in der Mail-App (`createConfirmationDocument`: Positionen aus dem Angebot kopieren, Rückfälle), Logbuch-Eintrag, Karte erledigt. **Versendet wird nie:** Prüfen, Abschließen und Versenden bleibt in HERO bzw. per Klick in der Mail-App. Schattenmodus: nur Protokoll. Logik und Tests: `_shared/projects/abCreate.ts`.
- Weiterhin über das HERO-Fenster: Angebot erstellen/fertigstellen und alles Allgemeine. Termine, Status, Logbuch und Archivieren gehen schon direkt in der App.

## Mail-Karten („Zu entscheiden“)
In der Karte eines Themas mit Projekt gibt es **„In HERO erledigen …“**: Aufgabe wählen (AB erstellen, Angebot erstellen, Angebot fertigstellen, etwas anderes) → `lock_for_hero` mit `kind` und `threadId` (Postfach-Zugriff und Projekt-Zugehörigkeit des Themas werden geprüft) → HERO-Fenster → Karte erkennt es → derselbe Abgleich. **Gelingt er, wird das Thema abgeschlossen** („abgelegt“, `decideTopic` mit Etikett „AB erstellen in HERO erledigt“); sonst bleibt es offen. Die Aufgabe hängt am Thema (`hero_tasks.email_id`); gibt es zum Projekt eine offene Projekt-Karte, wird sie mitgesperrt. Die Projekt-Karte „AB fehlt“ verschwindet beim nächsten Sync von selbst, sobald die AB in HERO da ist (daraus wird bei Bedarf „Termine anlegen“). Die offene Aufgabe zu einem Thema liefert `project-api` `topic_task` (nur eigene, höchstens 24 h alt).

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
