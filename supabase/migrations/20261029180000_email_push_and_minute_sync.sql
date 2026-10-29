-- Mail-App: Abruf jede Minute, Push-Benachrichtigungen, Projekt beim Senden, Schutz gegen haengende Postfaecher.

-- 1. Abruf jede Minute (wie ein Mailprogramm). Die KI laeuft nur fuer neue Mails, das kostet nicht mehr.
--    Ein Lauf ohne neue Mails ist ein IMAP-Login und zwei Ordnerabfragen. Der Postfach-Lock (locked_until)
--    verhindert, dass sich Laeufe ueberholen.
do $$ begin perform cron.unschedule('email-sync'); exception when others then null; end $$;
select cron.schedule(
  'email-sync',
  '* * * * *',
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

-- 2. Wo der letzte Abruf angefangen hat (sync.ts, STUCK_*): bricht er an derselben Mail mehrfach hart ab,
--    wird sie uebersprungen statt das Postfach dauerhaft anzuhalten.
alter table public.email_accounts add column if not exists sync_stuck jsonb;

-- 3. Push-Benachrichtigungen (Web Push). Je Geraet ein Abo; Einstellungen je Benutzer.
create table if not exists public.email_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures integer not null default 0
);
create index if not exists email_push_subscriptions_user_idx on public.email_push_subscriptions(user_id);

create table if not exists public.email_user_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  push_decide boolean not null default true,
  push_incoming boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.email_push_subscriptions enable row level security;
alter table public.email_user_prefs enable row level security;
revoke all on public.email_push_subscriptions from anon, authenticated;
revoke all on public.email_user_prefs from anon, authenticated;
grant all on public.email_push_subscriptions to service_role;
grant all on public.email_user_prefs to service_role;

-- Jede eingehende Mail wird genau einmal auf Benachrichtigung geprueft.
alter table public.email_messages add column if not exists pushed_at timestamptz;
-- Alles, was schon da ist, nicht nachtraeglich melden.
update public.email_messages set pushed_at = now() where pushed_at is null;
create index if not exists email_messages_push_idx on public.email_messages(account_id) where pushed_at is null and direction = 'in';

-- 4. Projekt, das der Mitarbeiter beim Senden gewaehlt hat: die gesendete Mail kommt ueber den Gesendet-Ordner
--    zurueck und wird diesem Projekt sicher zugeordnet (Logbuch wie bei eingehenden Mails).
alter table public.email_sent add column if not exists project_id bigint;
