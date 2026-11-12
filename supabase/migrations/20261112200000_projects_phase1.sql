-- Projekte abarbeiten wie Mails – Phase 1: Spiegel der HERO-Projekte, Regeln, Karten (Schattenmodus).
--
-- Gelesen wird ueber die Edge Function `project-api` (Mail-App-Sitzung). Die Policies erlauben
-- Mitarbeitern (is_staff) nur LESEN; geschrieben wird ausschliesslich mit service_role.
-- Seit der Data-API-Umstellung (30.10.2026) braucht jede Tabelle explizite GRANTs.

create or replace function public.projects_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------- Projektspiegel
create table if not exists public.hero_projects (
  hero_id        bigint primary key,
  project_nr     text not null default '',
  name           text not null default '',
  kunde          text not null default '',
  ort            text not null default '',
  gewerk         text not null default '',
  step_id        integer,
  step_name      text not null default '',
  step_key       text not null default '',
  step_since     timestamptz,
  assignee_emails text[] not null default '{}',
  documents      jsonb not null default '[]'::jsonb,
  hero_created   timestamptz,
  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists hero_projects_step_idx on public.hero_projects (step_key);

create table if not exists public.project_step_settings (
  step_id     integer primary key,
  name        text not null,
  key         text not null default '',
  target_days integer not null default 7 check (target_days >= 0),
  excluded    boolean not null default false,
  closeness   integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.project_rules (
  key           text primary key,
  label         text not null,
  category      text not null check (category in ('kunde','auftrag','termine','pflege')),
  threshold_days integer,
  suggestion    text not null default '',
  channel       text not null check (channel in ('api','mail','hero','termine')),
  followup_days integer,
  followup_reason text not null default '',
  autopilot     text not null default 'suggest' check (autopilot in ('off','suggest','auto')),
  sort          integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.project_cards (
  id            uuid primary key default gen_random_uuid(),
  hero_id       bigint not null,
  rule_key      text not null,
  reasons       jsonb not null default '{}'::jsonb,
  category      text not null check (category in ('kunde','auftrag','termine','pflege')),
  priority      bigint not null default 0,
  state         text not null default 'open' check (state in ('open','in_hero','done','snoozed','muted','auto')),
  bundled       boolean not null default false,
  assignee_employee_id uuid references public.employees(id) on delete set null,
  locked_until  timestamptz,
  locked_by     uuid,
  closed_at     timestamptz,
  close_reason  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Hoechstens eine lebende Karte je Projekt.
create unique index if not exists project_cards_live_uq on public.project_cards (hero_id)
  where state in ('open','in_hero','snoozed','muted','auto');
create index if not exists project_cards_state_idx on public.project_cards (state, priority);

-- Gemeinsam fuer Mails und Projekte.
create table if not exists public.followups (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('email','project')),
  email_id    uuid,
  hero_id     bigint,
  due_at      timestamptz not null,
  reason      text not null default '',
  stage       integer not null default 1,
  created_by  uuid,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((target_type = 'email' and email_id is not null) or (target_type = 'project' and hero_id is not null))
);
create index if not exists followups_open_idx on public.followups (due_at) where done_at is null;
create index if not exists followups_hero_idx on public.followups (hero_id) where done_at is null;

create table if not exists public.project_followup_mails (
  id         uuid primary key default gen_random_uuid(),
  hero_id    bigint not null,
  stage      integer not null default 1,
  subject    text not null default '',
  body       text not null default '',
  to_email   text,
  state      text not null default 'draft' check (state in ('draft','sent','stopped')),
  sent_at    timestamptz,
  sent_message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_followup_templates (
  rule_key   text not null references public.project_rules(key) on delete cascade,
  stage      integer not null default 1,
  subject    text not null default '',
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (rule_key, stage)
);

create table if not exists public.project_autopilot (
  hero_id    bigint not null,
  rule_key   text not null,
  mode       text not null check (mode in ('off','suggest','auto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (hero_id, rule_key)
);

create table if not exists public.project_rule_mutes (
  hero_id    bigint not null,
  rule_key   text not null,
  until      timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (hero_id, rule_key)
);

create table if not exists public.hero_tasks (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid references public.project_cards(id) on delete set null,
  email_id    uuid,
  task        text not null,
  checklist   jsonb not null default '[]'::jsonb,
  before      jsonb,
  result      text check (result in ('done','partial','problem')),
  check_result jsonb,
  created_by  uuid,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.project_actions_log (
  id            uuid primary key default gen_random_uuid(),
  "user"        text not null default '',
  action        text not null,
  hero_id       bigint,
  payload       jsonb not null default '{}'::jsonb,
  shadow        boolean not null default true,
  hero_response jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists project_actions_log_hero_idx on public.project_actions_log (hero_id, created_at desc);

create table if not exists public.project_event_types (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  duration_minutes integer not null default 60,
  gap_days         integer not null default 0,
  default_employee_id uuid references public.employees(id) on delete set null,
  sort             integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Letzter Lauf von hero-sync / project-evaluate (fuer die Anzeige).
create table if not exists public.project_runs (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('sync','evaluate')),
  ok         boolean not null default true,
  stats      jsonb not null default '{}'::jsonb,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_runs_idx on public.project_runs (kind, created_at desc);

-- ---------------------------------------------------------------- Trigger, RLS, GRANTs
do $$
declare t text;
begin
  foreach t in array array[
    'hero_projects','project_step_settings','project_rules','project_cards','followups','project_followup_mails',
    'project_followup_templates','project_autopilot','project_rule_mutes','hero_tasks','project_actions_log',
    'project_event_types','project_runs'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.projects_touch_updated_at()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_staff_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- Startbelegung
insert into public.app_config (key, value) values
  ('projects_write_enabled', 'false'),
  ('projects_bundle_after_days', '60'),
  ('projects_followup_hours', '{"days":[1,2,3,4,5],"from":8,"to":17}'),
  ('projects_quick_actions', '["set_step","logbook_note","create_events","create_offer","create_confirmation","archive","mute"]'),
  ('projects_ignored_assignees', '["info@slwerbung.de"]')
on conflict (key) do nothing;

insert into public.project_rules (key, label, category, threshold_days, suggestion, channel, followup_days, followup_reason, autopilot, sort) values
  ('reklamation',          'Reklamation',                         'kunde',   null, 'Reklamation bearbeiten',     'hero',    3,    'Reklamation erledigt?',        'off',     10),
  ('freigabe_offen',       'Layoutfreigabe offen',                'kunde',   5,    'Kunde an Freigabe erinnern', 'mail',    7,    'Freigabe nachfassen',          'suggest', 20),
  ('abholung',             'Abholung offen',                      'kunde',   7,    'An Abholung erinnern',       'mail',    7,    'Abholung nachfassen',          'suggest', 30),
  ('anfrage_ohne_angebot', 'Anfrage ohne Angebot',                'auftrag', null, 'Angebot erstellen',          'hero',    3,    'Nachfassen Angebot',           'off',     40),
  ('anfrage_status_alt',   'Anfrage mit versendetem Angebot',     'auftrag', null, 'Status auf Warten auf Auftrag', 'api',  7,    'Status prüfen',                'off',     50),
  ('angebot_entwurf',      'Angebot nicht fertig',                'auftrag', null, 'Angebot fertigstellen',      'hero',    3,    'Angebot versendet?',           'off',     60),
  ('nachfassen',           'Angebot nachfassen',                  'auftrag', 7,    'Nachfassen',                 'mail',    7,    'Nachfassen Stufe 2',           'suggest', 70),
  ('ab_fehlt',             'Auftragsbestätigung fehlt',           'auftrag', 2,    'AB erstellen',               'hero',    3,    'Termine anlegen',              'off',     80),
  ('termine_fehlen',       'Termine fehlen',                      'termine', 7,    'Termine anlegen',            'termine', 14,   'Montage bestätigen lassen',    'off',     90),
  ('haengt',               'Hängt im Status',                     'termine', null, 'Status weitersetzen',        'api',     7,    'Status prüfen',                'off',     100),
  ('waise',                'Ohne nächsten Schritt',               'pflege',  null, 'Nächsten Schritt planen',    'api',     null, '',                             'off',     110)
on conflict (key) do nothing;

insert into public.project_followup_templates (rule_key, stage, subject, body) values
  ('nachfassen', 1, 'Ihr Angebot: {projekt}',
   E'Hallo,\nkurze Nachfrage zu unserem Angebot „{projekt}“ vom {angebot_datum}.\nPasst alles, oder sollen wir noch etwas anpassen?\nViele Grüße\nSL WERBUNG'),
  ('freigabe_offen', 1, 'Freigabe: {projekt}',
   E'Hallo,\nhaben Sie unseren Layoutvorschlag für „{projekt}“ schon anschauen können?\nSobald Sie die Freigabe geben, legen wir los.\nViele Grüße\nSL WERBUNG'),
  ('abholung', 1, 'Ihre Abholung: {projekt}',
   E'Hallo,\n„{projekt}“ ist fertig und liegt für Sie zur Abholung bereit.\nSagen Sie einfach kurz Bescheid, wann es passt.\nViele Grüße\nSL WERBUNG')
on conflict (rule_key, stage) do nothing;

insert into public.project_event_types (name, duration_minutes, gap_days, sort)
select * from (values ('Gestaltung', 120, 0, 10), ('Produktion', 240, 3, 20), ('Montage', 240, 3, 30)) v(name, duration_minutes, gap_days, sort)
where not exists (select 1 from public.project_event_types);
