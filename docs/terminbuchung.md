# Terminbuchungs-Engine — Umsetzungsstand

Umsetzung der Spec (`terminbuchungSPEC.md`) in Meilensteinen. Dieses Dokument
hält Stand + bewusste Abweichungen fest.

## Stand
- **M1 — Datenmodell & Seeds:** ✅ als Migration `supabase/migrations/20260828000000_booking_m1.sql`.
  **Noch NICHT auf Produktion angewandt** (auf Wunsch nur als Datei abgelegt).
- **M2 — Engine:** ✅ reine `computeSlots` + `TravelTimeProvider` (Heuristik-Default) + Unit-Tests.
- **M3 — Buchungs-API:** ✅ Edge Function `booking-api` (Code/Branch, **noch NICHT deployt**,
  läuft erst nach M1-Anwendung). Ohne externe Spiegelung (kommt M4/M6).
- M4–M8: offen.

## M3 — Buchungs-API (`supabase/functions/booking-api`)
`verify_jwt=false`, Zugriff via `service_role`. Nur Slots lesen + Buchen/Stornieren, nie Config.
- `GET  ?action=rule-sets` — buchbare Terminarten (Kategorie `is_bookable`).
- `GET  ?action=availability&ruleSet=&from=&to=&lat=&lng=` — Slots (Engine, serverseitig).
- `POST {action:'create', ruleSet, slot, staffId, customer, address, answers}` —
  rechnet den Tag NEU, prüft Slot, fügt `booking` ein. Doppelbuchung fängt der
  GiST-Exclusion-Constraint ab → **409**. Schreibt `busy_block(source='booking')`
  und Outbox-`notification`-Zeilen (Bestätigung, intern, Erinnerungen). `requires_approval`
  ⇒ Status `pending`.
- `POST {action:'cancel', cancelToken}` — storniert, entfernt busy_block, legt Storno-Notification an.

Reine DB→Engine-Abbildung liegt in `booking/inputs.ts` (unit-getestet).
Deploy braucht die Import-Map `deno.json` (`luxon` → `npm:luxon`).

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

### Tests
```
npm run test:unit      # Vitest, nur die Unit-Tests (getrennt von Playwright-e2e)
```

## Nächster Schritt (M4)
Google Calendar zweiseitig: Lesen (→ `busy_block`), Schreiben bei Buchung,
Webhook-Sync. Braucht Google-Cloud-OAuth-Credentials (offener Punkt §14).
Danach M5 (Outbox-Worker + .ics-Mails via Resend) und M6 (Hero anbinden —
`create_calendar_event` schreiben, `calendar_events` lesen; beide im Repo vorhanden).
