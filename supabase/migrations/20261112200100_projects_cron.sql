-- Projekte Phase 1: Zeitplaene. ERST ANWENDEN, wenn die Functions hero-sync und project-evaluate deployt sind.
-- Aufruf wie beim Mail-Assistenten: Header x-cron-secret aus app_config.email_cron_secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Spiegel + Regeln alle 10 Minuten.
do $$ begin perform cron.unschedule('hero-sync'); exception when others then null; end $$;
select cron.schedule(
  'hero-sync',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/hero-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_config where key = 'email_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Waisen-Check taeglich 6:30 Ortszeit (UTC+1; im Sommer 7:30).
do $$ begin perform cron.unschedule('project-evaluate'); exception when others then null; end $$;
select cron.schedule(
  'project-evaluate',
  '30 5 * * *',
  $$
  select net.http_post(
    url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/project-evaluate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_config where key = 'email_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
