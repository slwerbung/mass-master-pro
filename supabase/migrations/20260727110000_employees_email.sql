-- Die App arbeitet an mehreren Stellen mit employees.email:
--   * admin-manage: create_employee, set_employee_email, list_employees
--   * send-notification: Empfaenger "Projekt-zugeordneter Mitarbeiter"
--   * Admin-UI: Anzeige und Dialog "E-Mail setzen/aendern"
-- Die Spalte hat aber nie existiert. Die Abfragen liefen ins Leere, die
-- Einstellung "Benachrichtigung an zugeordneten Mitarbeiter" war faktisch
-- wirkungslos. Hier wird die Spalte nachgezogen.
--
-- Dieselbe Adresse ist ab jetzt auch die des Supabase-Auth-Kontos
-- (employee-auth haelt beide synchron). Eingegeben wird sie nur vom Admin,
-- der Login selbst laeuft weiterhin ueber Name + Passwort.

alter table public.employees add column if not exists email text;
