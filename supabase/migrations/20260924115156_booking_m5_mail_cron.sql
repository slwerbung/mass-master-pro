-- Terminbuchung, Schritt 5: Mail-Outbox.
--
-- Die Buchung schreibt nur `notification`-Zeilen, verschickt aber nichts. Das
-- macht `booking-mail`, von pg_cron alle 5 Minuten angestossen: eine Buchung
-- darf nicht scheitern, weil Resend gerade zickt, und die Erinnerung muss Tage
-- spaeter rausgehen, ohne dass irgendwer wartet.

do $$
begin
  perform cron.unschedule('booking-mail');
exception when others then
  null;
end $$;

select cron.schedule(
  'booking-mail',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/booking-mail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-poll-secret', (select value from public.app_config where key = 'booking_poll_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Faellige Zeilen schnell finden: der Worker fragt genau so.
create index if not exists notification_due_idx
  on public.notification (send_after)
  where sent_at is null;
