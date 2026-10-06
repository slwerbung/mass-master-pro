# Mail-Assistent – Inbetriebnahme und Betrieb

Konzept: Claude-Doc „KI-Mail-Assistent – Konzept“. Dieses Dokument sagt, **was im Repo steht, in welcher
Reihenfolge man es einschaltet und was bewusst anders gelöst ist als im Konzept**.

## Bausteine

| Teil | Ort |
|---|---|
| Tabellen, Seed, Cron, Aufbewahrung | `supabase/migrations/20261007100000…`, `…100100…`, `…100200…`, `…100300…`, `20261008090000…` |
| Gemeinsamer Code | `supabase/functions/_shared/email/` (IMAP, KI-Schicht, Klassifikation, Zuordnung, Handeln, Entwürfe, HERO) |
| Edge Functions | `email-account-test`, `email-sync`, `email-process`, `email-api`, `email-action`, `email-draft` |
| Mail-App | `apps/mail/` (Vite + React + TS + Tailwind), eigenes Vercel-Projekt |
| Phase-0-Skript | `scripts/mail-assistant/phase0-imap-check.ts` |
| Tests | `npm run test:unit` (vitest, ~340 Tests) und `deno test` für `draftMime.deno_test.ts` |

Pipeline je Mail: **Abholen** (`email-sync`) → **Verstehen** (Regeln, dann KI) → **Zuordnen** (Thread → Projektnummer →
Kontakt → KI) → **Handeln** (verschieben, Schlagwörter, Logbuch, Vorschläge, Entwurf). `email-process` macht die letzten
drei Stufen; Stand je Mail steht in `email_messages.status`, der Plan (was getan wurde bzw. im Schattenmodus getan würde)
in `email_messages.plan`.

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
   Keine Selbstregistrierung.
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

## Autopilot-Stufen und Schattenmodus

*Aus / Vorschlag / Automatisch* je Aktion und Postfach. „Automatisch“ gilt nur bei Konfidenz ≥ 0,7 oder sicherer Zuordnung
(Thread, Projektnummer), sonst wird es ein Vorschlag. Im **Schattenmodus** läuft keine Automatik (kein Verschieben, keine Schlagwörter,
kein Logbuch, kein Entwurf im Postfach); **Vorschläge** entstehen trotzdem, denn sie ändern selbst nichts – erst dein Klick schreibt in HERO.

## Abweichungen vom Konzept (bewusst)

* **Lexoffice-Weiterleitung = Entwurf.** Das Konzept verbietet jeden Versand („Nichts wird versendet“) und verlangt zugleich eine Weiterleitung.
  Gelöst so: der Assistent legt einen fertigen Weiterleitungs-**Entwurf** (An: Belegadresse, Anhänge dran) in „Entwürfe“; Senden bleibt in
  Thunderbird bei einem Menschen. Ein Test (`imap.test.ts`) stellt sicher, dass der Code weder SMTP noch Resend noch IMAP-Löschen enthält.
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
