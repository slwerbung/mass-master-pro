-- hero-calc/hero-offer: Team-Schlüssel (nur der SHA-256-Hash wird gespeichert, nie der Schlüssel selbst).
-- Aufbau wie in der Produktion (Tabelle existierte vor dieser Migration). Nur service_role: RLS an, keine Policy, kein Grant.
create table if not exists public.hero_team_keys (
  id           bigserial primary key,
  name         text        not null,
  key_hash     text        not null,
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.hero_team_keys enable row level security;
revoke all on table public.hero_team_keys from anon, authenticated;
revoke all on sequence public.hero_team_keys_id_seq from anon, authenticated;
