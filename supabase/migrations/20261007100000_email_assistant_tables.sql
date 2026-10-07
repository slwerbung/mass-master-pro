-- KI-Mail-Assistent (docs/mail-assistent/): Tabellen.
--
-- BEWUSSTE AUSNAHME von der ueblichen CaptFix-Vorlage: Mails sind sensibler als
-- der Rest der Datenbank. Alle Tabellen haben RLS an, KEINE Policy und KEINEN
-- Grant fuer anon/authenticated — nur service_role kommt heran. Die Mail-App
-- liest und schreibt ausschliesslich ueber die Edge Function `email-api`, die
-- eine Supabase-Auth-Sitzung mit Rolle `admin` verlangt.

-- ---------------------------------------------------------------------------
-- Postfaecher
-- ---------------------------------------------------------------------------
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  address text not null unique,
  imap_host text not null,
  imap_port integer not null default 993,
  username text not null,
  -- AES-GCM, Schluessel EMAIL_ENCRYPTION_KEY (Edge Function Secret). Nie im Klartext.
  password_enc text,
  -- { inbox, sent, drafts, trash, folders: { kunden, lieferanten, belege, ausschreibungen,
  --   verwaltung, newsletter, system, aussortiert } } — Pfade im Postfach
  folder_map jsonb not null default '{}'::jsonb,
  inbox_uidvalidity text,
  inbox_last_uid bigint,
  sent_uidvalidity text,
  sent_last_uid bigint,
  -- Beim allerersten Abruf nur so viele der neuesten Mails holen.
  backfill integer not null default 50 check (backfill between 0 and 500),
  signature text not null default '',
  -- { aktion: 'off' | 'suggest' | 'auto' } je Aktion, siehe _shared/email/autopilot.ts
  autopilot jsonb not null default '{}'::jsonb,
  shadow_mode boolean not null default true,
  enabled boolean not null default false,
  -- Postfach-Lock: verhindert, dass zwei Laeufe dasselbe Postfach bearbeiten.
  locked_until timestamptz,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Verlaeufe und Mails
-- ---------------------------------------------------------------------------
create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  root_message_id text,
  subject_norm text not null default '',
  hero_project_match_id integer,
  hero_contact_id integer,
  last_activity_at timestamptz not null default now(),
  answered boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists email_threads_account_idx on public.email_threads (account_id, last_activity_at desc);
create index if not exists email_threads_root_idx on public.email_threads (account_id, root_message_id);

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  thread_id uuid references public.email_threads(id) on delete set null,
  folder text not null,
  uid bigint not null,
  message_id text not null,
  in_reply_to text,
  refs text[] not null default '{}',
  direction text not null check (direction in ('in', 'out')),
  from_addr text not null default '',
  from_name text not null default '',
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  subject text not null default '',
  sent_at timestamptz,
  -- bereinigt (ohne Zitate/Signatur) und auf ca. 6000 Zeichen gekuerzt; nach 180 Tagen geleert
  body_text text,
  -- ausgewaehlte Kopfzeilen (list-unsubscribe, auto-submitted, ...) fuer die Regeln
  headers jsonb not null default '{}'::jsonb,
  has_attachments boolean not null default false,
  status text not null default 'neu'
    check (status in ('neu', 'klassifiziert', 'zugeordnet', 'ohne_bezug', 'erledigt', 'wartet', 'fehler')),
  category text,
  confidence numeric(4, 3),
  summary text,
  extracted jsonb not null default '{}'::jsonb,
  hero_project_match_id integer,
  match_method text check (match_method in ('thread', 'nummer', 'kontakt', 'ki', 'manuell')),
  hero_logged_at timestamptz,
  draft_message_id text,
  current_folder text,
  error text,
  attempts integer not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (account_id, message_id)
);
create index if not exists email_messages_status_idx on public.email_messages (account_id, status);
create index if not exists email_messages_thread_idx on public.email_messages (thread_id);
create index if not exists email_messages_sent_idx on public.email_messages (sent_at desc);
create index if not exists email_messages_hero_idx on public.email_messages (hero_project_match_id);
create index if not exists email_messages_folder_uid_idx on public.email_messages (account_id, folder, uid);

create table if not exists public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.email_messages(id) on delete cascade,
  filename text not null,
  mime text not null default 'application/octet-stream',
  size integer not null default 0,
  -- Privater Bucket `email-attachments`; null, wenn nicht gespeichert (zu gross).
  storage_path text,
  role text check (role in ('logo', 'foto', 'fahrzeugbild', 'skizze', 'druckdaten', 'rechnung', 'sonstiges')),
  -- Signaturbilder, Tracking-Pixel, < 10 KB: nie an HERO.
  is_ignored boolean not null default false,
  hero_file_upload_id text,
  created_at timestamptz not null default now()
);
create index if not exists email_attachments_message_idx on public.email_attachments (message_id);

-- ---------------------------------------------------------------------------
-- Vorschlaege, Regeln, Laeufe, Korrekturen
-- ---------------------------------------------------------------------------
create table if not exists public.email_suggestions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.email_messages(id) on delete cascade,
  type text not null
    check (type in ('create_project', 'link_project', 'log_entry', 'upload_attachments', 'prepare_offer', 'change_step')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'offen' check (status in ('offen', 'angenommen', 'abgelehnt', 'fehlgeschlagen')),
  result jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists email_suggestions_open_idx on public.email_suggestions (status, created_at desc);
create index if not exists email_suggestions_message_idx on public.email_suggestions (message_id);

create table if not exists public.email_rules (
  id uuid primary key default gen_random_uuid(),
  -- Adresse (a@b.de) oder Domain (@b.de)
  pattern text not null unique,
  category text not null,
  target_folder text,
  -- nie aussortieren
  protect boolean not null default false,
  source text not null default 'manuell' check (source in ('manuell', 'gelernt', 'seed')),
  created_at timestamptz not null default now()
);

create table if not exists public.email_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.email_accounts(id) on delete cascade,
  kind text not null default 'sync' check (kind in ('sync', 'process', 'test')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched integer not null default 0,
  processed integer not null default 0,
  errors integer not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  neurons numeric(12, 2) not null default 0,
  note text
);
create index if not exists email_runs_started_idx on public.email_runs (started_at desc);

create table if not exists public.email_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.email_messages(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  -- Absender zum Zeitpunkt der Korrektur (fuer gelernte Regeln)
  from_addr text,
  created_at timestamptz not null default now()
);
create index if not exists email_feedback_created_idx on public.email_feedback (created_at desc);

-- ---------------------------------------------------------------------------
-- KI-Anbieter, Aufgaben, Protokoll
-- ---------------------------------------------------------------------------
create table if not exists public.email_ai_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null check (type in ('cloudflare', 'anthropic', 'openai')),
  base_url text,
  account_id text,
  api_key_enc text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.email_ai_settings (
  task text primary key
    check (task in ('understand', 'pick_project', 'summarize_out', 'draft', 'prepare_offer')),
  provider_id uuid references public.email_ai_providers(id) on delete set null,
  model text not null,
  fallback_provider_id uuid references public.email_ai_providers(id) on delete set null,
  fallback_model text,
  -- Zweiter Anbieter fuer den Parallelvergleich im Schattenmodus
  shadow_provider_id uuid references public.email_ai_providers(id) on delete set null,
  shadow_model text,
  on_limit text not null default 'ausweichen' check (on_limit in ('ausweichen', 'warten')),
  daily_neuron_limit integer not null default 10000
);

create table if not exists public.email_ai_calls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.email_messages(id) on delete set null,
  task text not null,
  provider_id uuid references public.email_ai_providers(id) on delete set null,
  provider_type text,
  model text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  neurons numeric(12, 2) not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  ok boolean not null default true,
  fallback boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists email_ai_calls_created_idx on public.email_ai_calls (created_at desc);

create table if not exists public.email_ai_shadow (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.email_messages(id) on delete cascade,
  task text not null,
  provider_name text,
  model text,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (message_id, task)
);

-- ---------------------------------------------------------------------------
-- Konfiguration und HERO-Zwischenspeicher
-- ---------------------------------------------------------------------------
-- Alles, was NICHT fest im Code stehen darf (Gewerke, HERO-IDs, Firmenwissen,
-- Budget, Lexoffice-Adresse, Preise). Werte sind jsonb.
create table if not exists public.email_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- (Die Tabelle `hero_open_cache` gibt es schon im Projekt – sie gehoert CaptFix/HERO-Skills und wird
-- hier bewusst NICHT angefasst. Der Assistent fragt HERO fuer die Zuordnung gezielt live ab.)

-- Kontakte je E-Mail-Adresse, 24 Stunden gueltig (HERO-Abfrage sparen).
create table if not exists public.hero_contact_cache (
  email text primary key,
  contacts jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Zugriff: nur service_role
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'email_accounts', 'email_threads', 'email_messages', 'email_attachments', 'email_suggestions',
    'email_rules', 'email_runs', 'email_feedback', 'email_ai_providers', 'email_ai_settings',
    'email_ai_calls', 'email_ai_shadow', 'email_config', 'hero_contact_cache'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Privater Bucket fuer Anhaenge (Zugriff nur ueber kurzlebige Signed URLs aus email-api)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('email-attachments', 'email-attachments', false)
on conflict (id) do nothing;
