# Mail-Assistent – Phase 0: Technik-Check

Stand: 6./7. Oktober 2026. Die Phase wurde in einer Cloud-Sitzung ohne Zugang zu
IONOS, HERO und Supabase-Secrets gebaut. Was sich dort prüfen ließ, steht unter
**Geprüft**; was nur gegen das echte Postfach / den echten HERO-Account geht,
steht unter **Offen (live prüfen)** – mit dem Befehl dafür.

## Entscheidung: IMAP-Laufzeit

**Supabase Edge Function (Deno) mit `npm:imapflow`**, kein Vercel-Fallback – unter
dem Vorbehalt, dass der Live-Test (unten) in der echten Edge Runtime besteht.
Der IMAP-Teil steckt vollständig in `supabase/functions/_shared/email/imap.ts`
und hängt an nichts anderem; scheitert der Live-Test, zieht genau diese Datei in
eine Vercel-Node-Function um, der Rest bleibt unverändert.

## Geprüft

| Punkt | Ergebnis |
|---|---|
| `imapflow@1.0.172`, `mailparser@3.7.1`, `nodemailer@6.9.16` (MailComposer) laden unter Deno 2 über `npm:` | ja, ohne Polyfills |
| MailComposer baut Umlaute korrekt (`=?UTF-8?Q?…`), `simpleParser` liest sie zurück | ja |
| Verbindung, Ordnerliste, Sonderordner über `specialUse` (`\Sent`, `\Drafts`, `\Trash`, `\Junk`) | ja (Mock) |
| 50 Mails holen + parsen (`fetchNew`), UID-Fortsetzung, `N:*`-Falle (liefert immer mind. die letzte Mail) | ja (Mock: 50 Mails in ~0,24 s) |
| Schlagwort setzen, in zweiter Verbindung lesen, wieder entfernen | ja (Mock) |
| Entwurf per `APPEND` in den Entwürfe-Ordner | ja (Mock) |
| Kein SMTP, kein `messageDelete` im Code | per Test abgesichert (`imap.test.ts`) |
| `upload_document`-Ablauf | schon produktiv im Repo (`hero-upload-proxy`): 1. `POST /app/v8/FileUploads/upload` (multipart, Header `x-auth-token`), 2. UUID aus `data.uuid`, 3. `upload_document(document:{document_type_id}, file_upload_uuid, target: project_match, target_id)`. **Korrektur:** die „Dateiordner“-IDs aus dem Konzept (243132 …) sind HERO-*Ordner* (`file_upload_folders`), keine Dokumenttypen. Verwendet werden die Dokumenttypen Plan/Layout 338164, Aufmaßdokument 279269, Druckdaten 428979 (HERO-Skill, Stand 23.09.2026); per Knopf „aus HERO neu laden“ aktualisierbar. |
| `add_logbook_entry`, `create_contact(findExisting)`, `create_project_match` | schon produktiv im Repo (`hero-integration`, `submit-vehicle-request`); `_shared/email/hero.ts` übernimmt die dort bewährten Aufrufe |

Der Mock-Server war `hoodiecrow-imap` (reiner IMAP-Server in Node). Er beweist
die Logik von `imap.ts`, **nicht** das Verhalten von IONOS und nicht die Supabase
Edge Runtime.

## Offen (live prüfen)

Alles mit Silas’ Zugangsdaten, nichts davon verändert Postfach-Inhalte ohne `--write`:

1. **imapflow in der Supabase Edge Runtime / TLS zu IONOS.**
   Nach dem Deploy von `email-account-test` im Admin-Bereich der Mail-App
   „Verbindung testen" drücken (oder per `curl`, siehe `docs/mail-assistent/betrieb.md`).
   Die Function macht genau Login → Ordnerliste → 50 Mails holen und meldet
   Laufzeit und Fehler. Schlägt das fehl: `imap.ts` nach Vercel (Node) verlegen.
2. **Sonderordner und Schlagwörter bei IONOS.** Lokal gegen das echte Postfach:
   ```bash
   IMAP_HOST=imap.ionos.de IMAP_USER=info@slwerbung.de IMAP_PASS='…' \
   deno run -A --config scripts/mail-assistant/deno.json \
     scripts/mail-assistant/phase0-imap-check.ts --write
   ```
   Ausgabe (JSON) hier eintragen: `folders[].specialUse`, `keywordPersisted`,
   `permanentFlags`. Erwartung: `\Sent`/`\Drafts`/`\Trash`/`\Junk` gesetzt,
   `permanentFlags` enthält `\*` (freie Schlagwörter erlaubt). Fehlt `\*` oder
   `keywordPersisted` ist `false`, werden Schlagwörter in der Mail-App nur
   angezeigt statt im Postfach gesetzt (`autopilot.keywords` auf „aus").
   Das Skript legt einen Test-Entwurf an; bitte von Hand entfernen.
3. **`create_document` für ein leeres Angebot.** Im Repo nirgends benutzt, daher
   ungeprüft. `email-api` bietet dafür die Admin-Aktion `hero_probe`
   (`{"action":"hero_probe","mutation":"create_document"}`), die nur **liest**
   (Argumente per Introspection, Anzahl `supply_services`). `hero.ts › createEmptyDocument`
   baut die Eingabe selbst aus dem Eingabetyp; geschrieben wird erst bei Klick in Phase 4
   und nur an einem Testprojekt nach Freigabe. Laut HERO-Skill kann die API Dokumente nur leer anlegen
   (keine Positionen).
4. **Cloudflare JSON-Modus mit Llama 3.3 70B an fünf echten Mails.** Braucht den
   Cloudflare-Schlüssel (Mail-App → Einstellungen → KI-Anbieter). Die Mail-App
   hat dafür den Schattenmodus mit Parallelvergleich zweier Modelle; fünf Mails
   dort prüfen, Abweichungen stehen in der Mail-Detailansicht.

## Folgerungen für den Bau

* `imap.ts` ist die einzige Datei mit IMAP-Wissen – bewusst austauschbar.
* Ordner werden beim Einrichten angelegt, aber nur nach `ensureFolders` (idempotent).
* Beim ersten Sync holt `fetchNew` nur die letzten `backfill` (Standard 50) Mails,
  nicht das ganze Archiv – jede Mail kostet KI-Aufrufe.
