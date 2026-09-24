-- Terminbuchung, Schritt 4: HERO-Leserichtung.
--
-- Bestehende HERO-Termine muessen Slots blockieren, sonst bucht ein Kunde eine
-- Zeit, in der der Mitarbeiter laengst auf einer Montage steht. HERO hat keine
-- Webhooks freigeschaltet, also pollt pg_cron alle 10 Minuten die Edge Function
-- `booking-hero-sync`, die `calendar_events` liest und daraus
-- `busy_block(source='hero')` schreibt.

-- ── Eindeutigkeit je Quelle ──
-- Ohne diesen Index waere jeder Poll-Lauf ein Duplikat. NULL-source_ref
-- (haendisch angelegte Blocks) kollidiert nicht, das ist Absicht.
create unique index if not exists busy_block_source_ref_staff_uidx
  on public.busy_block (source, source_ref, staff_id);

-- ── Einstellungen ──
insert into public.app_config (key, value)
values
  -- Zufaelliges Secret fuer den Cron-Aufruf, gleiche Bauart wie beim
  -- Dropbox-Poll: der Job liest es zur Laufzeit, es steht nirgends doppelt.
  ('booking_poll_secret', gen_random_uuid()::text || gen_random_uuid()::text),
  -- Wie weit nach vorne gelesen wird. Deckt das Buchungsfenster (60 Tage) ab.
  ('booking_hero_sync_days', '60')
on conflict (key) do nothing;

-- Kategorie fuer die Termine, die WIR in HERO anlegen: "Aufmass" (HERO-ID
-- 224953). Nur setzen, wenn noch nichts hinterlegt ist.
update public.app_config
set value = '224953'
where key = 'booking_hero_category_id' and coalesce(value, '') = '';

-- ── Zeitplan ──
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('booking-hero-sync');
exception when others then
  null; -- Job existierte noch nicht
end $$;

select cron.schedule(
  'booking-hero-sync',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/booking-hero-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-poll-secret', (select value from public.app_config where key = 'booking_poll_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
