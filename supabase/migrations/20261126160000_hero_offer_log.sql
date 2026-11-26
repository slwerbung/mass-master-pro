-- hero-offer: Protokoll jedes Anlegens (Zeit, Aufrufer, Projekt, Dokument-ID, Ergebnis). Nur service_role.
create table if not exists public.hero_offer_log (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  caller           text        not null,
  command          text        not null default 'create_offer',
  project_nr       text,
  project_match_id bigint,
  document_id      bigint,
  ok               boolean     not null,
  result           jsonb       not null default '{}'::jsonb
);
create index if not exists hero_offer_log_created_idx on public.hero_offer_log (created_at desc);
alter table public.hero_offer_log enable row level security;
revoke all on table public.hero_offer_log from anon, authenticated;
revoke all on sequence public.hero_offer_log_id_seq from anon, authenticated;
