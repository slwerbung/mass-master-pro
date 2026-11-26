-- hero-offer: Protokoll jedes Anlegens (Zeit, Aufrufer, Projekt, Dokument-ID, Ergebnis). Nur service_role.
-- Aufbau wie in der Produktion (Tabelle existierte vor dieser Migration): `result` ist Text; hero-offer legt dort JSON ab
-- ({ command, ok, project_match_id, services, recalc_skipped, recalc | error }).
create table if not exists public.hero_offer_log (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  caller      text,
  project_nr  text,
  document_id bigint,
  result      text
);
create index if not exists hero_offer_log_created_idx on public.hero_offer_log (created_at desc);
alter table public.hero_offer_log enable row level security;
revoke all on table public.hero_offer_log from anon, authenticated;
revoke all on sequence public.hero_offer_log_id_seq from anon, authenticated;
