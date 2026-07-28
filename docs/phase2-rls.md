# Phase 2 — Zugriff auf die Datenbank eingrenzen

**Stand:** 28.07.2026. Alles unten ist auf der Produktions-Instanz angewandt
und geprüft.

## Ausgangslage

Die Kundenansicht sprach die Datenbank an ~50 Stellen direkt mit dem Anon-Key
an — dem Schlüssel, der im JS-Bundle jedes Besuchers steht. Wer ihn nimmt,
umgeht das Token-System vollständig und redet direkt mit PostgREST.

## Der Ansatz

Derselbe wie bei den Mitarbeitern: **Identität statt Umbau.** Der Kunde meldet
sich unverändert nur mit seinem Namen an (bzw. öffnet seinen Projektlink),
bekommt dabei aber zusätzlich eine echte Supabase-Session. Damit greifen
Policies, die ihn auf die ihm zugewiesenen Projekte begrenzen.

Kein einziger der ~50 Aufrufe in `CustomerView.tsx` musste umgeschrieben
werden — was ein Kunde sehen darf, entscheidet ab jetzt die Datenbank.

Das Auth-Konto dahinter nutzt eine technische Adresse
(`customer-<id>@captfix.invalid`), die nie angezeigt, nie eingegeben und nie
verschickt wird. Ihr Passwort wird bei jeder Anmeldung durch einen neuen
Zufallswert ersetzt — es ist kein Zugangsdatum, das jemand wiederverwenden
könnte.

## Was umgesetzt ist

| Baustein | Wirkung |
|---|---|
| `profiles.customer_id` + Rolle `kunde` | verbindet Auth-Konto und Kundenstamm |
| `current_customer_id()`, `has_customer_project()`, `has_customer_location()` | `security definer`-Helfer für die Policies |
| ~30 Policies „Kunde …" | Lesen nur auf eigene Projekte; Schreiben nur dort, wo der Kunde es fachlich darf (Freigaben, Korrespondenz, eigene Uploads, Fahrzeugdaten) |
| `validate-customer`, `ensure-customer-assignment` | stellen die Session aus |
| `applySupabaseSession()` | übernimmt sie im Browser (Login, /kunde, Gastlink, Direktlink) |
| `run-automations` | verlangt jetzt ein Admin-/Mitarbeiter-Token |
| `project_layouts`, `vehicle_design_briefings` | Anon-Zugriff entfernt (werden nur von Edge Functions geschrieben) |

## Zwei Korrekturen an bestehenden Policies

1. **`is_staff()` war zu weit.** Die Funktion galt für *jedes* aktive Profil.
   Mit Kundenprofilen in derselben Tabelle hätte das jedem Kunden
   Mitarbeiter-Vollzugriff gegeben. Jetzt auf `admin`/`mitarbeiter` begrenzt.
2. **`location_feedback` und `location_approvals` hatten je eine
   `{authenticated} ALL`-Policy** aus früheren Zeiten. Gemessen: ein Testkunde
   sah damit 6 fremde Feedback-Einträge, obwohl sein Projekt keinen einzigen
   Standort hat. Beide ersetzt durch den normalen Mitarbeiter-Zugriff.

## Geprüft (Produktion, Testkonten danach entfernt)

Angemeldeter Kunde („Peter", 1 zugewiesenes Projekt):

| | sichtbar | gesamt |
|---|---|---|
| Projekte | 1 | 45 |
| Kunden | 1 (nur er selbst) | 12 |
| Standorte | 0 (sein Projekt ist ein Fahrzeugprojekt) | 91 |
| Korrespondenz | 0 | 6 |
| Freigaben | 0 | 39 |
| Fahrzeugbilder | 4 (seine) | — |

`is_staff()` für ihn: **false**. Mitarbeiter sehen unverändert alles
(45 Projekte, 6 Korrespondenz, 39 Freigaben). Ein angemeldeter Fremder ohne
Profil sieht nichts.

`run-automations`: ohne Token 401, mit Mitarbeiter-Token `{"ok":true,"ran":0}`.

## Warum die anon-Policies noch stehen

Sie zu entfernen ist der letzte Schritt und braucht zwei Voraussetzungen:

1. **Alle Mitarbeiter brauchen einen Login** (Admin → Mitarbeiter → E-Mail +
   Passwort). Wer noch keinen hat, arbeitet weiter über den Anon-Key — für den
   wäre die App sonst schlagartig leer.
2. **Der „eingeschränkte Gastmodus"** (alter `guest_token` ohne Namen) liest
   Fahrzeugdaten noch direkt. Gastlinks mit Namenseingabe sind davon nicht
   betroffen: sie werden über `ensure-customer-assignment` zu echten Kunden
   und bekommen eine Session. Der Restfall muss noch über `guest-data` laufen.

Bis dahin sind die neuen Policies rein additiv — sie schränken niemanden ein,
der heute funktioniert.
