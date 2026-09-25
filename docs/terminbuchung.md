# Terminbuchungs-Engine — Umsetzungsstand

Umsetzung der Spec (`terminbuchungSPEC.md`) in Meilensteinen. Dieses Dokument
hält Stand + bewusste Abweichungen fest.

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
- **HERO liefert echte UTC-Zeiten** (`2026-09-24T07:00:00+00:00`), auch wenn
  das Format wie eine naive Zeit aussieht. Gegenprobe: die Automation
  „Weiter nach Aufmaß“ legt ihren Termin um 09:00 Berlin an, HERO gibt ihn
  als `07:00+00:00` zurueck. Der Offset gilt also wortwoertlich.

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
- **`/termin/:projectId`** — öffentliche Buchungsseite, Calendly-Aufmachung.
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
