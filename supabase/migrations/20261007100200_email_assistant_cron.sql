-- KI-Mail-Assistent: Zeitplaene.
--
-- pg_cron ruft die Edge Functions mit einem zufaelligen Secret in app_config auf
-- (Header `x-cron-secret`, wie beim HERO-Dropbox-Abgleich). Die Functions lehnen
-- jeden Aufruf ab, wenn das Secret fehlt oder nicht passt. Die Postfaecher sind
-- bis zur Freigabe in der Mail-App aus (`enabled = false`); die Jobs tun dann
-- nichts.

create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into public.app_config (key, value)
values ('email_cron_secret', gen_random_uuid()::text || gen_random_uuid()::text)
on conflict (key) do nothing;

-- Abruf: alle 5 Minuten, ein Aufruf je aktivem Postfach.
do $$ begin perform cron.unschedule('email-sync'); exception when others then null; end $$;
select cron.schedule(
  'email-sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/email-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_config where key = 'email_cron_secret')
    ),
    body := jsonb_build_object('accountId', a.id)
  )
  from public.email_accounts a
  where a.enabled;
  $$
);

-- Nachzuegler: Mails, die email-sync nicht mehr verarbeiten konnte (Laufzeitgrenze, Fehler).
do $$ begin perform cron.unschedule('email-process'); exception when others then null; end $$;
select cron.schedule(
  'email-process',
  '2-59/5 * * * *',
  $$
  select net.http_post(
    url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/email-process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_config where key = 'email_cron_secret')
    ),
    body := jsonb_build_object('accountId', a.id)
  )
  from public.email_accounts a
  where a.enabled;
  $$
);

-- Aufbewahrung: Mailtext und Anhaenge nach `retention_days` (Standard 180)
-- entfernen; Metadaten, Zusammenfassung und HERO-Bezug bleiben.
create or replace function public.email_retention() returns void
language plpgsql security definer set search_path = public, storage as $$
declare
  days integer := coalesce((select (value #>> '{}')::integer from public.email_config where key = 'retention_days'), 180);
  cutoff timestamptz := now() - make_interval(days => days);
begin
  delete from storage.objects
  where bucket_id = 'email-attachments'
    and name in (
      select a.storage_path from public.email_attachments a
      join public.email_messages m on m.id = a.message_id
      where a.storage_path is not null and coalesce(m.sent_at, m.created_at) < cutoff
    );
  update public.email_attachments a
     set storage_path = null
    from public.email_messages m
   where m.id = a.message_id and a.storage_path is not null and coalesce(m.sent_at, m.created_at) < cutoff;
  update public.email_messages
     set body_text = null
   where body_text is not null and coalesce(sent_at, created_at) < cutoff;
  delete from public.email_ai_calls where created_at < now() - interval '400 days';
  delete from public.email_runs where started_at < now() - interval '90 days';
end $$;
revoke all on function public.email_retention() from public, anon, authenticated;
grant execute on function public.email_retention() to service_role;

do $$ begin perform cron.unschedule('email-retention'); exception when others then null; end $$;
select cron.schedule('email-retention', '17 3 * * *', $$ select public.email_retention(); $$);
