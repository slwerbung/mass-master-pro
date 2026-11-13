-- Projekte Phase 4: HERO-Arbeitsmodus ("In HERO erledigen" -> neuer Tab -> Rueckkehr -> Abgleich).
-- hero_tasks gibt es seit Phase 1; hier kommen Projektbezug, Name des Bearbeiters und ein Index fuer offene Aufgaben dazu.
alter table public.hero_tasks add column if not exists hero_id bigint;
alter table public.hero_tasks add column if not exists created_by_name text not null default '';
create index if not exists hero_tasks_open_idx on public.hero_tasks (card_id) where finished_at is null;
create index if not exists hero_tasks_hero_idx on public.hero_tasks (hero_id, created_at desc);

-- Abgelaufene Sperren (30 Min) geben die Karte wieder frei. Reines SQL, alle 5 Minuten.
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('project_release_hero_locks'); exception when others then null; end $$;
select cron.schedule(
  'project_release_hero_locks',
  '*/5 * * * *',
  $$
  update public.project_cards
     set state = 'open', locked_until = null, locked_by = null, updated_at = now()
   where state = 'in_hero' and locked_until is not null and locked_until < now();
  $$
);
