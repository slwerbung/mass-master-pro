# Projekte – Phase 5: Verzahnung

## Was dazugekommen ist
- **„Heute“** (`/heute`, Navigation): Mail-Themen aus „Zu entscheiden“, Projekt-Karten und die heute fälligen Wiedervorlagen in **einer** Liste, Kundensachen zuerst (dann Auftrag, Termine, Pflege; Mails vor Projekten). Jede Zeile führt in die jeweilige Ansicht (`/projekte?card=…` wählt die Karte vor).
- **Wiedervorlagen werden geweckt** (in `project-evaluate`, also alle 10 Min nach dem Sync): Eine noch nicht fällige Wiedervorlage kommt vorzeitig zurück, wenn
  - nach ihrem Anlegen eine **Kundenmail** zum Projekt eingegangen ist (eingehend, nicht gelöscht, nicht Werbung/System/Beleg) → „Wiedervorlage vorgezogen: Kunde hat geschrieben.“, oder
  - der **Status in HERO** gewechselt hat (`hero_projects.step_since` liegt nach dem Anlegen) → „… Status in HERO geändert.“
  Der Statuswechsel zählt erst **mehr als 3 Stunden** nach dem Anlegen: HERO liefert Zeiten als Ortszeit mit „+00:00“, eine frisch gesetzte Wiedervorlage würde sonst sofort wieder aufwachen.
- **Neue Regel `kunde_mail_offen`** (Kategorie Kunde, Schwelle 2 Tage, im Adminmenü einstellbar): Kundenmail zum Projekt seit **mehr als** 2 Tagen unbeantwortet (`email_threads.answered = false`, Kundenkategorien wie in der Morgenübersicht, Thema nicht von Hand erledigt, Mail nicht gelöscht; die älteste zählt). Hauptaktion **„Antworten“** öffnet die Mail im Verfassen-Fenster. Steht in der Prüfreihenfolge direkt nach „Reklamation“.
- **Fluss-Ansicht** (Reiter „Fluss“ in Projekte, `project-api` `flow`): je Status Anzahl der Projekte, Ø und längste Verweildauer, Projekte außerhalb der Sollzeit, Anzahl Karten und **Ampel gegen das WIP-Limit** (grün im Limit, gelb bis 25 % darüber, rot darüber, ohne Limit keine Ampel). **Klick auf einen Status filtert den Stapel** (Chip „Status: …“, „Filter aufheben“). WIP-Limit je Status im Adminmenü → Projekte → Status (`project_step_settings.wip_limit`).
- **Morgenübersicht**: `project-api` `morning` = die Mail-Übersicht von `email-api` (`digest`, mit der Sitzung des Aufrufers) plus Zahlen aus dem Stapel (Karten je Kategorie, Aufräum-Karte, Wiedervorlagen heute, erste Kunden-Karten) und **ein Satz `text`** für die 7-Uhr-Meldung. Rein lesend. `email-api` bleibt unverändert.

## Wichtig für den 7-Uhr-Task
Der Task liegt außerhalb dieses Repos und ruft bisher `email-api` `digest` auf. Damit die Projekt-Zahlen in die Meldung kommen, muss er stattdessen `project-api` `{"action":"morning"}` aufrufen (gleiche Anmeldung, gleiches Antwortformat plus `projects`; `data.text` ist der Meldungstext).

## Technik
- Logik in `_shared/projects/evaluate.ts` (`loadOpenMails`, `wakeTrigger`), `rules.ts` (Regel), `digest.ts`; Tests `evaluate.test.ts` (Wecken: Mail/Status/Toleranz/Werbung/ausgehend/alte Zeilen; Regel: Schwelle, beantwortet, erledigt, Werbung, gelöscht, älteste) und `digest.test.ts`.
- Migration `20261113140000_projects_phase5.sql`: `wip_limit`, Regelzeile `kunde_mail_offen`.
- Deployt über den Lader (siehe Phase 4): `hero-sync`, `project-evaluate`, `followup-runner`, `project-action`, `project-api` – diese Functions teilen die Regelauswertung, deshalb alle fünf.

## Stand und Abnahme (13.11.2026)
Live geprüft: Sync-Lauf mit der neuen Auswertung fehlerfrei (359 Projekte, 335 Karten); die Regel hat die Karte für WER-1947 (Mail seit 16 Tagen) angelegt, die übrigen sieben Projekte mit offener Mail sind höchstens 2 Tage alt und kommen mit der Schwelle von selbst.

- [ ] Eine Kundenmail zu einem Projekt mit Wiedervorlage holt die Karte binnen 10 Min nach vorn. **Live noch nicht geprüft** (Logik per Test abgedeckt; im Moment gibt es kein Projekt mit künftiger Wiedervorlage und neuer Mail).
- [ ] Die Fluss-Ansicht zeigt je Status Anzahl und Durchschnittsdauer; Klick filtert den Stapel. **In der Oberfläche noch nicht angesehen.**
- [ ] „Heute“ zeigt Mail- und Projektkarten gemeinsam. **In der Oberfläche noch nicht angesehen.**
- [ ] 7-Uhr-Task auf `morning` umstellen (siehe oben).
