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

## Abschluss: der Anon-Key ist zu (28.07.2026)

**Mitarbeiter-Migration ohne Passwortwechsel.** Die fünf Auth-Konten wurden mit
den **bestehenden bcrypt-Hashes** aus `employees.password_hash` angelegt —
Supabase Auth speichert Passwörter im selben Format. Niemand musste sein
Passwort ändern, niemand bekam ein neues. Vorher an einem Wegwerf-Konto
geprüft, dass ein `$2b$10$`-Hash so akzeptiert wird.

Wer keine echte E-Mail hinterlegt hat, bekommt eine technische
(`employee-<id>@captfix.invalid`) — sie wird nie angezeigt und nie eingegeben.
Langner und Layer nutzen ihre echten Adressen (die auch für
Benachrichtigungen dienen).

**Zwei Sicherheitsnetze**, damit sich niemand aussperren kann:

1. `employee-auth/login` prüft bei fehlgeschlagener Anmeldung gegen den alten
   bcrypt-Hash und repariert das Auth-Konto still, falls der übernommene Hash
   wider Erwarten nicht greift.
2. `validate-employee` (der alte Weg) bleibt funktionsfähig. Die App ist eine
   PWA — ein Browser kann noch eine gecachte Version ausliefern, die
   `employee-auth` nicht kennt. Zwei verschiedene Passwörter entstehen dabei
   nicht: `employee-auth` schreibt jede Passwortänderung auch als bcrypt-Hash
   nach `employees` zurück.

Zusätzlich meldet die App jetzt ab, wenn eine Mitarbeiter- oder Kundensitzung
ohne Supabase-Session dasteht (statt eine leere Ansicht zu zeigen).

**Entfernt:** 41 `anon`-Policies auf den Betriebsdaten und alle
anon-Storage-Policies.

**Bewusst offen geblieben:**

- `vehicle_field_config` (nur SELECT) — das öffentliche Formular
  `/fahrzeug-anfrage` braucht die Feldliste vor jeder Anmeldung. Inhalt sind
  Feldnamen und Reihenfolge.
- `employees_public` — View mit Definer-Rechten (Namen ohne Hashes) für die
  Mitarbeiterliste im Anmeldebildschirm.
- `mister_x_players` — eigenständiges Spiel-Feature.

### Gemessen nach dem Schließen

| Rolle | Projekte | Kunden | Freigaben | Fahrzeugbilder |
|---|---|---|---|---|
| `anon` (Key aus dem JS-Bundle) | **0** | **0** | **0** | **0** |
| Mitarbeiter (Layer) | 45 | 10 | 39 | 45 |
| Kunde (Peter) | 1 | 1 (er selbst) | 0 | 4 |

`anon` INSERT auf `projects` → `new row violates row-level security policy`.
`anon` DELETE auf `location_approvals` → 0 Zeilen.
Anmeldebildschirm (`employees_public`) → 5 Einträge, Fahrzeugformular
(`vehicle_field_config`) → 7 Felder: beide unverändert erreichbar.

### Der alte Gastmodus

Kein Codepfad legt noch eine `"guest:"`-Sitzung an — Gastlinks laufen über
`ensure-customer-assignment` und werden zu echten Kunden mit Session. Ein
Besucher mit einer alten, noch gespeicherten Gastsitzung wird jetzt zur
Anmeldung geschickt; ein erneuter Klick auf seinen Projektlink stellt ihn
normal wieder her.
