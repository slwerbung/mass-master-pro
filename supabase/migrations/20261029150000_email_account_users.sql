-- Mail-App: Benutzer und ihre Postfaecher.
--
-- Ein Admin (profiles.role = 'admin') sieht alle Postfaecher. Ein Mitarbeiter (role = 'mitarbeiter') sieht in der
-- Mail-App nur die Postfaecher, die ihm hier zugeordnet sind – ohne Zuordnung hat er keinen Zugang zur Mail-App.
-- Angelegt und zugeordnet wird in der Mail-App unter Einstellungen → Benutzer (email-api, service_role).

create table if not exists public.email_account_users (
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create index if not exists email_account_users_user_idx on public.email_account_users(user_id);

alter table public.email_account_users enable row level security;
revoke all on public.email_account_users from anon, authenticated;
grant all on public.email_account_users to service_role;

-- An Lexware weitergeleitete Belege sind entschieden (sie werden nicht vorgelegt). Bisher hat das nur der Filter
-- in topics.ts erledigt; so steht es auch an der Mail.
create or replace function public.email_beleg_decided()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.beleg_state = 'weitergeleitet' and new.decided_at is null then
    new.decided_at := now();
    new.decision := 'an Lexware gesendet';
  end if;
  return new;
end $$;

drop trigger if exists email_messages_beleg_decided on public.email_messages;
create trigger email_messages_beleg_decided
  before insert or update of beleg_state on public.email_messages
  for each row execute function public.email_beleg_decided();

update public.email_messages
   set decided_at = coalesce(forwarded_at, now()), decision = 'an Lexware gesendet'
 where beleg_state = 'weitergeleitet' and decided_at is null;
