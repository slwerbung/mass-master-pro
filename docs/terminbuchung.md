# Terminbuchungs-Engine — Umsetzungsstand

Umsetzung der Spec (`terminbuchungSPEC.md`) in Meilensteinen. Dieses Dokument
hält Stand + bewusste Abweichungen fest.

## Stand (01.10.2026)
- **Einladung durch einen Mitarbeiter:** ✅ Der Termin gehört dem, der
  eingeladen hat. Zwei Linkformen, zwei Einstiege in der App, keine
  Qualifikationen mehr (siehe „Einladungen“ weiter unten).
- `booking-api` v6, `booking-admin` v5, `booking-invite` v1 — alle byte-genau
  gegen das Repo verifiziert.

## Stand (25.09.2026)
- **M1 — Datenmodell & Seeds:** ✅ angewandt (`20260828000000_booking_m1.sql`).
- **M2 — Engine:** ✅ reine `computeSlots` + `TravelTimeProvider` + Unit-Tests.
- **M3 — Buchungs-API:** ✅ `booking-api` **deployt** (v5, byte-genau gegen das Repo
  verifiziert). Projektbezogen, Adresse und Kontakt aus HERO, **mehrere
  Terminarten**.
- **Feiertage + Admin-Aktionen:** ✅ `booking-admin` **deployt** (v4). Abweichung
  zum Repo: dem deployten Stand fehlt ein dreizeiliger Kommentar über
  `sync_staff_from_employees` (beim Deploy verlorengegangen), der Code ist
  identisch. Richtet sich beim nächsten Deploy von selbst.
- **Echtes Routing:** ✅ im Code (OpenRouteService). Wartet nur noch auf den
  Schlüssel im Supabase-Secret `ORS_API_KEY` und `booking_travel_mode=routing`.
- **HERO-Leserichtung:** ✅ `booking-hero-sync` deployt, pg_cron alle 10 Minuten,
  live gegen Produktion geprüft (12 Termine im Fenster → 10 Blocks).
- **Mail-Outbox:** ✅ `booking-mail` deployt, pg_cron alle 5 Minuten.
- **Oberflaechen:** ✅ öffentliche Buchungsseite `/termin/:projectId`,
  Absage-/Umbuchungsseiten, Admin-Reiter „Termine“, Terminleiste auf der
  Startseite.
- **Durchlauf mit echter Buchung:** ✅ 24.09.2026 zweimal komplett gefahren
  (siehe unten). Dabei kamen zwei echte Fehler heraus.
- **Plausibilitätscheck Adminmenü:** ✅ 25.09.2026 (siehe unten). Ergebnis:
  mehrere Terminarten, Mitarbeiter-Startadresse statt Koordinaten,
  HERO-Verknüpfung im Buchungs-Reiter sichtbar.
- **Offen:** Startadressen der Mitarbeiter, ORS-Schlüssel fürs Routing,
  Qualifikation `montage` (sonst ist „Montage vor Ort“ dauerhaft ohne Slots).

### Migrationen
| Datei | Inhalt |
| --- | --- |
| `20260828000000_booking_m1.sql` | Grundmodell: `staff`, `working_hours`, `busy_block`, `rule_set`, `booking`, `notification`, GiST-Exclusion gegen Doppelbuchung |
| `20260924000000_booking_m2_project_travel_holidays.sql` | `booking.project_id/hero_project_id/address_source/contact_overrides`, `travel_time_cache`, `public_holiday`, `booking_*`-Einstellungen, Regelset `aufmass_vor_ort` |
| `20260924094606_booking_m3_geocode_staff_actions.sql` | `geocode_cache`, `booking.staff_token`, `booking.cancel_reason` |
| `20260924110000_booking_m4_hero_sync.sql` | Eindeutigkeit `busy_block(source, source_ref, staff_id)`, Poll-Secret, pg_cron-Job |
| `20260924115156_booking_m5_mail_cron.sql` | pg_cron für `booking-mail` (alle 5 Min.), Index auf fällige `notification`-Zeilen |
| `20260925055651_booking_m6_staff_home_address.sql` | `staff.home_base_address` — Startadresse statt Koordinatenpaar |
| `20261001070000_booking_m7_staff_links_no_skills.sql` | `staff.booking_slug` (Dauerlink pro Mitarbeiter, Teilindex unique), `rule_set.required_skills` geleert |

## Abgestimmte Produktentscheidungen
- **Ein Link = ein Projekt.** Ohne Projekt keine Buchung. Objektadresse aus HERO,
  als Rueckfall die Kundenadresse; findet sich keine, trägt der Kunde sie ein.
- **Kontaktdaten kommen aus HERO und sind editierbar.** Korrekturen landen in
  `booking.contact_overrides` und werden **nicht** nach HERO zurückgeschrieben —
  eine Terminbuchung soll keine Stammdaten überschreiben.
- **Keine Bestätigung nötig:** der Termin gilt sofort (`requires_approval=false`).
  Wir bekommen eine Mail und können daraus umbuchen oder absagen.
- **Die internen Aktionen hängen am Termin**, nicht am Konto: `booking.staff_token`
  (unique, unerratbar) in der internen Mail. Beim Umbuchen wird der Slot
  **sofort** freigegeben — andere Kunden sollen ihn sehen.
- **Sperrzeiten ergeben sich aus den Arbeitszeiten**, es gibt keine zweite Liste.
- **Feiertage** kommen pro Bundesland aus einer öffentlichen Quelle und bleiben
  danach bearbeitbar.
- **Mehrere Terminarten.** Buchbar ist eine Terminart, wenn sie `active` ist
  **und** ihre Kategorie `is_bookable` trägt. Bei genau einer geht die
  Buchungsseite direkt in den Kalender, bei mehreren lässt sie erst wählen.
  Jede Art hat eigene Dauer, Puffer, Vorlauf, Qualifikationen, HERO-Kategorie
  und optional eigenes Personal.
- **Der Mitarbeiterstandort ist eine Adresse.** Koordinaten tippt niemand ein;
  der Server geocodiert die Adresse (und nur bei Änderung).
- **Die Einladung geht von einem Mitarbeiter aus, und wer einlädt, bekommt den
  Termin.** Deshalb steckt im Link immer ein Mitarbeiter. Einladen darf jeder,
  der in HERO zugeordnet ist — ohne Zuordnung blockieren seine HERO-Termine
  nichts und unsere Termine hätten in HERO keinen Zuständigen.
- **Keine Qualifikationen.** Sie waren im Adminmenü nie pflegbar, und eine
  Terminart mit einer Qualifikation, die niemand hat, liefert dauerhaft null
  freie Zeiten (genau so war „Montage vor Ort“ unbuchbar). Die Engine kann sie
  weiterhin, bekommt aber keine mehr vorgesetzt (`required_skills` leer).

## M3 — Buchungs-API (`supabase/functions/booking-api`)
`verify_jwt=false`, Zugriff via `service_role`. Nur Slots lesen + Buchen/Stornieren, nie Config.
- `GET  ?action=context&project=<uuid>` — **alle** buchbaren Terminarten
  (`appointments`, nach Dauer sortiert), Adresse (mit Quelle), Kontakt.
- `GET  ?action=availability&project=&ruleSet=&from=&to=[&street=&zip=&city=]` —
  Slots, serverseitig gerechnet. Eine eingegebene Adresse schlägt die aus HERO.
  Eine unbekannte Terminart → **400** („Diese Terminart ist nicht buchbar“),
  unlesbare Zeitangaben ebenfalls **400** statt stillschweigend 0 Slots.
  `ruleSet` darf fehlen: dann die einzige buchbare Art, sonst `aufmass_vor_ort`
  — alte Links bleiben damit gültig.
- `POST {action:'create', project, ruleSet, slot, staffId, contact, addressOverride?, hinweis?}` —
  rechnet den Tag **neu** (dem Frontend wird nichts geglaubt), prüft den Slot,
  schreibt `booking` + `busy_block(source='booking')` + Outbox-Zeilen
  (`confirmation`, `internal_new`, ggf. `reminder`) und legt den Termin **am
  HERO-Projekt** an (`project_match_id`, Partner aus `employees.hero_partner_id`,
  Kategorie aus `rule_set.config.hero_category_id`, sonst
  `booking_hero_category_id`).
  Doppelbuchung fängt der GiST-Constraint ab → **409**. HERO-Fehler sind nicht
  fatal: der Termin steht dann bei uns, die Antwort enthält `heroError`.
- `POST {action:'cancel', cancelToken}` — Kunde storniert (`cancel_reason='customer'`).
- `POST {action:'staff-action', staffToken, mode:'cancel'|'reschedule'}` — unsere
  Aktion aus der internen Mail; gibt den Slot frei, entfernt den HERO-Termin und
  legt die passende Mail in die Outbox.

Reine DB→Engine-Abbildung liegt in `booking/inputs.ts` (unit-getestet).
Deploy braucht die Import-Map `deno.json` (`luxon` → `npm:luxon`).
`types.ts` erscheint bewusst nicht im Bundle: es wird nur mit `import type`
benutzt und fällt beim Bündeln weg.

## Einladungen (`supabase/functions/booking-invite`)
Verlangt einen Mitarbeiter-Token. Der Admin-Login kann **nicht** einladen: er
ist kein Mitarbeiter, hat keine HERO-Zuordnung und der Termin bräuchte einen
Zuständigen.

Zwei Aktionen:
- `link` — gibt die buchbaren Terminarten zurück, **jede mit fertigem Link**.
  Legt dabei bei Bedarf den Buchungsdatensatz des Mitarbeiters an, vergibt den
  Slug und setzt Mo–Fr 08–17 Uhr als Arbeitszeit. Ohne Arbeitszeiten stünde
  der Kunde sonst vor einem leeren Kalender.
- `send` — verschickt die Einladungsmail über Resend. `ruleSet` ist **Pflicht**;
  eine unbekannte oder nicht buchbare Art gibt 400.

Linkformen (`art` ist die gewählte Terminart):

| Einstieg | Link | Woher kommen Adresse und Kontakt? |
| --- | --- | --- |
| Projektübersicht | `/termin/m/<slug>?art=<art>` | Der Kunde trägt beides selbst ein |
| Projektansicht | `/termin/<projekt>?m=<slug>&art=<art>` | Aus HERO, editierbar |
| **HERO-Mailvorlage** | `/termin/m/{{Partner.last_name}}/{{ProjectMatch.display_id}}/<art>` | Aus HERO, editierbar |

### Links aus HERO-Mailvorlagen (Okt. 2026)
HERO ersetzt Platzhalter **auch innerhalb eines Links** — im Testversand
nachgewiesen. Damit lässt sich jede Vorlage einmalig mit einem Terminlink
versehen, und die App braucht es dafür danach nicht mehr.

Zwei Dinge, die den ersten Versuch scheitern ließen:

- **`{{ProjectMatch.id}}` gibt es nicht.** Platzhalter sind nur
  `{{ProjectMatch.display_id}}` und `{{ProjectMatch.name}}`. Deshalb lief die
  Projektzuordnung ins Leere. (Dieselbe Falle steckt noch in der Vorlage
  „Angebot verschicken MIT FREIGABE", die `pid={{ProjectMatch.id}}` auf
  `/hero-aktion` zeigt — in `automation_runs` steht dazu kein einziger Lauf.)
- **`display_id` ist die REINE Zahl** („1744"), unsere `project_number` heißt
  „WER-1744" und trägt oft einen Zusatz („WER-1744 Beschriftungen Büro").
- **Der Vorlagen-Editor schneidet Query-Parameter mit Platzhaltern ab.** Beim
  zweiten Testversand (`?art=…&p={{ProjectMatch.display_id}}`) kam der Klick im
  Serverlog als `action=context&staff=Layer` an — **ohne `p`**. Beim Einsetzen
  war schon zu sehen, dass die letzten beiden Klammern nicht mehr blau (also
  nicht Teil des Links) waren. Der Mitarbeiter ging durch, weil er im **Pfad**
  steht. Status 200, keine Fehlermeldung, nur eine leere Adresse — ein Link
  ohne Projekt ist eine erlaubte Form.
  Deshalb steht in der Vorlagenform jetzt **alles im Pfad**
  (`/termin/m/<nachname>/<projektnr>/<art>`, Routen in `src/App.tsx`), mit der
  Terminart als festem Segment am Ende: so endet der Link nie auf einer
  Klammer, an der ein Editor kürzen könnte. Ersetzt HERO einen Platzhalter
  trotzdem nicht, wirft die Buchungsseite das Segment weg (`echt()` in
  `BookingPage.tsx`) statt mit „Projekt nicht gefunden" abzuweisen — buchen
  bleibt möglich.
- **Der erste Test der neuen Form endete im 404 — und zwar im eigenen.** Vercel
  antwortete mit 200, und das Produktionsbundle trug die Route schon (beides
  über `http_get` aus der Datenbank geprüft, weil die Sandbox nicht nach
  draußen darf). Schuld war der Service Worker: wer die App schon besucht hat,
  bekommt die precachte `index.html` mit dem **alten** JS, und dessen Router
  kennt eine neue Route nicht. `/termin/**` steht deshalb jetzt in
  `navigateFallbackDenylist` (`vite.config.ts`) — öffentliche Links aus Mails
  holen ihr HTML immer frisch. Ein bereits installierter Service Worker
  übernimmt das erst beim nächsten Laden (`skipWaiting`).
  Die Route selbst ist zudem ein Sternchen (`/termin/m/*`): `pfadTeile()`
  erkennt die Segmente am Inhalt (Zahl bzw. „WER-1744" = Projektnummer, sonst
  Terminart), damit ein Segment zu viel oder in anderer Reihenfolge nicht
  wieder im 404 endet.
- **Der Editor kodiert Klammern in einem `href`.** In Vorlage 56239 steht
  `pid=%7B%7BProjectMatch.id%7D%7D` — so kodiert wird ein Platzhalter nie
  ersetzt. Beim Versand aus dem Projekt kam dann `…/termin/m/Layer//…` an:
  der Mitarbeiter gefüllt, die Projektnummer leer.
  Deshalb stehen die Terminlinks in den Vorlagen als **reiner Text**, ohne
  `<a href>` (genau wie der frühere Calendly-Link). Im Text wird zuverlässig
  ersetzt, und das Mailprogramm macht die URL selbst klickbar.

### Die Vorlagen in HERO (Okt. 2026, über die API angelegt)
Je Terminart eine Vorlage per Du und per Sie, Kontext `PARTNER_CUSTOMER`,
Versand **aus dem Projekt** (sonst ist `{{ProjectMatch.display_id}}` leer):

| id | Vorlage | Terminart |
| --- | --- | --- |
| 63591 / 63592 | Terminbuchung Kundentermin (PER SIE / PER DU) | `kundentermin_vor_ort` |
| 63593 / 63594 | Terminbuchung Aufmaß vor Ort (PER SIE / PER DU) | `aufmass_vor_ort` |
| 63595 / 63596 | Terminbuchung Montage vor Ort (PER SIE / PER DU) | `montage_vor_ort` |

Angelegt per `create_email_template` (GraphQL v9, `file_upload_id: 0`). Über die
API bleiben die Klammern unkodiert — nachgelesen und geprüft. **Wer eine dieser
Vorlagen im HERO-Editor speichert, sollte danach den Link kontrollieren**: der
Editor kann die URL verlinken und die Klammern dabei kodieren, dann fehlt wieder
der Projektbezug. Löschen kann die API nicht (kein `delete_email_template`) —
das geht nur im HERO-Menü.

Kommt eine neue buchbare Terminart dazu, braucht sie zwei weitere Vorlagen; die
alten Vorlagen „Termin Findung vor Ort" (37302/37303) zeigen noch auf Calendly.

`aufloeseProjekt` in `booking-api` geht deshalb von genau nach grob:
`project_number` exakt → `%-1744` → `%-1744 %` → und wenn das Projekt bei uns
gar nicht existiert, über HERO (`project_matches(relative_id:"1744")`). Der
letzte Schritt ist der **Normalfall**, nicht die Ausnahme: eine „Termin Findung
vor Ort"-Mail geht raus, bevor das Captfix-Projekt angelegt ist. Adresse,
Kundenname und Kontakt kommen dann direkt aus HERO, `booking.project_id` bleibt
null und `hero_project_id` trägt den Bezug.

Beim Mitarbeiter gibt es nur den Namen (`{{Partner.last_name}}` bzw.
`{{ProjectPartner.last_name}}`), keine ID. `aufloeseStaff` normalisiert die
Eingabe mit den Slug-Regeln (Umlaute aufgelöst, Groß-/Kleinschreibung egal) und
vergleicht zusätzlich gegen `display_name`. Ein unbekannter Name rechnet über
alle Mitarbeiter statt den Kunden auszusperren; ein **abgeschalteter**
Mitarbeiter gibt dagegen 404 — dort ist der Link wirklich ungültig.

**Die Terminart wählt der Mitarbeiter, nicht der Kunde** (Testlauf Okt. 2026:
der Kunde kann mit „Aufmaß vor Ort" vs. „Kundentermin" nichts anfangen). Der
Link entsteht deshalb erst, wenn die Art gewählt ist. Der Slug selbst ist
**dauerhaft**. Rechnen tut immer `booking-api` — dieser Dienst kann keine
Termine anlegen.

In HERO entsteht der Termin auch **ohne** Projekt: `project_match_id` ist
optional, `category_id` dagegen Pflicht (beides gegen die echte API geprüft).
Fehlt die HERO-Kategorie in den Einstellungen, meldet `heroCreateAppointment`
das im Klartext statt still zu scheitern.

Ein Link ohne `m` (alte, schon verschickte Projektlinks) funktioniert weiter
und rechnet dann wie früher über alle Mitarbeiter. Fehlt `art` oder nennt es
eine abgeschaltete Art, darf der Kunde doch wählen — besser als eine leere
Seite.

### Branding und Absender
Jede Mail (Einladung, Bestätigung, Erinnerung, Absage, Umbuchung) trägt den
**Firmennamen aus `legal_info`** — in der Fußzeile, im Anzeigenamen des
Absenders und als ORGANIZER im Kalendereintrag. „Captfix" steht nirgends, wo
der Kunde hinsieht: er kennt unsere Firma, nicht das Werkzeug dahinter, und
ein fremder Name in einer Terminmail sieht nach Spam aus. Die Absenderadresse
bleibt `notifications@captfix.app`, weil dort die bei Resend verifizierte
Domain liegt — der Anzeigename davor ist die Firma.

Die Einladungsmail nennt **keinen Mitarbeiternamen**. Vorher stand dort nur
der Nachname („Langner möchte…"), was befremdlich wirkte; es schreibt die
Firma, nicht eine Einzelperson. Nur die interne Mail an uns nennt weiterhin
den Kollegen.

## Adminmenü (`supabase/functions/booking-admin`)
Admin-Token nötig, alle Writes laufen über diese Function — direkte
Supabase-Writes gibt es im Adminbereich nicht. Geschrieben wird nur, was
ausdrücklich erlaubt ist: `ERLAUBTE_KEYS` für `app_config`,
`ERLAUBTE_RULESET_SPALTEN` für die Terminart. Sonst wäre der Admin-Token ein
Generalschlüssel für `app_config` (dort liegt auch `hero_api_key`).

Aktionen:
- `get_config` — alles, was der Reiter braucht: Einstellungen, **alle**
  Terminarten (mit Kategorie, Qualifikationen, zugeordnetem Personal,
  HERO-Kategorie), Personal (mit HERO-Partner und Arbeitszeiten),
  Kategorien, Mitarbeiter, `routingKeyVorhanden`, `heroAktiv`.
- `set_config`, `set_rule_set` (pro `key`), `set_rule_set_staff`,
  `set_category_blocks`.
- `staff_upsert` (Adresse; geocodiert **nur bei Änderung**), `geocode_staff`
  (alle nachträglich, sobald der Schlüssel da ist), `staff_delete`
  (deaktiviert statt löscht, wenn Buchungen hängen), `set_working_hours`
  (ersetzt, ergänzt nicht), `sync_staff_from_employees`.
- `list_bookings`, `mail_queue` (was in der Outbox hängt).
- Feiertage: `import_holidays` (Bundesland + Jahre), `list_holidays`,
  `add_holiday`, `set_holiday_active`, `delete_holiday`.

`routingKeyVorhanden` kommt vom Server, weil nur er es weiß: `ORS_API_KEY`
liegt in den Supabase-Secrets, nicht in `app_config` — ein Schlüssel, den der
Admin-Reiter lesen könnte, wäre kein Schlüssel mehr.

### Feiertage

Zwei kostenlose Quellen, in dieser Reihenfolge: **feiertage-api.de**, dann
**date.nager.at**. Das Lesen beider Antwortformen liegt in
`_shared/booking/holidays.ts` und ist unit-getestet — das Netzwerk lässt sich
nicht sinnvoll testen, die Formate dagegen sehr wohl.

Bearbeitbar bleiben die Einträge über zwei Regeln:
- `origin='imported'` vs. `'manual'` — ein erneuter Import lässt eigene
  Einträge (Betriebsurlaub, Brückentag) in Ruhe.
- `active=false` statt löschen — sonst legt der nächste Import den
  abgeschalteten Tag wieder an.

Ein Feiertag wird in `inputs.ts` zu einer Ausnahme je Mitarbeiter aufgefaltet;
die Engine braucht deshalb kein Feiertags-Wissen. Eine bereits eingetragene
Ausnahme gewinnt — wer an einem Feiertag ausdrücklich arbeitet, bleibt buchbar.

## Fahrzeit: Heuristik oder echtes Routing
`_shared/booking/travel.ts` hält zwei Anbieter hinter derselben Schnittstelle:
- `HaversineHeuristicProvider` — Luftlinie × Umwegfaktor / Geschwindigkeit.
  Offline, deterministisch, immer verfügbar.
- `RoutingProvider` — echte Fahrzeit über **OpenRouteService** (Matrix-Endpunkt).
  Fällt bei fehlendem Schlüssel, Zeitüberschreitung oder Fehler still auf die
  Heuristik zurück; er wirft nie, damit eine kaputte Routing-API keine leere
  Terminliste erzeugt. Zweistufig gecacht: im Speicher pro Aufruf und
  persistent in `travel_time_cache` (nach 90 Tagen neu geholt). Nur echte
  Routing-Ergebnisse werden persistiert, keine Schätzungen.

Adressen werden mit demselben Schlüssel geocodiert (ORS/Pelias, `geocode_cache`;
auch Misserfolge werden gecacht). **Der Schlüssel gehört ins Supabase-Secret
`ORS_API_KEY`, nicht in `app_config`** — `app_config` ist für Admins lesbar.

`booking_travel_max_min` ist der **Einsatzradius**: liegt die Adresse weiter weg
als X Minuten vom Standort des Mitarbeiters, wird er für diesen Termin gar nicht
angeboten. Ohne hinterlegten Standort bleibt er drin — eine fehlende Koordinate
darf nicht die ganze Terminliste leeren.

## M4 — HERO-Leserichtung (`supabase/functions/booking-hero-sync`)
HERO hat fuer uns **keine Webhooks** freigeschaltet, also pollt pg_cron alle
10 Minuten (`booking-hero-sync`, Header `x-poll-secret`; ein Admin-Token geht
auch, fuer den Knopf „Jetzt abgleichen“).

Der Lauf liest `calendar_events(start, end)` fuer die naechsten
`booking_hero_sync_days` (60) Tage und schreibt daraus
`busy_block(source='hero', source_ref=<HERO-Event-ID>)`.

- **Zuordnung:** HERO-„Partner“ → `employees.hero_partner_id` → `staff`.
  Ohne Zuordnung passiert nichts (und der Lauf sagt das auch).
- **Eigene Termine werden ausgeklammert:** was wir selbst nach HERO
  geschrieben haben (`booking.hero_event_ref`), blockiert schon als
  `source='booking'` — sonst stuende derselbe Termin doppelt im Weg.
- **Abgleich statt nur ergaenzen:** was im Fenster nicht mehr aus HERO kommt,
  wird geloescht. Sonst bliebe eine in HERO abgesagte Zeit bei uns fuer immer
  gesperrt.
- **Kategorien:** jede HERO-Kategorie bekommt automatisch eine Zeile
  `appointment_category` mit Schluessel `hero:<id>` und
  `blocks_availability = true`. Im Adminmenue laesst sich dann einzeln sagen,
  was wirklich blockiert („Büro“ ja, „Schule“ vielleicht nicht). Neue
  Kategorien blockieren erst einmal — das ist die sichere Richtung.

### Zwei Stolperfallen, die hier Zeit gekostet haben
- **`create_calendar_event` ist deprecated — und funktioniert trotzdem.**
  GraphQL blendet deprecated Felder in der Introspection standardmaessig aus;
  ohne `fields(includeDeprecated: true)` sieht es so aus, als koenne die API
  gar keine Termine anlegen. Der in der Deprecation genannte Nachfolger
  `Calendar_CreateCalendarEvent` ist in der externen API **nicht** vorhanden.
  Also weiter `create_calendar_event` benutzen.
- **HERO rechnet NICHT mit Zeitzonen** (korrigiert am 02.10.2026). Jede Zeit
  trägt „+00:00", gemeint ist aber die Uhrzeit, die in HERO auf dem Bildschirm
  steht — Ortszeit.
  Hier stand vorher das Gegenteil, mit einer Gegenprobe, die sich im Kreis
  drehte: die Automation „Weiter nach Aufmaß" schickte 09:00 Berlin als
  `07:00+00:00` (also als echte UTC-Zeit), HERO gab `07:00+00:00` zurück — und
  genau **07:00 stand auch im Kalender**, zwei Stunden zu früh. Aufgefallen ist
  es erst an einer Buchung mit echtem Gegenüber: der Kunde wählte 14:00, HERO
  trug 12:00 ein (Event 6440204).
  Folge für beide Richtungen:
  - **Schreiben:** Berliner Wanduhrzeit, beschriftet mit „+00:00" —
    `toHeroTime()` in `_shared/booking/hero.ts`. Gilt auch für
    `_shared/automations.ts` (eigene Kopie in `toBerlinIso`).
  - **Lesen:** nur die ersten 19 Zeichen zählen, gelesen als Europe/Berlin —
    `heroWallClock()`. Vorher landete ein HERO-Termin um 14:00 als Sperre um
    16:00; 14:00 blieb buchbar und wurde doppelt vergeben. Genau so passiert.
  - Tests: `_shared/booking/hero.test.ts` (inkl. Winterzeit und Umstellnacht).
- **Ein liegengebliebener Index ließ den ganzen Sync scheitern** (M8,
  02.10.2026). M1 hatte `busy_block_source_ref_uidx` auf (source, source_ref),
  M4 brauchte (source, source_ref, staff_id) und legte den neuen Index dazu —
  der alte blieb liegen. Sobald ein HERO-Termin ZWEI zugeordnete Mitarbeiter
  hatte, scheiterte der Upsert des ganzen Laufs („duplicate key value violates
  unique constraint"), es wurde **kein einziger** HERO-Block geschrieben, und
  die Buchungsseite bot längst belegte Zeiten an. Unsichtbar, weil die Function
  Fehler als HTTP 200 mit Fehlertext zurückgibt: im Edge-Log sah jeder Lauf
  erfolgreich aus. Lehre: bei dieser Function nicht den Status, sondern
  `ok`/`error` im Body prüfen.
- **Die Objektadresse hängt am `project_match`, nicht am `project`.** Wir haben
  zuerst nur `project.address` gelesen — dort steht in der Praxis die
  Kundenadresse, und genau die stand dann im Buchungskalender (WER-1760:
  Objekt „Torstraße 10", angezeigt „Otto-Hahn-Straße 3"). Reihenfolge jetzt:
  `project_match.address` → `project.address` → Adresse des Kunden.

## M5 — Mails (`supabase/functions/booking-mail`)
Die Buchung verschickt nichts, sie legt `notification`-Zeilen ab. Der Worker
arbeitet sie ab (pg_cron alle 5 Minuten, `x-poll-secret`; Admin-Token für den
Knopf „Offene Mails jetzt senden“). Grund: eine Buchung darf nicht scheitern,
weil Resend gerade zickt, und die Erinnerung muss Tage später rausgehen.

| Art | Empfänger | Inhalt |
| --- | --- | --- |
| `confirmation` | Kunde | Termin, Adresse, `.ics`-Anhang, Absage-Link |
| `internal_new` | `booking_notify_internal` | Termin + zwei Knöpfe: umbuchen / absagen; Hinweis, falls HERO nicht geklappt hat |
| `reminder` | Kunde | Erinnerung (Vorlauf aus `booking_reminder_hours`) |
| `cancellation` | Kunde | Absage — Text unterscheidet, ob der Kunde selbst abgesagt hat |
| `reschedule` | Kunde | Bitte, selbst einen neuen Termin zu wählen |

Zwei Details, die sonst peinlich werden:
- Eine **Erinnerung an einen abgesagten Termin** steht zum Buchungszeitpunkt
  schon in der Outbox. Der Worker schaut deshalb beim Versenden noch einmal auf
  den Status.
- Die **Absage benutzt dieselbe `.ics`-UID** wie die Einladung (mit
  `METHOD:CANCEL`, `SEQUENCE:1`), damit der Kalender den bestehenden Termin
  trifft statt einen zweiten anzulegen.

`.ics` und Mailtexte liegen als reine Module (`_shared/booking/ics.ts`,
`mails.ts`) mit 30 Tests daneben: das Format ist streng (Faltung auf 75
Oktette, Escaping, CRLF) und ein falscher Link in der Mail ist teurer als ein
Rechenfehler.

## M6 — Oberflächen
- **`/termin/m/:slug`** — Dauerlink eines Mitarbeiters, ohne Projektbezug.
  Dieselbe Seite; der Kunde trägt Adresse und Kontakt selbst ein, oben steht
  „mit <Name>“.
- **`/termin/:projectId`** (optional `?m=<slug>`) — öffentliche Buchungsseite, Calendly-Aufmachung.
  Gibt es mehrere Terminarten, wählt der Kunde zuerst die Art (mit Dauer), bei
  genau einer entfällt der Schritt. Links der Anlass, rechts Tag und Uhrzeit,
  dann die Bestätigung. Adresse und Kontakt aus HERO, editierbar; eine geänderte
  Adresse lässt die freien Zeiten neu rechnen. Bei 409 wird sofort neu geladen.
  Ist im ganzen geladenen Monat kein einziger Slot frei, sagt die Seite auch,
  was dann zu tun ist (andere Terminart oder einfach antworten) — sonst klickt
  sich der Kunde bei einer Terminart ohne Personal endlos durch Monate.
- **`/termin/absagen/:token`** — Absage durch den Kunden.
- **`/termin/intern/:token?mode=cancel|reschedule`** — unsere zwei Knöpfe aus
  der internen Mail. Beide Seiten fragen nach, bevor sie handeln: ein
  Mailprogramm, das Links vorab anklickt (Outlook Safe Links, Virenscanner),
  würde sonst von allein Termine absagen.
- **Adminmenue → Reiter „Termine“** — sechs Abschnitte: Terminarten (Liste
  **aller** Arten mit Dauer, Qualifikation, HERO-Kategorie, Personal; darunter
  der Editor für die gewählte), Personal mit Arbeitszeiten und
  HERO-Verknüpfung, Feiertage, Anfahrt, HERO/Mails, kommende Termine samt
  offener Mailschlange. Alle Writes über `booking-admin`, die HERO-Verknüpfung
  über `admin-manage` (`hero_list_options`, `set_employee_hero_partner`) —
  also über dasselbe Feld wie im Reiter „Mitarbeiter“, nicht über eine zweite
  Quelle. Der Reiter warnt aktiv bei zwei Dingen: eine Terminart verlangt eine
  Qualifikation, die niemand hat (→ dauerhaft null freie Zeiten), und bei
  aktiver HERO-Integration fehlt einem Mitarbeiter die HERO-Verknüpfung
  (→ seine HERO-Termine blockieren nichts, unsere Termine landen in HERO ohne
  Zuständigen).
- **Projektübersicht und Projektansicht** — je ein Knopf „Termineinladung“
  (Kalender-Uhr-Symbol). Der Dialog zeigt den Link mit Kopierknopf und
  verschickt die Mail; bei Projektbezug ist die Mailadresse aus HERO
  vorbelegt. Der Dialog baut den Link NICHT selbst zusammen — er kommt vom
  Server, sonst stände in der Mail etwas anderes als im Kalender.
- **Startseite** — schmale Leiste mit den Terminen von heute und morgen
  (auf Klick sieben Tage). Liest direkt aus Supabase (RLS `is_staff()`) und
  zeigt nichts, wenn es nichts gibt.

Alle drei öffentlichen Seiten sind lazy geladen, damit luxon und
react-day-picker nicht im Haupt-Bundle liegen.

## Was der Testlauf gefunden hat (24.09.2026)

Gefahren wurde die ganze Kette gegen die Produktionsdatenbank und das echte
HERO: Kontext laden → freie Zeiten → buchen → HERO-Termin → Mails → absagen →
HERO-Termin weg → Absagemail. Dazu die Oberflaechen mit Playwright gegen
abgefangene Antworten (`playwright.booking.config.ts`, inzwischen 14 Tests).

Drei Fehler, die nur so auffallen konnten:

1. **Es wurde gar keine Mail eingereiht.** PostgREST verlangt bei einem
   Batch-Insert in allen Zeilen dieselben Schluessel; die Erinnerungszeile
   hatte `send_after` zusaetzlich. Der Insert scheiterte komplett — und weil
   sein Ergebnis nicht geprueft wurde, still. Jetzt steht `send_after`
   ueberall, und ein Fehler wird geloggt und in der Antwort gemeldet
   (`mailQueued`).
2. **Der HERO-Termin blieb beim Absagen stehen.** `delete_calendar_event` gibt
   ein CalendarEvent zurueck und braucht deshalb eine Feldauswahl
   (`{ id deleted }`). Ohne sie lehnt GraphQL die Mutation ab. Auch das war
   "best effort" und damit unsichtbar. Jetzt korrigiert; das Ergebnis geht als
   `heroRemoved` mit zurueck, und die interne Seite warnt, wenn der Termin in
   HERO stehen blieb.
3. **Der Kunde haette eine englische Systemmeldung gesehen.** Bei einer Antwort
   ausserhalb von 2xx setzt `supabase.functions.invoke` `data` auf null und legt
   die Antwort unter `error.context` ab. Statt "Dieser Termin wurde gerade
   vergeben." stand dort "Edge Function returned a non-2xx status code".

Dazu eine Luecke in der Einrichtung: die Terminart verlangt die Qualifikation
`aufmass`, das neu angelegte Personal hatte keine — also null freie Zeiten,
ohne Hinweis warum. Qualifikationen sind jetzt im Reiter editierbar, und wenn
niemand die noetige hat, steht dort eine Warnung.

Unschoen, aber absichtlich so gelassen: eine Zeit, die als `from`/`to` unlesbar
ist, gab frueher eine leere Slotliste zurueck (sah aus wie "nichts frei"). Das
gibt jetzt einen 400 mit Klartext.

## Was der Plausibilitätscheck im Adminmenü gefunden hat (25.09.2026)

Drei Dinge, die im Betrieb aufgefallen wären — alle mit derselben Ursache: die
Buchung war auf **genau eine** Terminart gebaut.

1. **Zwei von drei Terminarten waren unerreichbar.** M1 legt
   `aufmass_vor_ort`, `kundentermin_vor_ort` und `montage_vor_ort` an, alle
   aktiv und buchbar. `booking-api` hatte die Kennung aber fest verdrahtet —
   die anderen beiden waren also weder im Adminmenü noch auf der Buchungsseite
   zu sehen und über den Link nicht buchbar. Behoben: `context` liefert alle
   buchbaren Arten, `availability`/`create` rechnen mit der übergebenen.
   Gegengeprüft gegen Produktion (`WER-1744`): `context` → 3 Arten;
   `availability` → `aufmass_vor_ort` 276 Slots (Raster 15 Min.),
   `kundentermin_vor_ort` 154 (Raster 30 Min.), `montage_vor_ort` **0**
   (verlangt `montage`, das hat niemand), unbekannte Art → 400.
2. **„Breite“ und „Länge“ beim Mitarbeiter.** Zwei Zahlenfelder, die niemand
   von Hand einträgt und die falsch getippt stillschweigend einen falschen
   Einsatzradius ergeben. Ersetzt durch **eine Startadresse**
   (`staff.home_base_address`); der Server geocodiert sie, und nur bei
   Änderung. `geocode_staff` holt das für alle nach, sobald der
   Routing-Schlüssel hinterlegt ist.
3. **HERO-Verknüpfung war im Buchungskontext unsichtbar.** Das Feld
   (`employees.hero_partner_id`) gab es schon im Reiter „Mitarbeiter“, aber
   ohne die Verknüpfung blockieren HERO-Termine keine Slots und unsere Termine
   landen in HERO ohne Zuständigen. Deshalb steht dieselbe Auswahl jetzt auch
   am Mitarbeiter im Buchungs-Reiter — gleiche Function, gleiches Feld, plus
   Warnung, wenn sie bei aktiver Integration fehlt.

Dazu zwei Kleinigkeiten:
- Eine Terminart, für die niemand qualifiziert ist, liefert korrekt null
  Slots — der Kunde hätte sich aber durch Monate geklickt. Die Buchungsseite
  sagt jetzt, was zu tun ist, wenn im geladenen Monat gar nichts frei ist.
- `enqueueHeroUpload` kannte `lager_label_pdf` in seinem Typ nicht, obwohl
  `LabelPrint.tsx` genau das einreiht (zur Laufzeit harmlos, aber der Typ log).
  Ergänzt; damit bleiben in `tsc -p tsconfig.app.json` 5 alte, unverwandte
  Fehler.

## Bewusste Abweichungen vom Spec-Entwurf (§8/§14, gegen Repo geprüft)
- **Einzelmandant:** kein `org_id`. Die App ist single-tenant; Struktur bleibt additiv erweiterbar.
- **`staff` verweist auf `employees`** (`employee_id`, nullable) statt Identitäten zu duplizieren.
  `employees` ist minimal (`id, name`); Buchungs-spezifische Felder liegen in `staff`.
- **Geo als `lat/lng` (double precision)** statt `geography(point)` — kein PostGIS-Zwang; die
  v1-Fahrzeit ist eine Luftlinien-Heuristik.
- **RLS:** Vollzugriff nur für authentifizierte Mitarbeiter via `is_staff()`; kein anon-Zugriff.
  Öffentliche Buchung läuft (wie alle Betriebsdaten hier) über Edge Functions mit `service_role`.
- **Mail = Resend** (vorhanden, `send-notification`) — wird in M5 als Outbox-Sender genutzt.
- **Hero:** entgegen erster Annahme **existiert das Termin-Schreiben bereits** —
  `supabase/functions/_shared/automations.ts` (`create_calendar_event`, Automation
  `hero_create_calendar_event`), und `admin-manage` **liest** `calendar_events`/`calendar_event_categories`.
  → M6 = wiederverwenden, nicht neu bauen.
- **Google Calendar:** im Repo (noch) nicht vorhanden → M4 ist Neubau (OAuth-Credentials nötig).

## Engine (M2)
Reine Funktion, keine DB/Seiteneffekte, damit voll testbar:
`supabase/functions/_shared/booking/engine.ts` → `computeSlots(input): Promise<Slot[]>`.
Zeitlogik mit **luxon**, lokal in `Europe/Berlin`, Vergleich in UTC (DST-sicher).

Berücksichtigt: Arbeitszeiten ∩ Zeitraum, Ausnahmen (Urlaub/Zusatz), Raster, Dauer,
Puffer vor/nach, Belegung (`busy_block`), Fahrzeit-Puffer (prev/next Termin),
Mindest-Vorlaufzeit, Buchungsfenster, Tageslimits, Qualifikation, Zuweisung
(`fixed`/`round_robin`/`by_skill`/`collective`), Notfall-Reserve.

## Nächste Schritte
1. Der Buchungslink ist noch nicht aus der Projektansicht kopierbar; die
   Projekt-ID muss von Hand in die URL. Nächster sinnvoller Schritt, sobald
   die Buchung im Alltag benutzt wird.
2. Zwei Leute, die **denselben** Termin gleichzeitig ändern, bleiben
   last-write-wins (wie beim Standort-Sync). Der GiST-Constraint verhindert
   dabei nur die Doppelbuchung, nicht die zweite Absage.

### Nachgewiesen gegen Produktion (01.10.2026)

| Aufruf | Ergebnis |
| --- | --- |
| `context&staff=langner` | Projekt null, Mitarbeiter „Langner", 3 Terminarten |
| `context&project=…&staff=langner` | Projekt WER-1744 **und** Langner |
| `context&project=…` (ohne `m`) | wie früher, Mitarbeiter null |
| `context&staff=gibtesnicht` | 404 „Dieser Einladungslink gilt nicht mehr" |
| `context` ohne beides | 400 |
| `availability&staff=langner` | 141 Slots, **nur** Langner zugeordnet |
| `availability&staff=layer` | 155 Slots, **nur** Layer zugeordnet |
| `availability` Montage | 12 Slots (vorher 0 — Qualifikation war der Grund) |
| `booking-invite` ohne Token | 401 |

### Nachgewiesen gegen Produktion (05.10.2026, nach den Zeit-/Adressfixes)

| Prüfung | Ergebnis |
| --- | --- |
| `context&p=1916&staff=Langner` | Adresse **Lange Straße 42** (Objektadresse, `source: project`, geocodiert) – vorher kam die Kundenadresse |
| echte Buchung 6 Min nach dem Deploy | HERO-Event 6450972 steht **06.10. 13:30–15:00** (gebucht 13:30, kein Zwei-Stunden-Versatz), Beschreibung mit Objektadresse |
| `context&p=99999&staff=Langner` | 200 mit `projectMissing: true` statt 404 |
| `booking-hero-sync` nach M8 | `{ok:true, events:13, blocks:9, removed:1}`; HERO-Termin 14:00 sperrt jetzt 14:00 |
| Deploy-Stand | `booking-api` v9, `booking-hero-sync` v3, `booking-invite` v4, `run-automations` v21, `send-notification` v21 – jeweils byte-genau gegen das Repo geprüft |

Offen beim Deploy: `submit-vehicle-request` und `hero-dropbox-poll` tragen noch
die alte `automations.ts`. Praktisch betroffen ist nur die Automation
„Fahrzeug Weiterbearbeiten" (Trigger `vehicle_inquiry_submitted`, legt ihren
Termin zwei Stunden zu früh an); an den Triggern von `hero-dropbox-poll`
(`hero_customer_created`, `hero_project_created`) hängt keine
Kalender-Automation. Ein `supabase functions deploy submit-vehicle-request`
erledigt den Rest.

### Was der Betrieb noch beisteuern muss
- OpenRouteService-Schlüssel als Supabase-Secret `ORS_API_KEY`, danach
  `booking_travel_mode` auf `routing` stellen.
- **Startadresse je Mitarbeiter** im Reiter „Termine“ eintragen — ohne sie
  greift der Einsatzradius nicht. Koordinaten rechnet der Server daraus;
  `geocode_staff` holt sie für alle nach. Angelegt sind die beiden Mitarbeiter
  mit HERO-Partner-ID bereits, mit Arbeitszeiten Mo–Fr 08–17 Uhr als Startwert.
- Feiertage einmal importieren (`booking-admin`, Bundesland `BW`).
- Entscheiden, was mit **„Montage vor Ort“** passiert: entweder jemandem die
  Qualifikation `montage` geben oder die Terminart abschalten. Aktiv und ohne
  Personal heißt: der Kunde sieht sie und findet nie einen Termin.

### Tests
```
npm run test:unit      # Vitest: Engine, Fahrzeit, Feiertage, .ics, Mailtexte
npm run build && npx playwright test -c playwright.booking.config.ts
                       # Oberflaechen gegen abgefangene API-Antworten,
                       # ohne Zugangsdaten und ohne echte Buchungen
```
In Umgebungen mit vorinstalliertem Chromium: `PW_CHROMIUM=/pfad/zu/chromium`
davorsetzen, dann wird kein zweiter Browser geladen.
