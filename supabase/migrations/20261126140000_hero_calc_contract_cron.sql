-- hero-calc: Vertragstest jede Nacht 01:47 UTC gegen den Testentwurf in WER-1984 (Function hero-calc-contract).
-- Erst einspielen, nachdem der Vertragstest einmal von Hand grün gelaufen ist.
do $$
begin
  perform cron.unschedule('hero_calc_contract');
exception when others then null;
end $$;
select cron.schedule('hero_calc_contract', '47 1 * * *', $cron$
  select net.http_post(
    url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/hero-calc-contract',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-poll-secret', (select value from public.app_config where key = 'hero_calc_poll_secret')),
    body := '{"mode":"contract"}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
