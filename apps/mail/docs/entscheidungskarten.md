# „Zu entscheiden“ und Mail-Ansicht aufgeräumt (Stand 20.11.2026)

Umbau nach dem Vorbild des Projekt-Stapels. Spec: „Zu entscheiden“ und Mail-Ansicht aufräumen. **Kein Backend-Umbau**, keine Funktion fällt weg (Abnahme-Liste unten).

## Was sich geändert hat
- **Zu entscheiden** (`pages/Decide.tsx`): links ein Stapel (22 rem), rechts eine Karte; auf dem Handy klappt die Karte unter dem Eintrag auf (immer nur eine offen, nach einer Aktion das nächste, mit `scrollIntoView`). Reiter „Stapel / Laufend / Wiedervorlagen“, Reklamationen und Belege im Portal als kleine Links neben der Überschrift.
- **Karte**: Projekt-Kopf (HERO-Projektnummer groß, Status als Badge → Dialog) · gelber Kasten (Grund, neueste Mail, „Mail lesen“, „Ganze Mail öffnen“, Anhänge, weitere neue Mails) · `HeroTaskBox` · **Vorschlag** als Zeilen · vier Hauptknöpfe (Ausführen, Abschließen, Antworten, Später) · stille Zeile (HERO, Weiterleiten, Anders …, Anderes Projekt, Mitarbeiter, Dropbox).
- **Vorschlagszeilen**: Checkbox · Kurztext · Pfeil. Aufklappen zeigt die Felder der früheren Einzelkarten. „Ausführen (n)“ arbeitet in der Reihenfolge von `ORDER` ab (angehakt = annehmen, Haken weg = verwerfen mit Grund), hält beim ersten Fehler an; Erledigtes bleibt als ✓ bzw. „verworfen (Grund)“ stehen. `send_document` ist nicht Teil davon (eigener Versand-Knopf mit Bestätigung, „Nicht versenden“).
- **Projektwahl** im Kopf als Radio-Chips („Neu anlegen“ · Kandidaten · „Suchen“) ersetzt `ProjectChoice`/`AlternativesPicker`. Vorbelegt: hat der Assistent ein Projekt vorgeschlagen (`link_project.payload.projectId`), dieses; sonst „Neu anlegen“.
- **Dialoge** (alle über `Modal`, Handy = Blatt von unten, Fokus rein/zurück, `overscroll-behavior: contain`): Status, Später (Nur beobachten / Wiedervorlage), Anders … (mit Schalter „Vorschlag war falsch, daraus lernen“ → `TeachBox`), Projekt zuordnen, Mitarbeiter, Dropbox, In HERO erledigen.
- **Adresse und Tasten**: `/?topic={threadId}` (`replace`), `Today` verlinkt darauf. J/K, Enter, E, R, W, H wie in Projekte (`useStackKeys`).
- **Mail-Ansicht** (`pages/MessageDetail.tsx`): Kopfzeile mit Themenzustand und „Zur Entscheidung“ · Projekt-Leiste · Kopf mit Kategorie-Auswahl · Mail-Leiste (Antworten, Allen antworten, Weiterleiten, ⋯; auf dem Handy unten klebend) · Mail + Anhänge · Antwortentwurf (blau, nur wenn vorhanden, sonst eine Zeile) · Beleg-Kasten · ein gemeinsamer Rahmen mit Verlauf / Erkannte Daten / Was der Assistent getan hat. `TopicBar` entfällt; Löschen fragt per `ConfirmDialog`.
- **Neue Bauteile**: `ProjectNr`, `Stack` (`StackItemFrame`, `useStackKeys`, `useIsMobile`), `SuggestionRow`, `SuggestionFields` (+ `ConfirmationFields`, `SendDocumentPanel` in `OrderCards`), `DecideDialogs`, `lib/decide.ts` (reine Logik, mit Tests). `Projects.tsx` nutzt `StackItemFrame`/`useStackKeys`, Verhalten gleich. `TopicActions.tsx` bleibt für die Themen-Seite; `SnoozePanel` bekam optionale Darstellungs-Parameter, `useTopicDecide` ein `silent`.

## Einzige Backend-Ergänzung (rein lesend, mit Test)
`list_topics` / `get_message` (`topicsDb.ts`): `Topic.project` (Nummer, Name, Kunde, sicher/vermutet – aus `match_info` der Mail, kein HERO-Aufruf), `TopicMail.hasDraft` (Antwortentwurf vorhanden → `&draft=1`), `TopicMail.belegState` (schon an Lexware weitergeleitet?). Test in `topicsDb.test.ts`.

## Entscheidungen
- **Neueste Mail** = die letzte in `newMessages` (die Liste ist aufsteigend). Etikett, gelber Kasten, Antworten/Weiterleiten/Anweisung beziehen sich darauf.
- **„Projekt?“** gilt, solange offene `create_project`/`link_project`-Vorschläge existieren – auch wenn schon eine vermutete Zuordnung am Thema hängt. Mehrere Vorschlagspaare in einem Thema (verschiedene Mails): der Kopf zeigt das der ersten Mail, weitere erscheinen als normale Zeilen.
- **Abgewählte Projektzeile** verwirft beide Varianten mit demselben Grund; angenommen schließt der Server die andere (wie bisher).
- **Beleg-Zeile** („An Lexware senden“) ist wie die anderen vorab angehakt; abgewählt passiert nichts (es gibt keinen Vorschlag zum Verwerfen). Nur bei Beleg mit Anhang, solange nicht weitergeleitet.
- **`&draft=1`** hängt nur an „Antworten“ (der Entwurf ist eine Antwort), nicht an „Weiterleiten“.
- **„Abschließen“ (E)**: offene Vorschläge (auch `send_document`) mit „Thema abgeschlossen“ verwerfen, dann `erledigt`.
- **Nach „Ausführen“** springt die Auswahl nur weiter, wenn keine Zeile offen blieb (Fehler, abgewählter Beleg, `send_document` halten die Karte).
- In der Mail-Ansicht ⋯ zusätzlich **„Anweisung …“** (`InstructBox`): die frühere Schaltfläche „In HERO erledigen …“ der Mail-Ansicht war die Anweisung; „In HERO erledigen …“ ist jetzt der Arbeitsmodus wie in der Karte. So geht keine Funktion verloren.
- `Modal` für alle Dialoge verbessert (Handy-Blatt, Fokus); das gilt damit auch für die Projekte-Dialoge, `buttonVariants` ist exportiert (Link-Knöpfe), Knöpfe tragen `touch-action: manipulation`.

## Stand der Abnahme (20.11.2026)
- `npm run typecheck` und `npm run build` in `apps/mail`: fehlerfrei. Reine Logik: `apps/mail/src/lib/decide.test.ts` (7 Tests) – dafür bindet die Root-`vitest.config.ts` jetzt `apps/mail/src/lib/**` ein; `apps/mail/tsconfig.json` schließt `*.test.ts` aus, damit der Vercel-Build ohne Root-Abhängigkeiten läuft.
- Browser (Chromium, 1280 und 390 px, **Backend nachgebildet** – echte Mail-Daten, Schattenmodus und HERO nicht verfügbar): keine Laufzeitfehler, kein Überlauf nach rechts; Stapel, Aufklappen, Zeilen, „Ausführen“ (Reihenfolge, Abbruch, Wiederholung), „Abschließen“ (E), J/K, „Später“-Blatt, Mail-Ansicht mit ⋯ und „Mail löschen?“ durchgeklickt.
- **Noch am echten System durchzuklicken** (Schattenmodus, wo verfügbar): Dropbox-Dialog, HERO-Arbeitsmodus (Start → Rückkehr), Status ändern in HERO, „Anders …“ → Erklären, Mitarbeiter zuordnen, Entwurf (ins Postfach legen / neu erzeugen), Beleg-Zeilen, `send_document`, Kategorie korrigieren. Die Checkliste in Abschnitt 8 der Spec ist die Reihenfolge dafür.
- Tabs „Laufend“/„Wiedervorlagen“ sind Links auf `/themen?view=laufend|wiedervorlage` (`Topics.tsx` liest `view` schon).
