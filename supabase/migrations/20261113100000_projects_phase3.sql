-- Projekte Phase 3: Nachfassen (Entwurf in der Karte, Senden, Kette, Autopilot).
-- ZUERST anwenden, dann hero-sync/project-evaluate/project-api/project-action/email-send deployen
-- (hero-sync schreibt die neuen Spalten kunde_email/kunde_telefon).

-- Kontakt des Projekts (Empfaenger der Nachfass-Mail, Telefonnummer fuer die Anruf-Karte).
alter table public.hero_projects add column if not exists kunde_email text not null default '';
alter table public.hero_projects add column if not exists kunde_telefon text not null default '';

-- Nachfass-Mails: Regel, Stufe, Versandspur. 'sending' = wird gerade gesendet (verhindert Doppelversand).
alter table public.project_followup_mails add column if not exists rule_key text not null default 'nachfassen';
alter table public.project_followup_mails add column if not exists auto boolean not null default false;
alter table public.project_followup_mails add column if not exists error text;
alter table public.project_followup_mails add column if not exists attempts integer not null default 0;
alter table public.project_followup_mails add column if not exists message_id text;
alter table public.project_followup_mails add column if not exists stopped_reason text;
alter table public.project_followup_mails add column if not exists reply_seen_at timestamptz;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.project_followup_mails'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%state%'
  loop
    execute format('alter table public.project_followup_mails drop constraint %I', c);
  end loop;
end $$;
alter table public.project_followup_mails
  add constraint project_followup_mails_state_check check (state in ('draft','sending','sent','stopped'));

-- Hoechstens ein offener Entwurf je Projekt, Regel und Stufe.
create unique index if not exists project_followup_mails_open_uq
  on public.project_followup_mails (hero_id, rule_key, stage) where state in ('draft','sending');
create index if not exists project_followup_mails_hero_idx on public.project_followup_mails (hero_id, state);

-- Kettenkarten (Spec: Stufe 2 = Anruf, Stufe 3 = „Angebot verloren?“) und „Kunde hat geantwortet“.
insert into public.project_rules (key, label, category, threshold_days, suggestion, channel, followup_days, followup_reason, autopilot, sort) values
  ('kunde_antwort',       'Kunde hat geantwortet',   'kunde',   null, 'Antwort ansehen',      'hero', 3,  'Antwort bearbeiten',        'off', 5),
  ('nachfassen_anruf',    'Nachfassen: Anrufen',     'auftrag', 7,    'Anrufen',              'hero', 7,  'Nach dem Anruf nachhaken',  'off', 75),
  ('nachfassen_verloren', 'Angebot verloren?',       'auftrag', 30,   'Angebot archivieren',  'api',  14, 'Angebot prüfen',            'off', 76)
on conflict (key) do nothing;

-- Sicherheitsgrenzen fuer den Autopiloten (Regel auf „auto“): je Lauf und je Tag.
insert into public.app_config (key, value) values
  ('projects_auto_max_per_run', '5'),
  ('projects_auto_max_per_day', '20'),
  ('projects_followup_account_id', '')
on conflict (key) do nothing;
