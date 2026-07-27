# Phase 1 — Supabase Auth für Mitarbeiter

**Stand:** 27.07.2026. Alles unten ist auf der Produktions-Instanz angewandt
und geprüft, nicht geplant.

## Leitsatz

Der Login sieht für den Mitarbeiter **exakt so aus wie vorher**: Name aus der
Liste wählen, Passwort eingeben, fertig. Die E-Mail-Adresse, die Supabase Auth
technisch braucht, wird nur einmal vom Admin hinterlegt und danach
serverseitig aufgelöst — sie wird beim Anmelden nie eingegeben und nirgends
abgefragt.

## Was dazugekommen ist

| Baustein | Zweck |
|---|---|
| `public.profiles` | Verbindet `auth.users` mit `employees` (`employee_id`). Der `employees`-Datensatz und alle Fremdschlüssel darauf bleiben unangetastet. |
| `public.is_staff()` / `public.current_role()` | `security definer`-Helfer für Policies. |
| Edge Function `employee-auth` | `login` (öffentlich), `create_login`, `update_login`, `status` (Admin-Token). |
| `employees.email` | Spalte nachgezogen — der Code hat sie an vier Stellen benutzt, sie existierte nie (siehe unten). |
| Policies „Mitarbeiter Vollzugriff" | 20 Betriebsdaten-Tabellen, `for all to authenticated using (is_staff())`. |
| Storage-Policies für `authenticated` | UPDATE + DELETE auf `project-files` (SELECT/INSERT gab es schon). |

## Ablauf beim Anmelden

1. Mitarbeiter wählt seinen Namen → `validate-employee` sagt „Passwort nötig".
2. Passwort eingeben → **zuerst** `employee-auth`/`login`.
   - Konto vorhanden und Passwort richtig → echte Supabase-Session
     (`supabase.auth.setSession`) **plus** das bisherige HMAC-Token, das alle
     Edge Functions weiterhin erwarten.
   - Kein Konto (`noAuthAccount`) → alter bcrypt-Weg über `validate-employee`.
3. Beim Abmelden wird über `clearSession()` auch die Supabase-Session beendet.

Damit ein Konto nicht zwei gültige Passwörter hat, verweigert
`validate-employee` den bcrypt-Weg, sobald für den Mitarbeiter ein Profil
existiert.

## Konto anlegen (Admin → Mitarbeiter)

E-Mail hinterlegen und ein Passwort mit mindestens 8 Zeichen setzen — daraus
entsteht automatisch der sichere Login. Der Mitarbeiter bekommt dann das Badge
„Sicherer Login". Ohne E-Mail bleibt alles beim alten Passwort-Login, beide
Varianten laufen parallel.

## Geprüft (Produktion, mit Testkonto, danach entfernt)

- richtiges Passwort → `valid:true`, HMAC-Token **und** Supabase-JWT
- falsches Passwort → 401
- `validate-employee` liefert für migrierte Mitarbeiter `useAuthAccount:true`
- als `authenticated` mit Profil: 45 Projekte, 91 Standorte sichtbar,
  INSERT/UPDATE/DELETE auf `projects` erfolgreich
- als `authenticated` **ohne** Profil: `is_staff() = false`, 0 Zeilen sichtbar
- danach: 0 `auth.users`, 0 `profiles`, 5 `employees` — keine Reste

## Warum die anon-Policies noch stehen

Kunden- und Gastansichten laufen weiterhin über den Anon-Key. Solange die nicht
umgestellt sind (Phase 2), wäre ihr Entfernen ein Ausfall. Die neuen
`authenticated`-Policies sind deshalb rein additiv.

## Nebenbefund, hiermit erledigt

`employees.email` gab es nicht, obwohl `create_employee`, `set_employee_email`,
`list_employees` und `send-notification` damit arbeiten. Die Einstellung
„Benachrichtigung an zugeordneten Mitarbeiter" war dadurch wirkungslos. Die
Spalte ist jetzt vorhanden; `employee-auth` hält sie mit der Adresse des
Auth-Kontos synchron.
