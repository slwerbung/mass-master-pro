# Mass Master Pro – Claude Code Kontext

## Projekt
Professionelle Aufmaß-App für Schilder-/Werbetechnikfirmen.
Mitarbeiter fotografieren Standorte, annotieren Bilder, exportieren PDFs.
Kunden können Projekte online einsehen und freigeben.

## Stack
- **Frontend:** React + TypeScript + Vite + Tailwind + shadcn/ui
- **Backend:** Supabase (Frankfurt, ref: `tocukaqhclkskpvvxmrr`)
- **Deployment:** Vercel → https://mass-master-pro.vercel.app
- **Repo:** C:\Users\info\Documents\GitHub\mass-master-pro
- **Lokaler Speicher:** IndexedDB (via idb), Sync mit Supabase

## Rollen
- `admin` – voller Zugriff, Verwaltung
- `employee` – Projekte anlegen und bearbeiten
- `customer` – Kundenansicht, Freigaben, Feedback
- `guest` – Direktzugang per Projekt-Link (nutzt separaten `guest_token`)

## Auth-Modell (Stand Juli 2026 – Supabase Auth, Phase 1+2)
- Mitarbeiter und Kunden haben zusätzlich ein **echtes Supabase-Auth-Konto**
  und bekommen beim Anmelden eine Supabase-Session. Der Login sieht unverändert
  aus: Mitarbeiter wählen ihren Namen und tippen ihr Passwort, Kunden tippen
  nur ihren Namen. Die E-Mail-Adresse ist reine Technik (aus `profiles`
  aufgelöst), sie wird nie eingegeben.
- `public.profiles` verbindet `auth.users` mit `employees` bzw. `customers`.
  Rollen: `admin`, `mitarbeiter`, `kunde`.
- Policies: `is_staff()` → Vollzugriff auf Betriebsdaten;
  `current_customer_id()` / `has_customer_project()` / `has_customer_location()`
  → Kunde sieht nur seine zugewiesenen Projekte.
- **Der Anon-Key darf keine Betriebsdaten mehr lesen oder schreiben.** Offen
  bleiben nur `employees_public` (View für die Login-Liste) und
  `vehicle_field_config` (SELECT, für `/fahrzeug-anfrage`).
- Das HMAC-Token-System bleibt daneben bestehen; alle Edge Functions prüfen
  weiterhin dieses Token. `employee-auth`/`validate-customer` stellen beides aus.
- Admin läuft weiterhin rein über Passwort + Edge Functions, ohne Auth-Konto.
- Details: `docs/auth-rollout.md`, `docs/phase2-rls.md`.

## Auth-Modell (Stand Batch A+B, April 2026 – Grundlage)
- Admin, Employee und Customer loggen sich über eine Edge Function ein und
  bekommen einen **HMAC-signierten Session-Token** zurück (12 h gültig).
- Signing-Secret: `SESSION_SIGNING_SECRET` in Supabase Secrets. Muss mind. 32
  Zeichen lang sein, sonst crashen die Functions mit klarer Fehlermeldung.
- Guest hat weiter einen separaten `guest_token` (HMAC über `GUEST_TOKEN_SECRET`)
  für Direktzugriff auf ein einzelnes Projekt per Link.
- `customer-data` akzeptiert **nur noch** signierte Customer-Tokens; die alte
  `customerId`-Variante (blind vertraut) ist entfernt.
- `hero-integration` verlangt einen echten Admin- oder Employee-Token.

## Wichtige Dateien
- `src/lib/supabaseSync.ts` – Sync-Logik mit SHA-256 Image-Hash Cache (v3)
- `src/lib/indexedDBStorage.ts` – lokaler Speicher (Blobs statt Base64), defensive updateLocationMetadata
- `src/lib/session.ts` – Session-Management mit Ablaufzeit
- `src/pages/Auth.tsx` – Login (Admin/Employee/Customer), Rate Limiting
- `src/pages/CustomerLogin.tsx` – /kunde Login-Route, nutzt `validate-customer`
- `src/pages/Admin.tsx` – Admin-Bereich, alle Writes über invoke()
- `src/pages/Camera.tsx` – Kamera mit double-fire Guard
- `src/pages/PhotoEditor.tsx` – Fabric.js Bildeditor
- `src/pages/LocationDetails.tsx` – Standort speichern
- `src/pages/ProjectDetail.tsx` – Projektansicht
- `src/pages/CustomerView.tsx` – Kundenansicht (alle Writes über customer-data mit Token)
- `src/pages/CamperRepairInquiry.tsx` – öffentliches Formular `/wohnmobil-reparatur`
  (Reparaturbeschriftung für Wohnmobil-Fachbetriebe). Nutzt `submit-vehicle-request`
  mit `inquiryType: "wohnmobil_reparatur"`; Trigger `camper_repair_inquiry_submitted`
- `src/pages/ProboCatalog.tsx` – interner Probo-Katalog-Generator, Route
  `/probo-katalog` (unverlinkt, lazy, `docs/probo-katalog.md`)
- `src/pages/BookingPage.tsx` – oeffentliche Terminbuchung `/termin/:projectId`
  (lazy), dazu `BookingCancel.tsx` und `BookingStaffAction.tsx`
- `src/components/admin/BookingTab.tsx` – Adminmenue-Reiter „Termine"
  (`docs/terminbuchung.md`)
- `src/components/BookingInviteDialog.tsx` – Termineinladung aus der App
  (Projektuebersicht = allgemeiner Link, Projekt = Link mit Projektbezug)

## Bekannte Architektur-Entscheidungen
- Storage Bucket `project-files` ist **privat** (Phase 3, `docs/phase3-storage.md`).
  Dateien nur über signierte Links: `signedFileUrl()` / `signedFileUrls()` aus
  `src/lib/storageUrl.ts`, für Listen der Hook `useSignedUrls`. **Kein
  `getPublicUrl` mehr verwenden.** Edge Functions laden mit
  `storage.download()` (service_role).
- Bilder werden als **Blob** in IndexedDB gespeichert, nicht als Base64
- Projektseite und Grundrissansicht laden **ohne Originalfotos**
  (`getProject(id, session, { withOriginals: false })`, `originalImageData` ist
  dann `""`). Grund: Von dort wird die Geräte-Kamera geöffnet, und Android beendet
  die App im Hintergrund, wenn der Speicher knapp wird (Foto weg, App lädt neu).
  `src/lib/cameraGuard.ts` erkennt so einen Neustart und führt zurück.
- Kamera-Diagnose: `cameraGuard.ts` protokolliert jeden Kamera-Vorgang in
  Schritten (opened → returned → file → dims → scaled → editor). Bricht er
  durch einen Neustart ab, landet der letzte Schritt samt Gerätedaten in
  `public.client_diagnostics` (kind `camera_restart`, nur Mitarbeiter-Logins,
  60 Tage). `stage = opened` = Android hat die App während der Kamera beendet;
  alles danach = Absturz beim Verarbeiten in der App.
- Neue Fotos sind ab Ankunft neustartfest: `src/lib/captureSession.ts` (eigene
  IndexedDB `captfix-capture`) hält Foto, Zeichnung (Entwurf) und Editor-Ergebnis,
  bis der Standort bzw. das Fahrzeugbild gespeichert ist (`clearCapture()`).
  Editor, Standort-Details und Fahrzeugseite greifen darauf zurück, wenn die
  In-Memory-Übergabe (`editorHandoff.ts`) fehlt; `CameraInterruptNotice` führt
  beim App-Start dorthin zurück (mit „Verwerfen"). Jeder neue Einstieg in den
  Editor muss vorher `startCapture(file, editorPath)` aufrufen.
- Speicher beim Fotografieren (Messung Sept. 2026, Feld-Diagnose: Abbrüche
  immer bei `stage = opened`, meist ab dem 2. Foto):
  - Kamerafotos nur über `readImageFileForEditor` (`src/lib/imageFile.ts`)
    einlesen: `createImageBitmap` mit Zielgröße. **Nie ein `<img>` des
    Originalfotos auf ein Canvas zeichnen** – das hielt pro Foto die volle
    Auflösung im Speicher (12 MP ≈ 48 MB, 50 MP ≈ 200 MB), bis Android die
    App beim nächsten Kamerabesuch beendete.
  - Schwere Hintergrundarbeit (Bild-Sync, HERO-Upload) wartet über
    `waitForQuiet()` / `isQuiet()` (`src/lib/quietTime.ts`): nicht bei offener
    Kamera, nicht im Editor/Standort-Dialog, nicht im Hintergrund. Der Sync
    liest Bilder einzeln (`getProject(..., { withImages: false })` +
    `getLocationImageData`), nie das ganze Projekt als base64 auf einmal.
- Admin-Operationen gehen immer über `invoke("admin-manage", ...)` mit `adminToken`
- Image Hash Cache (SHA-256) in localStorage verhindert Re-Uploads unveränderter Bilder
- Sync läuft debounced (2,5 s) und batched (6er-Gruppen)
- Deployment läuft ausschließlich über Vercel + Supabase

## Supabase Edge Functions
Deployed via CLI. Alle Functions haben `verify_jwt = false` (eigenes Token-System).
- `validate-admin` – Admin-Passwort prüfen, signierten Token ausstellen
- `validate-employee` – Mitarbeiter-Login, signierten Token ausstellen
- `validate-customer` – Customer-Login (Name-Match), signierten Token ausstellen
- `validate-session` – Session-Token validieren (admin/employee/customer)
- `validate-guest` – Gastzugang prüfen, guest_token ausstellen
- `admin-manage` – alle Admin-Operationen (CRUD Mitarbeiter, Kunden, Felder etc.)
  (`get_project_prefix` und `get_integration_config` sind public actions)
- `customer-data` – Kundendaten laden/schreiben, verlangt `customerToken`
- `guest-data` – Gastprojektdaten, verlangt guest_token
- `ensure-customer-assignment` – Kundenzuweisung sicherstellen
- `get-view-settings` – Sichtbarkeitseinstellungen laden
- `send-notification` – E-Mail-Benachrichtigung via Resend
- `update-guest-info` – Gastinfos aktualisieren
- `hero-integration` – HERO-Software GraphQL-Gateway, verlangt echten Token
- `probo-catalog` – Probo-Reseller-API (`list`/`detail`/`image`-Proxy) für den
  internen Katalog-Generator, verlangt Admin- oder Employee-Token
  (`docs/probo-katalog.md`)
- `booking-api` – öffentliche Terminbuchung, projektbezogen (`context`/
  `availability`/`create`/`cancel`/`staff-action`). Rechnet Slots immer
  serverseitig, schreibt den Termin am HERO-Projekt (`docs/terminbuchung.md`).
  Kennt **mehrere Terminarten**: buchbar ist, was `rule_set.active` ist und
  dessen Kategorie `is_bookable` trägt. `ruleSet` gehört deshalb zu
  `availability` und `create` – nie eine Kennung fest verdrahten
- `booking-admin` – Admin-Aktionen zur Terminbuchung. Legt Terminarten auch
  **an, duplizieren und loeschen** (`create_rule_set` mit `copyFrom`,
  `delete_rule_set` nur ohne Termine daran). Weiter: (alle Terminarten,
  Personal mit Startadresse + Arbeitszeiten, Feiertage, Anfahrt, Mailschlange).
  Feiertage: Import pro Bundesland aus öffentlicher Quelle, danach bearbeitbar.
  Schreibt nur Whitelist-Schlüssel/-Spalten – der Admin-Token darf kein
  Generalschlüssel für `app_config` sein
- `booking-hero-sync` – liest HERO-Termine **und Abwesenheiten (Urlaub)** in
  `busy_block(source='hero')`, damit sie Slots blockieren. pg_cron alle 10 Min
  (`x-poll-secret`)
- `booking-mail` – Outbox-Worker fuer die Terminmails via Resend (Bestaetigung
  mit .ics, interne Benachrichtigung, Erinnerung, Absage). pg_cron alle 5 Min
- `booking-invite` – Terminlink + Einladungsmail, verlangt einen
  **Mitarbeiter**-Token. Wer einlaedt, bekommt den Termin; der Admin-Login
  kann nicht einladen (kein Mitarbeiter, keine HERO-Zuordnung). `link` gibt
  jede buchbare Terminart mit fertigem Link zurueck, `send` verlangt `ruleSet`
  – die Terminart waehlt der Mitarbeiter, nicht der Kunde

## KI-Mail-Assistent (Okt. 2026, `docs/mail-assistent/`)
Liest die Postfächer mit (IMAP), sortiert, ordnet HERO-Projekten zu, protokolliert im HERO-Logbuch und bereitet
Antworten/Projekte/Angebote vor. Eigene Oberfläche: `apps/mail/` (eigenes Vercel-Projekt, Supabase Auth, Rolle `admin`).
Inbetriebnahme, Abweichungen vom Konzept und offene Live-Prüfungen: `docs/mail-assistent/betrieb.md`.
- Edge Functions: `email-sync` (IMAP holen, pg_cron 5 Min), `email-process` (Verstehen → Zuordnen → Handeln),
  `email-action` (Klick auf einen Vorschlag: einzige Stelle mit schreibenden HERO-Aufrufen), `email-draft` (Antwortentwürfe,
  Lexoffice-Entwurf), `email-account-test`, `email-api` (einzige Schnittstelle der Mail-App für Daten), `email-mailbox` (IMAP aus der
  Mail-App: HTML-Ansicht `body`, `trash`/`restore`), `email-send` (Verfassen/Antworten/Weiterleiten und Senden aus der Mail-App,
  HTML-Signatur je Postfach), `email-retention` (Aufbewahrung, pg_cron täglich; Anhänge über die
  Storage-API, weil Supabase `DELETE` auf `storage.objects` sperrt). Jede hat ein eigenes `deno.json`
  (Import-Map für `npm:`), gemeinsamer Code in `_shared/email/`. Antworten immer HTTP 200 mit `{ ok, data | error }`.
- Tabellen `email_*` sind **nur für service_role** (RLS an, keine Policy, kein Grant) – nie vom Frontend/Anon-Key lesen.
  `hero_open_cache` gehört CaptFix und wird vom Assistenten nicht benutzt.
- Freitext-Korrekturen („Falsch? Erklären“) und Wissensdatei `email_knowledge` (`_shared/email/knowledge.ts`): fließen in Verstehen
  und Projektwahl ein; eine Korrektur hat Vorrang vor Absenderregeln, eine Projektnummer darin ordnet sicher zu (`betrieb.md`).
- Regeln vor KI; das Modell liefert nur Felder (Zod-Schema), Aktionen entscheidet der Code (`autopilot.ts`). Schattenmodus =
  keine Automatik im Postfach/HERO, nur `plan`. Vorschläge ändern nichts, bis jemand klickt.
- **„Löschen“ in der Mail-App = in den Papierkorb des Postfachs VERSCHIEBEN** (IMAP MOVE, `email-mailbox` `trash`, `trashed_at`),
  wiederherstellbar. Endgültig gelöscht wird nie.
- HTML-Ansicht: `email-mailbox` `body` holt per IMAP nur HTML/Text und eingebettete Bilder (BODYSTRUCTURE, `fetchDisplay` – nie die
  ganze Mail durch mailparser: grosse Anhaenge sprengen das CPU-Limit), bettet `cid:`-Bilder ein (`mailHtml.ts`) und speichert in `body_html`
  (Aufbewahrungsfrist wie `body_text`). Angezeigt nur im iframe mit `sandbox` ohne Skripte und CSP; externe Bilder erst per Klick.
- **Kein Versand, kein Löschen – drei Ausnahmen:** Der Assistent selbst schreibt Antworten nur als ENTWÜRFE in „Entwürfe“; kein Resend, kein
  `messageDelete`/`\Deleted`/expunge. Ausnahmen (ausdrücklich freigegeben): (1) Belege gehen automatisch per SMTP (Port 465) an die
  Lexware-Belegadresse, ausschließlich über `_shared/email/lexwareSend.ts` (prüft den Empfänger). (2) Ein in HERO geprüftes und
  abgeschlossenes Angebot / eine AB geht **nur per Klick** in der Mail-App über HERO `send_mail` (HERO-Vorlage + PDF) an den Kunden –
  ausschließlich `sendDocument` in `action.ts` → `sendDocumentMail` in `hero.ts`. (3) Mails, die ein Mensch in der Mail-App verfasst
  (neu, Antwort, Weiterleitung), gehen **nur per Klick** auf „Senden“ per SMTP raus – ausschließlich `sendComposed` in
  `composeSend.ts`, aufgerufen nur aus `email-send` (Admin-Sitzung); Kopie in „Gesendet“, Protokoll `email_sent`.
  `imap.test.ts` prüft alle drei im Quelltext. Kategorien sind in der Seitenleiste der Mail-App als Ordner (= Filter, kein IMAP-Ordner).
- Bestellung → Projekt + AB: Vorschlag `create_confirmation` (`confirmation.ts`/`confirmationWiring.ts`). Grundlage ist die frühere AB des
  Kunden bzw. das Angebot im Projekt; Namen/Preise kommen aus HERO, die KI wählt nur Positionen und Mengen. HERO-Dokumente entstehen
  über `create_document(input, actions)` als ENTWURF (`publish: false`); danach Vorschlag `send_document` („Prüfen & versenden“).
- „Nein, anders …“ = Anweisung (`instruct.ts`): KI-Plan (Projekt neu/zuordnen, Angebotsentwurf, HERO-Termine – mehrere, je mit Mitarbeiter
  als `partner_ids`; Mitarbeiterliste aus HERO-Terminen + `employees.hero_partner_id`) → Vorschau → Klick führt
  über `decideSuggestion` bzw. `heroCreateAppointment` aus. Anweisungen nie in die Wissensdatei (gelten nur für die eine Mail).
- **Themen** (`_shared/email/topics.ts` + `topicsDb.ts`, `betrieb.md`): jede eingehende Mail außer Werbung/Spam/Newsletter wird EINMAL unter
  „Zu entscheiden“ vorgelegt (`email_messages.decided_at`), eine Karte pro Thema (= `email_threads`). Thema: läuft (überwacht:
  unbeantwortet/keine Bewegung → wieder vorlegen), Wiedervorlage (`snoozed_until`) oder abgeschlossen (`topic_state`). Antworten,
  Weiterleiten und ausgeführte Vorschläge entscheiden per Trigger mit. Eine neue Mail legt jedes Thema wieder vor. Ordner/Kategorien bleiben.
- Weitere HERO-Aktionen der Anweisung: `_shared/email/heroOps.ts` (Ansprechpartner anlegen, Kontaktdaten ändern, Kundenadresse, Projektname/
  -ansprechpartner, Status, Mitarbeiter zuweisen, Aufgabe, Logbuch). Das Modell liefert Namen, der Code löst IDs auf und prüft vor dem
  Schreiben gegen HERO (Kontakt gehört zum Kunden, Schritt zum Ablauf, Mitarbeiter bekannt). Bewusst nicht: Löschen, `send_mail`,
  Zahlungen/Belege, Stammdaten-/Vorlagenpflege. Aufgaben entstehen über `update_task` ohne `id`.
- **Nie ein Dubletten-Kontakt in HERO:** gibt es die Absenderadresse schon (auch als Ansprechpartner), wird das Projekt dort angelegt
  (`createProject` in `action.ts`); bei mehreren Treffern gilt das ältere Original (`preferEstablished`). Sagt eine Anweisung
  „Kontakt gibt es schon“ (`contact: vorhanden`), wird nur bei einem bestehenden Kunden angelegt – nicht gefunden = nichts anlegen.
- Gewerk: alle Projekte sind **WER**. Unbekanntes/fehlendes Gewerk → Standard-Gewerk aus `email_config.gewerke`, nie eine freie `measure_id`.
- Referenzwissen (`email_reference_docs`, Einstellungen → Referenzwissen): Skill-Dateien/HERO-Doku je KI-Aufgabe, `loadReference()`.
- Rechnungen nur im Kundenportal (z. B. Aral): Ordner „8 Belege abholen (Portal)“, `email_messages.beleg_state = 'portal_offen'` ist die
  Warteschlange für eine spätere Browser-Automatisierung.
- `apps/mail/src/lib/shared.ts` ist eine Kopie von `_shared/email/types.ts` (`npm run sync-shared`; ein Test prüft die Gleichheit).
- Tests: `npm run test:unit` (vitest) + `deno test` für `draftMime.deno_test.ts`; Typprüfung der Functions mit
  `deno check --config supabase/functions/<fn>/deno.json supabase/functions/<fn>/index.ts`, der App mit `npm run typecheck` in `apps/mail`.

## Offene Baustellen
1. ~~Anon-RLS schließen~~ – erledigt (Phase 2, `docs/phase2-rls.md`)
2. ~~Bucket privat + Signed URLs~~ – erledigt (Phase 3, `docs/phase3-storage.md`).
   ~~`run-automations`, `hero-dropbox-poll` und `submit-vehicle-request`
   tragen noch die alte `aufmassPdf.ts` im Bundle~~ – erledigt (Sept. 2026,
   alle drei neu deployt und byte-genau gegen das Repo verifiziert).
3. ~~Konflikt-Sync: last-write-wins auf Projekt-Ebene~~ – erledigt (Sept. 2026).
   `locations.updated_at` + lokaler Stempel pro Standort; bei Konflikt wird
   pro Standort entschieden statt das ganze Projekt zu verwerfen
   (`findLocallyNewerLocations` / `reapplyLocalLocations` in `supabaseSync.ts`).
   Offen bleibt der Fall, dass ZWEI Leute DENSELBEN Standort gleichzeitig
   ändern – dort gilt weiter last-write-wins (auf Standort-Ebene).

## Workflow
1. Änderungen direkt im Repo vornehmen
2. `git add .` → `git commit -m "..."` → `git push`
3. Vercel deployed automatisch
4. Edge-Function-Änderungen manuell via `supabase functions deploy <name>`
5. Migrations via `supabase db push`

Typprüfung: **`npx tsc --noEmit` prüft hier nichts** (das Root-`tsconfig.json`
hat `files: []` und arbeitet nur mit References). Der echte Befehl ist
`npx tsc --noEmit -p tsconfig.app.json`. `npm run build` (esbuild) prüft
ebenfalls keine Typen.

## Commit-Stil
Kurze prägnante Messages auf Englisch:
- `fix: beschreibung`
- `feat: beschreibung`
- `perf: beschreibung`
- `chore: beschreibung`
- `sec: beschreibung` (Security-Fixes)

## Was vermeiden
- Im Mail-Assistenten nie etwas senden (außer Belege an die Lexware-Adresse über `lexwareSend.ts`, geprüfte Angebote/ABs per Klick über
  `sendDocument` und vom Menschen verfasste Mails per Klick über `email-send`/`composeSend.ts` – nie automatisch) oder löschen, nie `email_*`-Tabellen für anon/authenticated freigeben,
  nie IMAP-Passwörter oder KI-Schlüssel im Klartext speichern/loggen/zurückgeben (`EMAIL_ENCRYPTION_KEY`, AES-GCM).
- Keine HERO-„Dateiordner“-IDs als `document_type_id` verwenden (Ordner ≠ Dokumenttyp, siehe `phase0.md`).
- Niemals Signing-Secret-Fallback im Code (kein `|| "fallback"`)
- Keine direkten Supabase-Writes in Admin-Funktionen (immer invoke())
- Keine Base64-Strings direkt in IndexedDB speichern
- Kein `navigate()` direkt im Render-Rückgabepfad (immer useEffect)
- Keine unbegrenzten Promise.all bei vielen Bildern (loadInBatches verwenden)
- Kein GraphQL-String-Interpolation für fremde Inputs (immer Variables nutzen)
- Bei `updateLocationMetadata` (und ähnlichen partial-updates) niemals
  Felder blind `...record, field: data.field` setzen – das überschreibt mit
  undefined. Immer `Object.prototype.hasOwnProperty.call(data, 'field')`.
- Keine Koordinaten-Eingabefelder im Adminmenue. Der Anwender trägt eine
  Adresse ein, der Server geocodiert (`staff.home_base_address`, nur bei
  Änderung).
- Der Routing-Schlüssel `ORS_API_KEY` gehört in die Supabase-Secrets, **nicht**
  in `app_config` – das Adminmenue kann `app_config` lesen.
- Keine fest verdrahtete Terminart-Kennung. Es gibt mehrere Terminarten; wer
  eine Kennung hart einträgt, macht die anderen unsichtbar (genau so passiert).
- Die **Dauer eines Termins** entscheidet nie der Link, sondern
  `_shared/booking/duration.ts` gegen die Terminart. Ein Link ist von Hand
  änderbar: eine Wunschdauer außerhalb der Grenzen wird geklemmt (nicht
  abgelehnt – ein toter Link sperrt den Kunden aus), bei einer Terminart ohne
  `duration_choosable` schlicht ignoriert. Im Link steht sie als `&d=<minuten>`
  bzw. als Pfadsegment `/d<minuten>`; das `d` ist Pflicht, sonst ist die Zahl
  nicht von einer Projektnummer zu unterscheiden.
- Beim Buchen **nie `slot.endsAt` des Frontends übernehmen**. Das Ende kommt
  aus dem neu gerechneten Slot, sonst ließe sich eine Achtstunden-Montage als
  Zehnminuten-Termin eintragen (geprüft wurde nur die Startzeit).
- **Terminorte** (`rule_set.location_mode`): bei `buero`, `telefon` und
  `online` wird keine Adresse gefragt und keine Anfahrt gerechnet – dafür
  braucht die Engine keinen Sonderfall, sie bekommt einfach keine Adresse
  (`engine.ts` rechnet Fahrzeit und Radius nur mit Adresse). Der Videoraum
  gehört an die **Buchung** (`booking.meeting_url`), nicht an die Terminart,
  sonst sitzen zwei Kunden im selben Meeting.
- HERO kann in einer Mailvorlage **keine Dauer einsetzen**. Darum trägt eine
  Vorlage eine feste Länge im Pfad (Vorlagen 66033–66042 für 8/6/4/2/1 Std.,
  je per Du und per Sie).
- Keine Qualifikationen/Skills bei Terminarten. `rule_set.required_skills`
  bleibt leer – gefüllt heißt es „niemand kann das" und damit dauerhaft null
  freie Zeiten.
- Terminlinks nie im Frontend zusammenbauen. Sie kommen aus `booking-invite`,
  sonst steht in der Mail etwas anderes als im Kalender.
- In HERO-Mailvorlagen gibt es **kein** `{{ProjectMatch.id}}` – nur
  `{{ProjectMatch.display_id}}`, und das ist die reine Zahl („1744", nicht
  „WER-1744"). Platzhalter werden auch innerhalb eines Links ersetzt (geprüft).
- Platzhalter in HERO-Mailvorlagen gehören **in den Pfad, nie in den
  Query-String**: der Vorlagen-Editor hat den Link hinter
  `&p={{ProjectMatch.display_id}}` abgeschnitten (im Serverlog kam der Klick
  ohne `p` an, die Buchungsseite blieb ohne Adresse). Terminlink für Vorlagen:
  `/termin/m/{{Partner.last_name}}/{{ProjectMatch.display_id}}/<terminart>`
  – Terminart als festes Segment am Ende, damit der Link nicht auf einer
  Klammer endet.
- Terminlinks in HERO-Vorlagen stehen als **reiner Text**, nie als `<a href>`:
  der Editor kodiert Klammern im href (`%7B%7B…%7D%7D`), und kodiert wird nie
  ersetzt. Die Vorlagen (63591–63594 für Kundentermin und Aufmaß, 66033–66042
  für die Montage je Länge – jeweils per Du und per Sie) sind
  über `create_email_template` angelegt; wer sie im HERO-Editor speichert, muss
  den Link danach prüfen. Versand nur **aus dem Projekt**, sonst ist
  `{{ProjectMatch.display_id}}` leer (`docs/terminbuchung.md`).
- Neue öffentliche Route + PWA = 404 aus dem Cache. Der Service Worker liefert
  Wiederkehrern die precachte `index.html` mit dem ALTEN JS; eine neu
  hinzugekommene Route landet dann im 404 der App, obwohl sie live ist. Routen
  für Links aus Mails gehören deshalb in `navigateFallbackDenylist`
  (`vite.config.ts`, bereits `/^\/termin\//` und `/^\/mister-x-live\//`).
  Beim Prüfen daran denken: Vercel antwortet dabei mit 200.
- Bei HERO-Kalendereinträgen ist `category_id` PFLICHT (`project_match_id`
  dagegen optional). Ohne Kategorie entsteht kein Termin.
- **HERO rechnet nicht mit Zeitzonen.** Jede Zeit trägt „+00:00", gemeint ist
  aber die Uhrzeit, die in HERO auf dem Bildschirm steht (Ortszeit). Schreiben
  nur über `toHeroTime()`, lesen nur über `heroWallClock()`
  (`_shared/booking/hero.ts`, Tests in `hero.test.ts`). Wer den Offset glaubt,
  trägt Termine zwei Stunden zu früh ein und liest HERO-Termine zwei Stunden zu
  spät – beides live passiert (14:00 gebucht → 12:00 in HERO; Automationen für
  „09:00" legten 07:00 an).
- Beim Deploy einer Edge Function über das Supabase-MCP-Werkzeug **immer
  `verify_jwt: false` mitgeben**. Der Standard ist `true`; weggelassen schaltet
  das Gateway eine JWT-Prüfung davor und jeder Aufruf ohne
  `Authorization`-Header wird abgewiesen, bevor die Function läuft – damit
  stirbt jeder pg_cron-Job (schickt nur `x-poll-secret`), live passiert bei
  `booking-hero-sync`. Alle Functions hier prüfen selbst.
- Urlaub steht in HERO **nicht** in `calendar_events`, sondern in `absences`
  (Personalverwaltung). Wer nur Termine liest, bietet Urlaubstage als frei an
  (genau so passiert). Dort ist `end` der **letzte** Urlaubstag, nicht der Tag
  danach – Spanne nur über `absenceSpan()` (`_shared/booking/absence.ts`),
  sonst bleibt der letzte Urlaubstag buchbar.
- Die **Objektadresse** eines HERO-Projekts steht an `project_match.address`.
  `project.address` ist etwas anderes – dort steht in der Praxis die
  Kundenadresse. Reihenfolge: `project_match.address` → `project.address` →
  Adresse des Kunden.
- In Kundenmails steht **nie** „Captfix" und nie nur ein Mitarbeiter-Nachname.
  Branding ist der Firmenname aus `legal_info` (Fußzeile, Anzeigename des
  Absenders, ORGANIZER im .ics). Die Absenderadresse bleibt
  `notifications@captfix.app` – dort liegt die bei Resend verifizierte Domain.
