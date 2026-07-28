-- Nachschlagen einer Auth-User-ID ueber die E-Mail-Adresse.
--
-- Kunden bekommen eine technische Adresse (customer-<uuid>@captfix.invalid).
-- Sollte je ein Auth-Benutzer ohne passenden profiles-Eintrag zurueckbleiben,
-- wuerde createUser dauerhaft an "already registered" scheitern und der Login
-- des Kunden waere blockiert. Mit dieser Funktion findet die Edge Function den
-- vorhandenen Benutzer und haengt das fehlende Profil einfach an.
--
-- Nur service_role darf sie aufrufen -- weder anon noch authenticated.

create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select id from auth.users where lower(email) = lower(p_email) limit 1 $$;

revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;
