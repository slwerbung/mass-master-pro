

## Plan: Neues Zugangsmodell ohne E-Mail/Passwort

### Übersicht

Das aktuelle E-Mail-basierte Auth-System wird komplett ersetzt durch drei Rollen:

1. **Admin** -- Zugang mit festem Passwort, verwaltet alles
2. **Mitarbeiter** -- Zugang nur mit Name (kein Passwort), erstellt/bearbeitet Projekte
3. **Kunden** -- Werden Projekten zugewiesen, Zugang nur mit Name, können zugewiesene Standort-Felder bearbeiten

### Datenbank-Änderungen

Neue Tabellen (ersetzen Supabase Auth):

```text
employees (id, name, created_at)
  -- Mitarbeiter, vom Admin angelegt

customers (id, name, created_at)
  -- Kunden, vom Admin angelegt

customer_project_assignments (id, customer_id, project_id, created_at)
  -- Welcher Kunde welches Projekt sehen/bearbeiten darf

customer_location_permissions (id, assignment_id, location_id, can_edit_guest_info)
  -- Was der Kunde an welchem Standort bearbeiten darf
```

Bestehende Tabellen-Änderungen:
- `projects`: Spalte `user_id` wird zu `employee_id` (Referenz auf `employees`)
- RLS wird deaktiviert, da kein Supabase Auth mehr verwendet wird -- stattdessen Zugriffskontrolle über Edge Functions

### Auth-Konzept

Da keine Passwörter für Mitarbeiter/Kunden nötig sind, wird Supabase Auth nicht mehr verwendet. Stattdessen:

- **Session via localStorage**: Rolle + ID + Name werden im Browser gespeichert
- **Admin**: Gibt auf der Startseite das feste Admin-Passwort ein (gespeichert als Secret `ADMIN_PASSWORD`)
- **Mitarbeiter**: Wählt seinen Namen aus einer Liste oder gibt ihn ein
- **Kunden**: Gibt seinen Namen ein, sieht nur zugewiesene Projekte

Edge Functions validieren Zugriffe serverseitig (Admin-Passwort-Check, Mitarbeiter-Existenz, Kunden-Zuweisungen).

### Neue Seiten

| Route | Beschreibung |
|---|---|
| `/` | Login-Seite: Drei Buttons (Admin / Mitarbeiter / Kunde) |
| `/admin` | Admin-Dashboard: Mitarbeiter verwalten, Kunden verwalten, Projekte-Übersicht, Kunden-Projekt-Zuweisungen |
| `/projects` | Mitarbeiter-Projektliste (wie bisher) |
| `/customer` | Kunden-Ansicht: zugewiesene Projekte |

### Sicherheitsansatz

- Admin-Passwort wird als Secret gespeichert und nur serverseitig geprüft (Edge Function `validate-admin`)
- Mitarbeiter/Kunden-Identifikation erfolgt über Namen -- bewusst ohne Passwort wie gewünscht
- Edge Functions für sensible Operationen (Admin-Aktionen, Datenzugriff)
- RLS wird durch service_role-Key in Edge Functions ersetzt

### Umsetzungsschritte

1. **Secret `ADMIN_PASSWORD` anfordern** vom Benutzer
2. **Migration**: Neue Tabellen erstellen, `projects.user_id` zu `employee_id` ändern
3. **Edge Functions**: `validate-admin`, `admin-manage` (CRUD für Mitarbeiter/Kunden/Zuweisungen)
4. **Startseite** (`/`): Rollen-Auswahl (Admin/Mitarbeiter/Kunde) mit jeweiligem Login
5. **Admin-Dashboard** (`/admin`): Mitarbeiter-/Kundenverwaltung, Projekt-Zuweisungen
6. **Bestehende Seiten anpassen**: AuthGuard durch RoleGuard ersetzen, Supabase Auth entfernen
7. **Kunden-Bereich**: Zugewiesene Projekte anzeigen, erlaubte Felder bearbeitbar

### Betroffene Dateien

- `src/App.tsx` -- Routing komplett umbauen, AuthGuard durch RoleGuard ersetzen
- `src/pages/Auth.tsx` -- Wird zur neuen Login-Seite mit Rollenauswahl
- `src/pages/Projects.tsx` -- Logout-Button anpassen, Auth-Logik entfernen
- `src/pages/Admin.tsx` -- NEU
- `src/pages/CustomerView.tsx` -- NEU (ersetzt GuestProject)
- `src/pages/GuestAccess.tsx` -- Wird zu Kunden-Login
- Alle Edge Functions -- Anpassung der Validierung

