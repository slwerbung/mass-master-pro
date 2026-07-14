-- Zeitplan für den HERO→Dropbox-Abgleich: pg_cron ruft alle 10 Minuten die
-- Edge Function hero-dropbox-poll auf. Authentifizierung über ein zufälliges
-- Poll-Secret in app_config, das die Function gegen den Header x-poll-secret
-- prüft (der Cron-Job liest es zur Laufzeit — keine Duplikate).
-- Die Function selbst tut nichts, solange dropbox_enabled != 'true'.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

INSERT INTO public.app_config (key, value)
VALUES ('dropbox_poll_secret', gen_random_uuid()::text || gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;

-- Bestehenden Job ersetzen (idempotent).
DO $$
BEGIN
  PERFORM cron.unschedule('hero-dropbox-poll');
EXCEPTION WHEN OTHERS THEN
  NULL; -- Job existierte noch nicht
END $$;

SELECT cron.schedule(
  'hero-dropbox-poll',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/hero-dropbox-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-poll-secret', (SELECT value FROM public.app_config WHERE key = 'dropbox_poll_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
