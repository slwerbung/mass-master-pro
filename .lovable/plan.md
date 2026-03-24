

## Plan: Individuelles Mitarbeiter-Passwortmodell und Projekttrennung

### Zusammenfassung

Das Projekt verwendet aktuell ein **globales Mitarbeiter-Passwort** (über `app_config`). Dieses wird ersetzt durch **individuelle Passwörter pro Mitarbeiter** (über `employees.password_hash`). Zusätzlich wird die Admin-Passwort-Verwaltung in die Einstellungen verschoben und Projekte werden pro Mitarbeiter abgesichert.

---

### 1. Backend: `validate-employee` Edge Function

- Globale Passwort-Prüfung gegen `app_config` komplett entfernen
- Stattdessen `employees.password_hash` des ausgewählten Mitarbeiters lesen
- Wenn `password_hash` null/leer: Login ohne Passwort (kein Passwort gesetzt)
- Wenn `password_hash` vorhanden: Passwort mit bcrypt vergleichen
- Kein Fallback auf `employee_password` / `employee_password_hash` aus `app_config`

### 2. Backend: `admin-manage` Edge Function

Neue Actions hinzufügen:

- **`set_employee_password`**: Bekommt `employeeId` + `password`, hasht mit bcrypt, speichert in `employees.password_hash`
- **`delete_employee_password`**: Setzt `employees.password_hash` auf `null` für gegebenen Mitarbeiter
- **`set_admin_password`**: Bekommt `password`, hasht mit bcrypt, speichert als Secret `ADMIN_PASSWORD` in `app_config` (key: `admin_password_hash`)
- **`get_security_settings`**: Anpassen, damit es nicht mehr den globalen `employee_password`-Status zurückgibt, sondern ggf. den Admin-Passwort-Status

Bestehende `create_employee`-Action erweitern: optionalen `password`-Parameter annehmen, bei Angabe bcrypt-Hash in `employees.password_hash` speichern.

Bestehende `list_employees`-Action: `password_hash`-Spalte **nicht** im Klartext zurückgeben, sondern nur einen Boolean `hasPassword: !!emp.password_hash` pro Mitarbeiter.

### 3. Frontend: `Auth.tsx` (Mitarbeiter-Login)

- Referenzen auf `storedEmployeePassword` (globales PW aus `app_config`) entfernen
- Nach Mitarbeiter-Auswahl: `validate-employee` aufrufen
  - Wenn `requiresPassword: true`: Passwort-Dialog zeigen
  - Wenn `valid: true` ohne Passwort: direkt einloggen
- Fallback-Logik gegen `app_config` entfernen

### 4. Frontend: `Admin.tsx` — Mitarbeiterverwaltung

- Beim Anlegen eines Mitarbeiters: optionales Passwortfeld anzeigen
- In der Mitarbeiterliste pro Eintrag anzeigen:
  - Badge "Passwort gesetzt" oder "Kein Passwort"
  - Buttons: "Passwort setzen/ändern" und "Passwort löschen"
- Passwort setzen: Dialog mit Eingabefeld, ruft `set_employee_password` auf
- Passwort löschen: Bestätigungsdialog, ruft `delete_employee_password` auf

### 5. Frontend: `Admin.tsx` — Einstellungen-Tab

- "Mitarbeiter-Passwort" Karte ersetzen durch "Admin-Passwort" Karte
- Neues Admin-Passwort eingeben und über `set_admin_password` speichern
- Globale Mitarbeiter-Passwort-Logik komplett entfernen

### 6. Backend: `validate-admin` Edge Function

- Prüfen ob bereits `admin_password_hash` in `app_config` existiert
- Wenn ja: bcrypt-Vergleich gegen den Hash
- Fallback auf das bestehende `ADMIN_PASSWORD`-Secret beibehalten

### 7. Projekttrennung pro Mitarbeiter

**Bereits implementiert** in `Projects.tsx` (Zeile 39): `session?.role === "employee" ? projectQuery.eq("employee_id", session.id) : projectQuery`

**Noch zu ergänzen** in `ProjectDetail.tsx`:
- Nach dem Laden des Projekts prüfen: Wenn Session-Rolle `employee`, dann `employee_id` des Projekts gegen `session.id` vergleichen
- Bei Mismatch: Zugriff verweigern, zurück zu `/projects` navigieren
- Admin darf weiterhin alle Projekte öffnen

### 8. Datenbank

- `employees.password_hash` existiert bereits — keine Migration nötig
- Keine neuen Tabellen oder Spalten erforderlich

---

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `supabase/functions/validate-employee/index.ts` | Individuelles PW-Modell |
| `supabase/functions/admin-manage/index.ts` | Neue Actions, `list_employees` anpassen |
| `supabase/functions/validate-admin/index.ts` | Hash-basierte Admin-PW-Prüfung |
| `src/pages/Auth.tsx` | Globales PW entfernen, individuelles Modell |
| `src/pages/Admin.tsx` | MA-Passwort-Verwaltung pro MA, Admin-PW in Settings |
| `src/pages/ProjectDetail.tsx` | Zugriffsprüfung pro Mitarbeiter |

### Was nicht geändert wird

- Kundenansicht, Kundenkommentare, Direktlinks
- `location_feedback`, `customer_visible`, `floor_plans`
- Grundriss-Funktionalität
- Gast-Zugriff
- Datenbank-Schema (keine Migration nötig)

