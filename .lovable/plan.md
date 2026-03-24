

## Plan: RLS-Policies und Sync-Bugs reparieren

### Gefundene Probleme

**1. `customer_project_assignments` — RLS blockiert alles**
Die Tabelle hat `USING (false)` für alle Operationen. Das Frontend (anon-Rolle) kann weder lesen noch schreiben. Betrifft:
- `CustomerView.tsx` Zeile 163: Zuweisungen des Kunden werden nicht geladen → Kunde sieht keine Projekte
- `CustomerManage.tsx` Zeile 41: Zuweisungsliste bleibt leer
- `CustomerManage.tsx` Zeile 87: Neue Zuweisungen können nicht angelegt werden

**2. `customers` — INSERT/UPDATE/DELETE fehlt**
Die Tabelle hat nur eine SELECT-Policy. `CustomerManage.tsx` Zeile 66 versucht, neue Kunden direkt per `supabase.from("customers").insert(...)` anzulegen — schlägt fehl.

**3. `user_id` wird auf den String `"employee"` oder `"admin"` gesetzt**
In `supabaseSync.ts` Zeile 273: `user_id: session?.id || 'employee'`. Wenn der Admin eingeloggt ist, ist `session.id` der String `"admin"`, was kein gültiger UUID-Wert ist. Das verursacht den 400-Fehler `invalid input syntax for type uuid: "employee"`, der in den Netzwerk-Logs sichtbar ist. Gleicher Bug in `CustomerManage.tsx` Zeile 81.

**4. `employees` SELECT-Policy gibt `password_hash` preis**
Die `employees`-Tabelle hat eine offene SELECT-Policy für anon. Da `password_hash` eine Spalte ist, kann jeder Browser-Nutzer die Passwort-Hashes auslesen. Das ist ein Sicherheitsproblem.

---

### Lösung

#### A. Datenbank-Migrationen

**Migration 1: `customer_project_assignments` RLS reparieren**
- Bestehende "No direct access"-Policy entfernen
- SELECT-Policy für anon hinzufügen (Zuweisungen lesen)
- INSERT-Policy für anon hinzufügen (Zuweisungen anlegen)
- DELETE-Policy für anon hinzufügen (Zuweisungen löschen)

**Migration 2: `customers` INSERT/DELETE erlauben**
- INSERT-Policy für anon hinzufügen
- DELETE-Policy für anon hinzufügen

**Migration 3: `employees` — sichere View erstellen**
- View `employees_public` erstellen mit nur `id`, `name`, `created_at` (ohne `password_hash`)
- Bestehende SELECT-Policy auf employees beibehalten (wird intern von Edge Functions gebraucht)

#### B. Code-Änderungen

**`src/lib/supabaseSync.ts`** — `user_id`-Bug fixen:
- Zeile 273: Wenn `session.id` kein UUID ist (z.B. `"admin"` oder `"employee"`), stattdessen `employee_id` als `user_id` verwenden oder einen festen Platzhalter-UUID nutzen
- Konkret: `user_id` auf die `employee_id` setzen, wenn verfügbar, sonst einen konsistenten UUID-Fallback

**`src/pages/CustomerManage.tsx`** — Zeile 81: Gleicher `user_id`-Fix

**`src/pages/Auth.tsx`** — Mitarbeiter-Liste über die View laden statt direkt aus `employees`:
- Zeile 36: `supabase.from("employees_public")` statt `supabase.from("employees")`

---

### Was sich nicht ändert

- Keine UI-Layout-Änderungen
- Keine Änderungen an Kundenansicht, Feedback, Floor Plans, Direktlinks
- Keine Edge-Function-Änderungen (die nutzen service_role und sind nicht betroffen)
- Keine Dependency-Änderungen

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| Neue Migration | RLS für `customer_project_assignments`, `customers` |
| Neue Migration | View `employees_public` |
| `src/lib/supabaseSync.ts` | `user_id`-UUID-Fix |
| `src/pages/CustomerManage.tsx` | `user_id`-UUID-Fix |
| `src/pages/Auth.tsx` | View statt Tabelle für Mitarbeiterliste |

