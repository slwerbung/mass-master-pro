-- hero-calc: Protokoll des nächtlichen Vertragstests + Secret für den Cron-Aufruf (nur service_role).
create table if not exists public.hero_calc_contract_log (
  id         bigserial primary key,
  mode       text        not null,
  ok         boolean     not null,
  detail     jsonb       not null,
  created_at timestamptz not null default now()
);
create index if not exists hero_calc_contract_log_created_idx on public.hero_calc_contract_log (created_at desc);
alter table public.hero_calc_contract_log enable row level security;
revoke all on table public.hero_calc_contract_log from anon, authenticated;
revoke all on sequence public.hero_calc_contract_log_id_seq from anon, authenticated;

-- Secret fuer den Cron-Aufruf von hero-calc-contract (wie archive_poll_secret).
insert into public.app_config(key, value)
select 'hero_calc_poll_secret', encode(extensions.gen_random_bytes(24), 'hex')
where not exists (select 1 from public.app_config where key = 'hero_calc_poll_secret');
