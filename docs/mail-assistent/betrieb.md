# Mail-Assistent – Inbetriebnahme und Betrieb

Konzept: Claude-Doc „KI-Mail-Assistent – Konzept“. Dieses Dokument sagt, **was im Repo steht, in welcher
Reihenfolge man es einschaltet und was bewusst anders gelöst ist als im Konzept**.

## Bausteine

| Teil | Ort |
|---|---|
| Tabellen, Seed, Cron, Aufbewahrung | `supabase/migrations/20261007100000…`, `…100100…`, `…100200…`, `…100300…`, `20261008090000…`, `20261023100000…` (Aufbewahrung), `20261023120000…` (Senden, Signatur) |
| Gemeinsamer Code | `supabase/functions/_shared/email/` (IMAP, KI-Schicht, Klassifikation, Zuordnung, Handeln, Entwürfe, HERO) |
| Edge Functions | `email-account-test`, `email-sync`, `email-process`, `email-api`, `email-action`, `email-draft`, `email-mailbox`, `email-send`, `email-retention` |
| Mail-App | `apps/mail/` (Vite + React + TS + Tailwind), eigenes Vercel-Projekt |
| Phase-0-Skript | `scripts/mail-assistant/phase0-imap-check.ts` |
| Tests | `npm run test:unit` (vitest, ~340 Tests) und `deno test` für `draftMime.deno_test.ts` |

Pipeline je Mail: **Abholen** (`email-sync`) → **Verstehen** (Regeln, dann KI) → **Zuordnen** (Thread → Projektnummer →
Kontakt → KI) → **Handeln** (verschieben, Schlagwörter, Logbuch, Vorschläge, Entwurf). `email-process` macht die letzten
drei Stufen; Stand je Mail steht in `email_messages.status`, der Plan (was getan wurde bzw. im Schattenmodus getan würde)
in `email_messages.plan`.

**Kunde in HERO finden** (Stufe „Kontakt“, `match.ts` `findCustomer`), in dieser Reihenfolge:
1. exakt über die Adresse des Gegenübers und, bei eingehenden Mails, über die Kundenadresse aus „Verstehen“. Das ist wichtig
   für Formular-Mails von `notifications@captfix.app`, bei denen der Absender nie der Kunde ist;
2. über die Firmen-Domain (z. B. `kollege@firma.de` findet den Kunden mit `info@firma.de`), nicht bei Freemail und nicht bei der
   eigenen Domain;
3. über den Firmennamen (ohne Rechtsform verglichen). Die eigene Firma zählt nie.

Die Wege 2 und 3 zählen nur bei genau einem passenden Kunden. Der Treffer steht in `match_info.customer` (mit `via`). „Projekt
anlegen“ und „Projekt + AB“ legen das Projekt dann beim bestehenden Kunden an, ohne neuen Kontakt. In der Mail-App lässt sich das
umstellen („Falscher Kunde – neuen Kontakt anlegen“). Suchergebnisse werden 24 h in `hero_contact_cache` (Schlüssel `search:…`)
zwischengespeichert; nach dem Anlegen eines Kontakts werden Adresse und Domain verworfen.

## Einschalten – Reihenfolge

1. **Datenschutz zuerst:** AV-Vertrag mit Cloudflare (und Anthropic, wenn Haiku ausweicht), Verarbeitungsregion klären,
   Verzeichnis der Verarbeitungstätigkeiten, Datenschutzerklärung. Erst danach echte Kundenmails verarbeiten.
2. **Migrationen:** `supabase db push` (legt Tabellen, Bucket `email-attachments`, Seed, Cron-Jobs an).
   Die Cron-Jobs tun nichts, solange kein Postfach `enabled` ist.
3. **Secret setzen:** `supabase secrets set EMAIL_ENCRYPTION_KEY=$(openssl rand -hex 32)` – **Schlüssel sichern**: ohne ihn sind
   gespeicherte Passwörter/KI-Schlüssel unlesbar. (`EMAIL_CRON_SECRET` ist optional; Cron nutzt sonst `app_config.email_cron_secret`.)
4. **Functions deployen** (je einzeln, wie bei CaptFix üblich):
   ```bash
   for f in email-account-test email-sync email-process email-api email-action email-draft; do supabase functions deploy $f; done
   ```
5. **Admin-Konto:** im Supabase-Dashboard (Authentication → Users) ein Konto mit E-Mail + Passwort anlegen, dann in
   `public.profiles` eine Zeile `(id = Auth-User-ID, display_name, role = 'admin')` eintragen (siehe `docs/auth-rollout.md`).
   Keine Selbstregistrierung. Weitere Benutzer legt ein Admin danach in der Mail-App an: **Einstellungen → Benutzer**
   (Name, E-Mail, Passwort, Rolle, Postfächer). Admin = alle Postfächer + Einstellungen; Mitarbeiter = nur die angehakten
   Postfächer (`email_account_users`, Prüfung in `_shared/email/access.ts`), ohne Postfach kein Zugang. CaptFix-Mitarbeiter
   stehen schon in der Liste – bei ihnen nur Postfächer zuordnen (Passwort/aktiv bleiben CaptFix-Sache). Ein Mitarbeiter-Profil
   gilt auch in CaptFix als Personal (`is_staff()`).
6. **Mail-App auf Vercel:** zweites Projekt auf dasselbe Repo, *Root Directory* `apps/mail`, Umgebungsvariablen
   `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` (siehe `apps/mail/.env.example`). Empfohlen (Vercel → Settings → Git →
   *Ignored Build Step*): für `apps/mail` `git diff --quiet HEAD^ HEAD -- .`; für das CaptFix-Projekt `git diff --quiet HEAD^ HEAD -- . ':(exclude)apps/mail'`.
7. **In der Mail-App** (Einstellungen):
   1. *KI*: Cloudflare Account-ID + API-Schlüssel, Anthropic-Schlüssel eintragen.
   2. *Postfächer*: `info@slwerbung.de` – Passwort eintragen, **„Verbindung testen“** (das ist der Phase-0-Test in der echten Edge Runtime),
      dann **„Ordner anlegen & speichern“**, dann *Postfach aktiv* einschalten. **Schattenmodus bleibt an.**
   3. *Firma & HERO*: **„Pipeline-Schritte & Dokumenttypen aus HERO neu laden“**, Werte prüfen; Firmenwissen, Gewerke, Lexoffice-Adresse, Budget.
   4. In `app_config`: `hero_enabled = 'true'` und `hero_api_key` (wie für CaptFix) – ohne HERO werden Mails nur sortiert, nicht zugeordnet.
8. **Eine Woche Schattenmodus:** alles wird berechnet und angezeigt (Kategorien, Zuordnung, Plan, Entwürfe), im Postfach und in HERO
   ändert sich nichts außer deinen Klicks. Kategorien in „Alle Mails“ prüfen und korrigieren; optional im Tab *KI* einen
   Vergleichs-Anbieter (z. B. Haiku) für „Verstehen“ eintragen – Abweichungen zeigt die Mail-Detailansicht.
9. **Scharf schalten:** Schattenmodus aus. Bereits berechnete Mails werden **nicht** rückwirkend verschoben/protokolliert (nur neue).

## Belege: Lexware und Portal-Rechnungen

* Das Modell markiert pro Mail `beleg.is_booking_document` und `beleg.delivery` (`anhang` / `portal` / `keine`).
* **Rechnung nur im Kundenportal (z. B. Aral):** die Mail wandert in den Ordner **„8 Belege abholen (Portal)“**, `beleg_state = portal_offen`
  und sie erscheint auf der Startseite („Rechnungen im Portal abzuholen“) sowie im Filter *Belege* in „Alle Mails“. Nach dem Herunterladen
  in der Mail-Detailansicht „Abgeholt und verbucht“ drücken.
* **Mittelfristig Browser-Automatisierung:** `email_messages` mit `beleg_state = 'portal_offen'` (plus `beleg_vendor`) ist die fertige Warteschlange –
  ein Browser-Use-Lauf müsste sie nur abarbeiten, die Rechnung ins Lexware laden und den Stand auf `portal_erledigt` setzen.
* **Beleg mit Anhang → automatisch an Lexware (echter Versand, einzige Ausnahme von „Kein Versand“).** Bei jeder eingehenden Mail, die das Modell als
  buchungsrelevanten Beleg mit Beleg-Datei (PDF/Bild/XML) erkennt, sendet der Assistent die Datei(en) an die Lexware-Belegadresse
  (Einstellungen → Firma & HERO) – **nur dorthin, nie an Kunden**, höchstens einmal je Mail (`forwarded_at`), nicht im Schattenmodus, nur ab
  Konfidenz 0,7, nicht bei Portal-Rechnungen und nicht bei Mails vom Lexware-Absender selbst. Gesendet wird ausschließlich in
  `_shared/email/lexwareSend.ts` (prüft den Empfänger vor jedem Versand; ein Test sichert, dass sonst nirgends gesendet wird).
  Scheitert das Senden, liegt stattdessen ein Weiterleitungs-**Entwurf** im Postfach (der Plan der Mail sagt es). Steuerung: Autopilot
  „Belege an Lexware senden“ (Standard *Automatisch*, *Aus* schaltet ab). Manuell: Knöpfe „An Lexware senden“ / „Nur Entwurf“ in der Mail-Ansicht.
  **Voraussetzungen:** Lexware-Belegadresse eintragen, SMTP-Server im Postfach (`smtp.ionos.de`, Port 465 – 25/587 sind aus Supabase gesperrt,
  Benutzer/Passwort wie IMAP) und `info@slwerbung.de` bei Lexware als Absender hinterlegt. Beim ersten Mal mit einem Test-Beleg prüfen.

## Korrigieren und Wissensdatei

Ist ein Ergebnis falsch, schreibt man dem Assistenten in Freitext, was richtig wäre: Knopf „Falsch? Der KI sagen, was richtig ist“
in der Mail-Ansicht bzw. „Falsch? Erklären“ an jedem Vorschlag (`email-api` Aktion `teach`). Dabei passiert:

- Der Hinweis landet an der Mail (`email_messages.correction_note`), offene Vorschläge der Mail werden verworfen, die Mail läuft
  sofort neu durch (die App ruft `email-process` für das Postfach auf; ist es gerade gesperrt, beim nächsten Cron-Lauf).
- Beim erneuten Verstehen hat der Hinweis Vorrang – auch vor Absenderregeln (die Regel könnte der Grund für den Fehler sein).
  Nennt der Hinweis eine Projektnummer („gehört zu WER-1820“), wird die Mail diesem Projekt **sicher** zugeordnet
  (`match_method = manuell`, geht Thread und Betreff vor).
- Auf Wunsch entsteht ein Eintrag in der **Wissensdatei** (`email_knowledge`, Einstellungen → Wissen): für den Absender, die ganze Domain
  (nicht bei Freemail-Domains) oder alle Mails. Allgemeines Wissen steht im gecachten Systemteil des Prompts, Wissen zum Absender vor
  der Mail (`_shared/email/knowledge.ts`, Grenzen: 40 allgemeine + 15 Absender-Einträge, 6000 Zeichen). Es wirkt beim Verstehen und bei
  der Projektwahl; gibt es Absender-Wissen oder eine Korrektur, fragt die Projektwahl das Modell auch bei nur einem offenen Projekt.
- Einträge lassen sich in den Einstellungen bearbeiten, ausschalten und löschen; dort kann man auch von Hand Wissen anlegen.
  Feste „Absender → Kategorie“-Zuordnungen ohne KI bleiben Absenderregeln.

### Themen (seit Okt. 2026)

Gearbeitet wird in **Themen** (= Gesprächsverläufe, `email_threads`), Logik in `_shared/email/topics.ts` (rein, getestet) und
`topicsDb.ts`, Migration `20261029090000_email_topics.sql`.
- **Jede eingehende Mail wird einmal vorgelegt** (`email_messages.decided_at`), außer Kategorien aus `email_config.topics.skip_categories`
  (Standard: Werbung/Spam, Newsletter; Einstellungen → Firma) und an Lexware weitergeleitete Belege. Unverarbeitete Mails erst nach dem
  Klassifizieren, gescheiterte (ohne Kategorie) sofort.
- Eine Karte pro Thema. Entscheidungen: **Antworten**, **Anweisung …** (HERO-Plan, auch „Wiedervorlage in 2 Wochen“ / „Thema erledigt“),
  einen Vorschlag annehmen, **Weiter verfolgen** (gesehen, nichts zu tun), **Wiedervorlage …** (Schnellwahl/Datum + Notiz),
  **Abschließen**.
- Automatisch entschieden (Trigger): eine Antwort im Thema (aus der App ODER aus dem Gesendet-Ordner, z. B. Thunderbird/Handy),
  Weiterleiten aus der App, ein erfolgreich ausgeführter Vorschlag.
- Zustände `email_threads.topic_state`: `aktiv` (läuft, überwacht), `wiedervorlage` (`snoozed_until`, `topic_note`), `erledigt`.
  **Überwachung** (bei jedem Aufruf gerechnet, kein Cron): Kundenmail unbeantwortet seit `unanswered_days` (2) bzw. keine Bewegung seit
  `followup_days` (7) → wieder „Zu entscheiden“; jede Entscheidung setzt die Frist neu (`reviewed_at`). Abgeschlossen = nicht verfolgt,
  eine neue Mail legt das Thema wieder vor. Threads ohne relevante Mail werden nach einem Tag still abgeschlossen (ohne `closed_at`).
- „Weiter verfolgen“ und „Abschließen“ verwerfen offen gebliebene Vorschläge des Themas (ohne Folgen in HERO/Postfach); bei der
  Wiedervorlage bleiben sie und kommen mit dem Thema wieder.
- Seite **Themen** (`/themen`): Zu entscheiden / Laufend / Wiedervorlage / Abgeschlossen. In der Mail-Ansicht zeigt eine Leiste das Thema.
- Bestand beim Einführen: Mails älter als 3 Tage gelten als entschieden („altbestand“), Themen ohne Kundenkategorie als abgeschlossen;
  unbeantwortete Kundenthemen legt die Überwachung sofort vor.

- Ausgehende Mails (auch aus Thunderbird/Handy) werden nie vorgelegt: bei nur vermuteter Projektzuordnung gibt es für sie weder
  Vorschlag noch Logbuch (`act.ts`).

### Belege an Lexware aus der Themenkarte

Bei Belegen mit Anhang steht in der Themenkarte „An Lexware senden“ (derselbe Weg wie in der Mail-Ansicht: `email-draft`
`forward_beleg` → `lexwareSend.ts`, nur an die hinterlegte Belegadresse). Danach gilt der Beleg als erledigt und verschwindet aus
„Zu entscheiden“. Automatisch geht es bei neuen Belegen, sobald Belegadresse und SMTP hinterlegt sind (Autopilot `forward_beleg`).
Eine Anweisung („An Lexware weiterleiten“) kann das NICHT – dafür ist der Knopf da.
Was ein Beleg ist, entscheidet `belegRule.ts`: Rechnungen, Gutschriften, Quittungen, Abrechnungen – **nie** Auftragsbestätigungen,
Bestell-/Versandbestätigungen oder Lieferscheine (Vorgabe Okt. 2026). Andere Kategorie als „Beleg“ nur mit ausdrücklicher Rechnung im Betreff.
Automatisch an Lexware gesendete Belege werden nicht unter „Zu entscheiden“ vorgelegt (`isRelevant` in `topics.ts`).

`current_uid` (Okt. 2026 behoben): Der Sync setzte sie bei neuen Mails nicht, dadurch konnte der Assistent nichts verschieben
(„Kein IMAP-Zugriff / UID unbekannt“). Migration `20261029130000_email_current_uid.sql` (Trigger + Nachtrag) und `sync.ts`.

### Anhänge in die Dropbox

„In Dropbox …“ (Mail-Ansicht) bzw. „Anhänge in Dropbox“ (Themenkarte) legt Anhänge per Klick in den Projektordner der Firmen-Dropbox
(`email-action` `dropbox_targets`/`dropbox_save`, `_shared/email/dropboxSave.ts` + `dropboxWiring.ts`). Nutzt die bestehende
Dropbox-Anbindung (CaptFix-Admin → Integrationen, `dropbox_account`, Einstellungen `dropbox_*` in `app_config`).
- Projektordner: gemerkter Pfad (`dropbox_synced`) → im Kundenordner ein Ordner, der mit der Projektnummer beginnt → sonst nach Muster
  neu, mit Unterordner-Vorlage (wie die Automation beim Projektanlegen). Der Pfad wird danach gemerkt.
- Ziel-Unterordner nur aus der Vorlage (`dropbox_project_subfolders`) oder der Projektordner selbst; eingehende Mails → erster
  Unterordner („01 Gelieferte Daten“).
- Nur hinzufügen (`mode: add`, `autorename`) – nie überschreiben oder löschen. Gemerkt in `email_attachments.dropbox_path`.
- Die Mail muss einem HERO-Projekt zugeordnet sein. Ablegen entscheidet die Mail nicht (danach z. B. „Weiter verfolgen“).

### Ansicht „Zu entscheiden"

Jede Karte zeigt nur den Kopf (Art des Vorschlags, Kategorie, Betreff, Absender, Kurzfassung der Mail) und die Knöpfe.
Eingeklappt sind:
- **„Mail“**: die Mail selbst als HTML (`MailBody`, wird erst beim Aufklappen aus dem Postfach geholt);
- **„Vorschlag“**: alle Felder des Vorschlags zum Prüfen und Ändern. Die Zeile nennt eingeklappt das Wesentliche, z. B.
  „WER-1820 Sprinter Beschriftung“ oder „neues Projekt · 2 Position(en) · 339,90 € netto“.

Annehmen geht auch eingeklappt; dann gelten die Werte des Vorschlags.

### Vorschlag ablehnen

Ein bloßes „Ablehnen" gibt es nicht. An jedem Vorschlag stehen neben „Annehmen" zwei Wege:

- **„Nein, anders …"** = **Anweisung** (`instruct.ts`, `email-action` `instruct_plan`/`instruct_run`): in eigenen Worten, was
  passieren soll, z. B. „Neues Projekt anlegen, Angebotsentwurf und morgen Büro-Termin“ oder „gehört zu WER-1820“. Die KI
  (Aufgabe „Verstehen“) macht daraus einen Plan aus höchstens drei Bausteinen: Projekt (neu / zuordnen), Angebotsentwurf,
  HERO-Termin (Kategorie aus `appointment_category` mit Quelle hero; ohne Uhrzeit 09:00, 30 Min., „morgen“ = nächster
  Werktag). Der Plan wird gezeigt und ist bearbeitbar; erst „In HERO ausführen“ tut etwas – über dieselben Wege wie ein
  angenommener Vorschlag. Was nicht geht, steht unter „Geht nicht automatisch“. Eine Anweisung wird **nicht** in die
  Wissensdatei übernommen (sie gilt nur für diese Mail); protokolliert als `email_feedback.field = 'anweisung'`.
  Sagt die Anweisung, dass es den Kontakt schon gibt („Kontakt existiert“, „beim Kunden X“), ist das verbindlich: der Plan
  sucht den Kunden in HERO (Adresse, genannter Name, Firma, Firmen-Domain), zeigt bei mehreren eine Auswahl und legt ohne
  gewählten bestehenden Kunden nichts an. Ein neuer Kontakt entsteht ohnehin nie, wenn die Absenderadresse in HERO schon
  existiert (auch als Ansprechpartner eines Firmenkunden – `findExisting` von HERO erkennt das nicht; live passiert beim VfR).
  Außerdem versteht die Anweisung weitere HERO-Aktionen (`heroOps.ts`): Ansprechpartner anlegen, Kontaktdaten ändern, Adresse beim
  Kunden anlegen, Projektname/Ansprechpartner am Projekt, Status setzen (alle Schritte des Projektablaufs), Mitarbeiter zuweisen,
  Aufgabe anlegen, Logbuch-Notiz. Jede Aktion steht im Plan mit ihren Feldern und ist bearbeitbar. **Live zu prüfen:** Aufgaben
  (`update_task` ohne `id`) und `add_project_match_assignments` sind nur per Introspection belegt, noch nicht in HERO ausprobiert.
- **„Stattdessen nur erklären“** (Link in der Anweisungsbox, und „Falsch? Erklären“ in der Mail-Ansicht): Korrektur (`teach`) –
  Vorschläge verworfen, Mail mit dem Hinweis neu verarbeitet, auf Wunsch Eintrag in der Wissensdatei. Für Aufträge an HERO
  nicht geeignet: dabei passiert in HERO nichts, die Mail kommt nur mit neuen Vorschlägen zurück.
- In der Mail-Ansicht gibt es dieselbe Anweisung als **„In HERO erledigen …“**.
- **Alternativen:** „Projekt zuordnen“ und „Projekt anlegen“ zur selben Mail stehen als EINE Karte („Neues Projekt oder
  bestehendes?“) mit Umschalter. Wird eine Variante angenommen, schließt `email-action` die andere („Alternative gewählt“);
  „Nicht nötig“ verwirft beide.
- **„Nicht nötig"**: verwirft den Vorschlag ohne Folgen (HERO und Postfach bleiben unverändert). Der Grund
  („Schon erledigt“ o. Ä.) steht in `email_suggestions.result.reason` und als `abgelehnt: <Grund>` in `email_feedback`.
  Von dort fließt er als Korrekturbeispiel ins Verstehen ein.

## Bestellung → Projekt + Auftragsbestätigung → Versand

Kommt eine Bestellung (Kategorie „Auftrag“ oder Signal „Angebot angenommen“), entsteht der Vorschlag **„Bestellung → Auftragsbestätigung“**
(`create_confirmation`, Autopilot-Aktion „Bestellung → Projekt + Auftragsbestätigung vorbereiten“, nie automatisch):

1. **Vorlage suchen** (nur lesend): Kunde über das zugeordnete Projekt oder die Absenderadresse; davon die neuesten abgeschlossenen ABs
   (höchstens 3) und das Angebot im Projekt (höchstens 2), jeweils mit Positionen aus `published_customer_document_draft.data`.
2. **KI wählt** (Aufgabe `prepare_confirmation`, liest das Referenzwissen): welche Positionen bestellt sind und in welcher Menge.
   Namen, Artikelnummern, Einheiten und Preise kommen unverändert aus HERO. Was keiner Vorlage entspricht, steht als „Offen“ im Vorschlag.
3. **Klick „(Projekt +) AB-Entwurf in HERO anlegen“**: ggf. Kontakt + Projekt; dann `create_document` (Typ Auftragsbestätigung, `publish: false`)
   mit Aktionen – Artikel als `add_product_position` (Preis der Vorlage, Menge neu), Leistungen gleicher Menge per `add_positions_from_document`
   (Kalkulation bleibt), Leistungen mit anderer Menge als `create_supply_service` mit festem Vorlagenpreis (Hinweis). Schritt nach Wahl
   (Detailgespräch/Projektplanung, nur Whitelist), Logbuch-Eintrag mit Positionen und offenen Punkten.
4. **In HERO prüfen und abschließen** (PDF erzeugen). Danach in der Mail-App die Karte **„Prüfen & versenden“** (`send_document`):
   Status wird live gelesen; versendet wird nur ein abgeschlossenes Dokument (Status ≥ 100, PDF da) desselben Projekts, mit einer HERO-Vorlage
   des passenden Kontexts (`CUSTOMER_DOCUMENT_CONFIRMATION`, PER DU/SIE nach Anrede) über HERO `send_mail` – Betreff und Text aus der Vorlage,
   PDF als Anhang. Danach Status „Versendet“ und Logbuch. Ist das Dokument noch Entwurf, bleibt die Karte offen.

Auch **Angebote** profitieren: „Angebot vorbereiten“ legt das Angebot jetzt mit den HERO-Leistungen und Mengen an (`add_existing_service`,
Preise aus den Stammdaten) und schlägt danach ebenfalls „Prüfen & versenden“ vor.

**Live noch zu prüfen** (aus der Entwicklungsumgebung nicht ohne echten Schreibzugriff möglich): erste AB anlegen und ansehen; ersten Versand
an die **eigene Adresse** (Empfänger in der Karte änderbar) – kommt die Vorlage mit ersetzten Platzhaltern und PDF an?

## Mail-Liste und Mail-Ansicht

- **Filterleiste:** Ansichten als Reiter (inkl. **Papierkorb**), Suche und Filter als Pillen mit Ausklappmenü (Kategorie mit Anzahl,
  Zeitraum mit Voreinstellungen oder eigenem Zeitraum, Postfach, Status, HERO, Richtung, Belege, Anhang).
- **Mehrfachauswahl:** Häkchen je Mail bzw. „alle auf dieser Seite“; Sammelaktionen *Kategorie setzen* (wie einzeln korrigiert, mit Lernen),
  *Neu verarbeiten*, **Löschen** = in den Papierkorb des Postfachs verschieben (`email-mailbox`, IMAP MOVE; offene Vorschläge werden verworfen).
  Im Papierkorb: *Wiederherstellen* (zurück in den Posteingang). Endgültig gelöscht wird nie – das macht man in Thunderbird.
  Voraussetzung: der Papierkorb-Ordner ist am Postfach bekannt („Ordner anlegen & speichern“).
- **Mail-Ansicht:** die Mail als HTML aus dem Postfach (beim ersten Öffnen per IMAP geholt, danach zwischengespeichert), im abgeschotteten
  Rahmen ohne Skripte; externe Bilder (Tracking) erst per Klick. Ist die Mail nicht mehr im Postfach, wird der gespeicherte Text gezeigt.
  Hintergrundinfos (Antwortentwurf, Beleg, HERO-Zuordnung, Plan, Korrektur & Wissen, Erkannte Daten, Verlauf, Parallelvergleich,
  KI-Aufrufe) sind eingeklappt; zugeklappt zeigt jede Zeile eine Kurzinfo. Der Browser merkt sich, welche Bereiche offen sind.

## Mails schreiben und senden (Ersatz für Thunderbird)

- **Seitenleiste:** „Neue Mail“, darunter die Kategorien als Ordner (Posteingang mit den Kundenkategorien, „Ablage“ mit dem Rest,
  dazu Gesendet und Papierkorb). Die Ordner sind Filter der Liste (`/mails?category=…`), die Zahl ist die Anzahl Mails ohne Papierkorb.
  Am Handy bleiben die Kategorien im Filter „Kategorie“.
- **Verfassen** (`/verfassen`): neu, **Antworten**, **Allen antworten** (alle Empfänger außer den eigenen Adressen), **Weiterleiten**
  (Originalanhänge wählbar, sofern noch gespeichert). Von (Postfach), An/Cc/Bcc, Betreff, Text, Dateien anhängen (zusammen höchstens
  15 MB), Zitat der Originalmail ein/aus. Aus dem Antwortentwurf: „Bearbeiten & senden“ übernimmt den KI-Text (ohne die Text-Signatur).
- **Senden** (`email-send` `send`, nur per Klick mit Rückfrage): MIME mit Text- und HTML-Teil, In-Reply-To/References für den Thread,
  SMTP Port 465 des Postfachs. Danach: Kopie in den Gesendet-Ordner (`\Seen`), Original bekommt `\Answered`, ein KI-Entwurf zur Mail
  wandert auf Wunsch in den Papierkorb (nie löschen), Protokoll in `email_sent`. Der nächste Abruf übernimmt die Kopie aus „Gesendet“
  wie eine in Thunderbird gesendete Mail (Richtung „out“, HERO-Logbuch). Bcc steht nur im Umschlag, nicht im Kopf.
- **Signatur:** je Postfach eine **HTML-Signatur** (Einstellungen → Postfächer, mit Vorschau). Sie hängt an jede gesendete Mail; im
  Text-Teil als Text nach „-- “. Bilder bitte als https-Link einbinden. Die Text-Signatur bleibt für die KI-Entwürfe.
- Das Zitat stammt aus dem gespeicherten Text der Mail (bereinigt, ca. 6000 Zeichen); nach der Aufbewahrungsfrist fehlt es.

## Aufbewahrung

Die Edge Function `email-retention` läuft per pg_cron täglich um 03:17 UTC. Sie löscht für Mails, die älter als
`email_config.retention_days` sind (Standard 180):

- die Anhang-Dateien im Bucket `email-attachments`, über die Storage-API in Portionen;
- danach per `email_retention()` Mailtext und HTML-Ansicht;
- KI-Aufrufe nach 400 Tagen und Läufe nach 90 Tagen.

Absender, Betreff, Kategorie und Zuordnung bleiben erhalten, im Postfach wird nichts angefasst. Direkt in
`storage.objects` zu löschen sperrt Supabase (Trigger `storage.protect_delete`). Deshalb erledigt die Dateien die Function
und nicht SQL. Jeder Lauf steht in `email_runs` (kind `retention`).

## Referenzwissen

Einstellungen → **Referenzwissen** (`email_reference_docs`): längere Dokumente (Skill-Dateien, HERO-Doku) je KI-Aufgabe – Angebote,
Auftragsbestätigungen, Einsortieren, Antwortentwürfe. Startbestand: „HERO bei SL WERBUNG – Grundlagen“ (aktiv) und ein Platzhalter
„Angebotserstellung (Skill hero-angebote)“ (aus, bis der Inhalt von `Angebot_SKILL.md` eingefügt ist). Höchstens 60.000 Zeichen je Dokument;
pro Aufruf gelesen: 30.000 (Angebot/AB) bzw. 8.000 (Einsortieren/Entwürfe). Keine Kundendaten hineinschreiben.

## Autopilot-Stufen und Schattenmodus

*Aus / Vorschlag / Automatisch* je Aktion und Postfach. „Automatisch“ gilt nur bei Konfidenz ≥ 0,7 oder sicherer Zuordnung
(Thread, Projektnummer), sonst wird es ein Vorschlag. Im **Schattenmodus** läuft keine Automatik (kein Verschieben, keine Schlagwörter,
kein Logbuch, kein Entwurf im Postfach); **Vorschläge** entstehen trotzdem, denn sie ändern selbst nichts – erst dein Klick schreibt in HERO.

## Abweichungen vom Konzept (bewusst)

* **Lexware-Weiterleitung sendet wirklich** (auf deinen Wunsch, einzige Ausnahme von „Nichts wird versendet“): nur an die Belegadresse, siehe „Belege“.
  Antworten an Kunden bleiben Entwürfe. `imap.test.ts` stellt sicher, dass nur `lexwareSend.ts` sendet und kein Code Resend oder IMAP-Löschen nutzt.
* **Dokumenttypen statt Ordner-IDs.** Die „Dateiordner“-IDs aus dem Konzept (243132 …) sind HERO-*Ordner*; `upload_document` verlangt eine
  `document_type_id`. Seed: Plan/Layout 338164, Aufmaßdokument 279269, Druckdaten 428979 (Fahrzeugdaten und Allgemein nutzen mangels eigenen Typs
  Plan/Layout – bitte prüfen).
* **`hero_open_cache` wird nicht benutzt.** Die Tabelle gehört schon CaptFix/den HERO-Skills (anderes Format, JSON-Array). Der Assistent fragt HERO
  gezielt live ab (`project_matches(customer_id)`, `relative_id`), Kontakte werden 24 h in `hero_contact_cache` zwischengespeichert.
* **Logbuch fließt nicht in Entwürfe ein**, weil die Felder von `project_histories` im Repo nirgends belegt sind (Projektnummer, Name, Status, Dokumente und
  nächster Termin fließen ein).
* **Papierkorb statt Löschen:** ein überholter Entwurf wandert in den Papierkorb.
* **Schlagwörter** heißen `Freigabe-offen` und `KI-Entwurf` (IMAP-Schlagwörter dürfen keine Leerzeichen enthalten).
* **Morgenübersicht:** API-Aktion `digest` + Karte „Übersicht“ auf der Startseite. Die 7-Uhr-Push-Meldung hängt an deinem bestehenden
  Morgen-Task und braucht dort nur einen Aufruf von `email-api` (`{"action":"digest"}`, Admin-Sitzung) – das lag außerhalb dieses Repos.

## Noch nicht live geprüft (kein Zugang aus der Entwicklungsumgebung)

1. imapflow in der **Supabase Edge Runtime** und TLS zu **IONOS** (Test: „Verbindung testen“). Scheitert er, zieht nur `_shared/email/imap.ts` nach Vercel.
2. IONOS-Sonderordner und dauerhafte **Schlagwörter** (`phase0-imap-check.ts --write`, Ergebnis in `phase0.md` eintragen).
3. **Cloudflare-JSON-Modus** mit Llama 3.3 70B: das Schema nutzt `type: ["string","null"]`; lehnt Cloudflare das ab, greift automatisch der Ausweich-Anbieter
   (sichtbar in den KI-Aufrufen der Mail). Fünf echte Mails im Schattenmodus prüfen.
4. **`create_document`** (leeres Angebot): die Eingabe wird per Introspection gebaut (`hero.ts › createEmptyDocument`); passt sie nicht, bekommst du einen Hinweis,
   Positionsliste und Schrittwechsel stehen trotzdem. Zum Nachsehen: `email-api` `{"action":"hero_probe","mutation":"create_document"}`. Nur an einem Testprojekt ausprobieren.
5. **`create_project_match`** mit `type_id`/`step_id`: Fallback auf die in CaptFix bewährte Minimalform ist eingebaut (HERO setzt dann den Startschritt).
6. Alle HERO-Schreibzugriffe (Logbuch, Kontakt, Projekt, Schritt, Upload) laufen nur nach deinem Klick bzw. in Stufe „Automatisch“ – beim ersten Mal an einem Testprojekt.

## Fehlersuche

* Mail-App → Einstellungen → *Protokoll*: Läufe, Fehler, Token, Neurons. Je Mail: Fehlertext in der Detailansicht, Knopf „Neu verarbeiten“.
* `email_accounts.last_error`, `email_runs.note`; Function-Logs im Supabase-Dashboard.
* Hängende Sperre: `update email_accounts set locked_until = null where id = '…'` (läuft sonst nach 4 Minuten ab).
* Manuell anstoßen: Mail-App „Jetzt abrufen“ oder
  `curl -X POST https://<ref>.supabase.co/functions/v1/email-sync -H 'x-cron-secret: <app_config.email_cron_secret>' -H 'Content-Type: application/json' -d '{}'`.
* Kosten: Tab *Protokoll* → KI-Verbrauch; Budget unter *Firma & HERO*. Ist es erreicht, laufen nur Regeln und Logbuch über Thread/Projektnummer.

## Abnahmekriterien (Stand der Umsetzung)

| Phase | Kriterium | Stand |
|---|---|---|
| 0 | `phase0.md` beantwortet die Prüfpunkte; 50 Mails ohne Fehler | Bibliotheken, Abruf, Schlagwörter, Entwürfe gegen Mock-IMAP geprüft; **Live-Test ausstehend** (siehe oben) |
| 1 | Postfach anlegen/testen; neue Mails binnen 5 Min mit Kategorie + Zusammenfassung; Postfach unverändert; Parallelvergleich; Neurons/Token je Lauf | umgesetzt (Cron, `email_runs`, Schattenmodus, Vergleichs-Anbieter) |
| 2 | Ordner angelegt; Verschieben nach Autopilot; jede zugeordnete Mail genau einmal im Logbuch; Unsicheres in „Zu entscheiden“ | umgesetzt (`hero_logged_at`, Fortschritt wird sofort gespeichert) |
| 3 | Entwurf im richtigen Thread mit Umlauten, nur in den Fällen der Tabelle; Kontakt + Projekt per Klick ohne Dublette; Statusvorschläge; Anhänge im richtigen Typ | umgesetzt (`findExisting`, Thread-Kopfzeilen per Deno-Test geprüft) |
| 4 | Angebot vorbereitet; nach zwei gleichen Korrekturen Regel; Budget-/Kontingentgrenze; Lexoffice schaltbar | umgesetzt; Angebots-Dokument siehe Punkt 4 oben |
