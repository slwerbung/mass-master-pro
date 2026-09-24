# Terminbuchungs-Engine — Umsetzungsstand

Umsetzung der Spec (`terminbuchungSPEC.md`) in Meilensteinen. Dieses Dokument
hält Stand + bewusste Abweichungen fest.

## Stand (24.09.2026)
- **M1 — Datenmodell & Seeds:** ✅ angewandt (`20260828000000_booking_m1.sql`).
- **M2 — Engine:** ✅ reine `computeSlots` + `TravelTimeProvider` + Unit-Tests.
- **M3 — Buchungs-API:** ✅ `booking-api` **deployt** (v2, byte-genau gegen das Repo
  verifiziert). Projektbezogen, Adresse und Kontakt aus HERO.
- **Feiertage + Admin-Aktionen:** ✅ `booking-admin` **deployt** (v2).
- **Echtes Routing:** ✅ im Code (OpenRouteService). Wartet nur noch auf den
  Schlüssel im Supabase-Secret `ORS_API_KEY` und `booking_travel_mode=routing`.
- **Offen:** HERO-Leserichtung (`calendar_events` → `busy_block`), Mail-Outbox-Worker,
  öffentliche Buchungsseite `/termin/:projectId`, Admin-Reiter „Termine“,
  Einstieg auf der Startseite.

### Migrationen
| Datei | Inhalt |
| --- | --- |
| `20260828000000_booking_m1.sql` | Grundmodell: `staff`, `working_hours`, `busy_block`, `rule_set`, `booking`, `notification`, GiST-Exclusion gegen Doppelbuchung |
| `20260924000000_booking_m2_project_travel_holidays.sql` | `booking.project_id/hero_project_id/address_source/contact_overrides`, `travel_time_cache`, `public_holiday`, `booking_*`-Einstellungen, Regelset `aufmass_vor_ort` |
| `20260924094606_booking_m3_geocode_staff_actions.sql` | `geocode_cache`, `booking.staff_token`, `booking.cancel_reason` |

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

## M3 — Buchungs-API (`supabase/functions/booking-api`)
`verify_jwt=false`, Zugriff via `service_role`. Nur Slots lesen + Buchen/Stornieren, nie Config.
- `GET  ?action=context&project=<uuid>` — Terminart, Adresse (mit Quelle), Kontakt.
- `GET  ?action=availability&project=&from=&to=[&street=&zip=&city=]` — Slots,
  serverseitig gerechnet. Eine eingegebene Adresse schlägt die aus HERO.
- `POST {action:'create', project, slot, staffId, contact, addressOverride?, hinweis?}` —
  rechnet den Tag **neu** (dem Frontend wird nichts geglaubt), prüft den Slot,
  schreibt `booking` + `busy_block(source='booking')` + Outbox-Zeilen
  (`confirmation`, `internal_new`, ggf. `reminder`) und legt den Termin **am
  HERO-Projekt** an (`project_match_id`, Partner aus `employees.hero_partner_id`).
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

## Feiertage (`supabase/functions/booking-admin`)
Admin-Token nötig. Aktionen: `import_holidays` (Bundesland + Jahre),
`list_holidays`, `add_holiday`, `set_holiday_active`, `delete_holiday`.

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
1. HERO-Leserichtung: `calendar_events` pollen → `busy_block(source='hero')`,
   damit bestehende Termine Slots blockieren.
2. Outbox-Worker: `notification` abarbeiten via Resend — Kundenbestätigung mit
   `.ics`, interne Mail mit Umbuchen-/Absagen-Link, Erinnerung.
3. Öffentliche Buchungsseite `/termin/:projectId` (Calendly-Aufmachung).
4. Admin-Reiter „Termine“ + Einstieg auf der Startseite.

### Was der Betrieb noch beisteuern muss
- OpenRouteService-Schlüssel als Supabase-Secret `ORS_API_KEY`, danach
  `booking_travel_mode` auf `routing` stellen.
- Mitarbeiter in `staff` anlegen (mit `employee_id` und Standort-Koordinaten)
  und Arbeitszeiten eintragen — ohne die gibt es keine Slots.
- Feiertage einmal importieren (`booking-admin`, Bundesland `BW`).

### Tests
```
npm run test:unit      # Vitest, nur die Unit-Tests (getrennt von Playwright-e2e)
```
