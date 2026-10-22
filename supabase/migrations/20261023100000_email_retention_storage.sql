-- KI-Mail-Assistent: Aufbewahrung scharf schalten.
--
-- Die bisherige email_retention() loeschte Anhaenge direkt in storage.objects. Das sperrt Supabase per Trigger
-- (storage.protect_delete) – die Funktion brach damit komplett ab. Neu:
--   * Edge Function `email-retention` (pg_cron taeglich 03:17) loescht die Dateien ueber die Storage-API,
--     Kandidaten liefert email_retention_files(), danach ruft sie email_retention() auf.
--   * email_retention() kuerzt nur noch Mailtexte/HTML und raeumt alte Protokolle auf.
-- Die Mail selbst (Absender, Betreff, Kategorie, Zuordnung) bleibt. Im Postfach wird nichts angefasst.

create or replace function public.email_retention_cutoff() returns timestamptz
language sql stable security definer set search_path = public as $$
  select now() - make_interval(days => coalesce((select (value #>> '{}')::integer from public.email_config where key = 'retention_days'), 180));
$$;

create or replace function public.email_retention_files(max_rows integer default 100)
returns table (id uuid, storage_path text)
language sql stable security definer set search_path = public as $$
  select a.id, a.storage_path
    from public.email_attachments a
    join public.email_messages m on m.id = a.message_id
   where a.storage_path is not null
     and coalesce(m.sent_at, m.created_at) < public.email_retention_cutoff()
   order by coalesce(m.sent_at, m.created_at)
   limit greatest(1, least(max_rows, 1000));
$$;

create or replace function public.email_retention() returns void
language plpgsql security definer set search_path = public as $$
declare
  cutoff timestamptz := public.email_retention_cutoff();
begin
  update public.email_messages
     set body_text = null, body_html = null
   where (body_text is not null or body_html is not null) and coalesce(sent_at, created_at) < cutoff;
  delete from public.email_ai_calls where created_at < now() - interval '400 days';
  delete from public.email_runs where started_at < now() - interval '90 days';
end $$;

revoke all on function public.email_retention_cutoff() from public, anon, authenticated;
revoke all on function public.email_retention_files(integer) from public, anon, authenticated;
revoke all on function public.email_retention() from public, anon, authenticated;
grant execute on function public.email_retention_cutoff() to service_role;
grant execute on function public.email_retention_files(integer) to service_role;
grant execute on function public.email_retention() to service_role;

alter table public.email_runs drop constraint if exists email_runs_kind_check;
alter table public.email_runs add constraint email_runs_kind_check check (kind in ('sync', 'process', 'test', 'retention'));

do $$ begin perform cron.unschedule('email-retention'); exception when others then null; end $$;
select cron.schedule(
  'email-retention', '17 3 * * *',
  $$ select net.http_post(
       url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/email-retention',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.app_config where key = 'email_cron_secret')),
       body := '{}'::jsonb
     ); $$
);
