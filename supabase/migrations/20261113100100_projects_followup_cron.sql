-- Projekte Phase 3: Autopilot-Runner stuendlich. ERST ANWENDEN, wenn followup-runner UND email-send (neue Aktion
-- send_followup_auto) deployt sind. Im Schattenmodus (projects_write_enabled != 'true') tut der Runner nichts.
-- Aufruf wie bei den anderen Jobs: Header x-cron-secret aus app_config.email_cron_secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin perform cron.unschedule('followup-runner'); exception when others then null; end $$;
select cron.schedule(
  'followup-runner',
  '12 * * * *',
  $$
  select net.http_post(
    url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/followup-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_config where key = 'email_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
