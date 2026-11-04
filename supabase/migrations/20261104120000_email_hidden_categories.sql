-- Mail-App: Kategorien je Benutzer sperren (Einstellungen → Benutzer). Ein Mitarbeiter sieht Mails dieser
-- Kategorien nirgends (Liste, Themen, Zu entscheiden, Detail) und bekommt dafuer keine Push-Nachricht.
-- Admins sehen immer alles (die Spalte wird fuer sie ignoriert).
alter table public.email_user_prefs add column if not exists hidden_categories text[] not null default '{}';
