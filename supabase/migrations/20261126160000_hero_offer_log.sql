-- hero-offer: Protokoll jedes Anlegens (Zeit, Aufrufer, Projekt, Dokument-ID, Ergebnis). Nur service_role.
-- Spiegel der Produktion (Stand 27.11.2026, live gelesen): `result` ist jsonb, dazu command / project_match_id / ok.
-- Die Tabelle existiert live bereits; diese Migration ist idempotent und ändert dort nichts.
create table if not exists public.hero_offer_log (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  caller           text,
  project_nr       text,
  document_id      bigint,
  result           jsonb,
  command          text,
  project_match_id bigint,
  ok               boolean
);
create index if not exists hero_offer_log_created_idx on public.hero_offer_log (created_at desc);
alter table public.hero_offer_log enable row level security;
revoke all on table public.hero_offer_log from anon, authenticated;
revoke all on sequence public.hero_offer_log_id_seq from anon, authenticated;
