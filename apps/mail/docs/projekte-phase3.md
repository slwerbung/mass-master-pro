# Projekte – Phase 3: Nachfassen

## Was dazugekommen ist
- **Entwurf in der Karte** (Regeln mit Mailweg: `nachfassen`, `freigabe_offen`, `abholung`): Empfänger, Betreff, Text bearbeiten, **Senden** mit einem Klick, „Für dieses Projekt automatisch nachfassen“.
- **Sammelkarte** „N Nachfass-Mails bereit“ (ab 2 Entwürfen, Regel auf „Vorschlagen“): Liste mit Haken, „N senden“, „Künftig automatisch“ (nur Admin, mit Bestätigung).
- **Nachfass-Kette:** Stufe 1 Mail 7 Tage nach Angebotsversand → Stufe 2 Anruf-Karte (Telefonnummer, „Anruf erledigt“) 7 Tage nach der Mail → Stufe 3 „Angebot verloren?“ nach 30 Tagen (Vorschlag: archivieren). Ein neues Angebot beginnt die Kette von vorn.
- **Kunde antwortet:** Die Kette stoppt (Entwürfe `stopped`), die Karte wird zu „Kunde hat geantwortet“ und bleibt, bis ein Mensch sie bearbeitet.
- **Autopilot** je Regel (Aus / Vorschlagen / Automatisch) und je Projekt (schlägt die Regel), Dialog „Autopilot“ in der Kopfzeile mit Zähler.
- **`followup-runner`** (stündlich, Minute 12): sendet im Versandfenster fällige Entwürfe der Regeln/Projekte auf „Automatisch“.
- Admin → Projekte: Nachfass-Vorlagen je Regel und Stufe, Versandfenster, Grenzen je Lauf/Tag.
- Kontaktdaten: `hero_projects.kunde_email` / `kunde_telefon` (aus HERO `customer { email phone_mobile phone_home }`, live geprüft: E-Mail bei 47 von 50, Telefon bei 34 von 50 Projekten).

## So wird gesendet (wichtig)
Die Projekte-Functions senden **nie selbst**. Gesendet wird ein **gespeicherter Entwurf** über den bestehenden Weg `email-send` → `send` (HTML-Signatur des Postfachs, Thread zur letzten Kundenmail, Kopie in „Gesendet“, `email_sent.project_id` → HERO-Logbuch wie bei jeder Mail der Mail-App). Zwei neue Aktionen in `email-send`:
- `send_followup` – per Klick, Sitzung des Benutzers (eigene Postfächer, Sichtbarkeit des Projekts).
- `send_followup_auto` – nur mit Cron-Secret, vom `followup-runner`.

Empfänger, Betreff und Text kommen ausschließlich aus dem Entwurf (nie aus der Anfrage). Die Regeln stehen an einer Stelle (`_shared/projects/followupSend.ts`):
1. **Schattenmodus** (`projects_write_enabled` ≠ `true`): nichts wird gesendet, nur `project_actions_log` (`shadow = true`) – auch nicht automatisch.
2. **Doppelversand:** Der Entwurf wird atomar `draft` → `sending` gesetzt; ein zweiter Klick oder Lauf scheitert.
3. **Hat der Kunde nach dem Entwurf geschrieben,** wird nicht gesendet, der Entwurf gestoppt.
4. **Automatisch** nur mit Autopilot „Automatisch“ (Projekt vor Regel), offener Karte (nie Aufräum-Karten > 60 Tage), im Versandfenster (Standard Mo–Fr 8–17 Uhr, Berliner Zeit), unter dem Tageslimit (Standard 20, je Lauf 5).
5. **Fehler:** per Klick bleibt der Entwurf offen mit Fehlermeldung; automatisch wird der Entwurf gestoppt (kein zweiter Versuch, ein Mensch entscheidet).
6. Nach dem Senden: Wiedervorlage nach der Regel (Standard 7 Tage) und Karte zurückgestellt. Fehlt die Kopie im Gesendet-Ordner (Warnung), schreibt `email-send` ersatzweise einen Logbuch-Eintrag.

Voreinstellung: `nachfassen`, `freigabe_offen`, `abholung` stehen auf **Vorschlagen**, alle anderen auf Aus. Nichts steht auf Automatisch, und der Schattenmodus ist an.

## Absicherung
`send-guard.test.ts` prüft im Quelltext: Die Projekte-Functions enthalten kein `sendComposed`/`sendMail`/`createTransport`/Resend/HERO-`send_mail`; `sendComposed` bleibt in `email-send` einmalig in `send`; `send_followup_auto` verlangt das Cron-Secret vor allem anderen; Empfänger/Text kommen nicht aus der Anfrage; im Versandkern stehen Schattenmodus, Autopilot-, Fenster- und Limit-Prüfung vor dem Senden; der Runner ruft nur `send_followup_auto`.

## Deploy (Reihenfolge)
1. Migration `20261113100000_projects_phase3.sql` (neue Spalten, Entwurfs-Status, Kettenregeln, Limits).
2. Functions deployen: `hero-sync` (schreibt die neuen Spalten), `project-evaluate`, `project-api`, `project-action`, **`email-send`** (per CLI; war zuletzt über den Lader eingespielt), `followup-runner` (neu).
3. Migration `20261113100100_projects_followup_cron.sql` (Cron stündlich).
```bash
supabase db push
supabase functions deploy hero-sync project-evaluate project-api project-action email-send followup-runner --no-verify-jwt
```

## Abnahme (live, offen)
Mit Schalter **aus** (Schattenmodus):
- [ ] Entwürfe erscheinen in den Karten (Regel `nachfassen`); „Senden“ und Sammelkarte melden „Schattenmodus“, es geht keine Mail raus.
- [ ] `followup-runner` läuft und meldet `skipped: Schattenmodus`.

Dann Schalter **an**, Autopilot weiter auf „Vorschlagen“:
- [ ] 5 Nachfass-Mails über die Sammelkarte senden: alle im Postfach „Gesendet“, im HERO-Logbuch, Wiedervorlage 7 T gesetzt.
- [ ] Nur an einem Testprojekt: Autopilot „für dieses Projekt automatisch“ → Versand ohne Klick im Versandfenster; Kundenantwort stoppt die Kette.
- [ ] Autopilot je Projekt überschreibt die Regel (Projekt „Aus“ bei Regel „Automatisch“ sendet nicht).
