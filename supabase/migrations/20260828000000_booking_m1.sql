-- ============================================================================
-- Terminbuchungs-Engine — M1: Datenmodell, Constraints, RLS, Seeds
-- ============================================================================
-- Umsetzung der Spec §4/§6/§7/§12. Bewusste Abweichungen vom Spec-Entwurf,
-- an das bestehende Repo angepasst:
--   * KEINE org_id — die App ist Einzelmandant (bestätigt). Struktur bleibt
--     offen, org_id kann später additiv ergänzt werden.
--   * staff VERWEIST auf die bestehende, minimale employees-Tabelle
--     (employee_id, nullable) statt Identitäten zu duplizieren.
--   * Geo als lat/lng (double precision) statt geography(point) — kein
--     PostGIS-Zwang; die v1-Fahrzeit ist eine Heuristik auf lat/lng.
--   * Öffentliche Buchung läuft (wie alles Betriebsdaten in dieser App) über
--     Edge Functions mit service_role. Daher RLS: Vollzugriff nur für
--     authentifizierte Mitarbeiter via is_staff(); kein anon-Zugriff.
--
-- Diese Migration ist idempotent genug für ein erneutes Anwenden auf einer
-- frischen/Branch-DB, wird aber NICHT automatisch auf Produktion angewandt.
-- ============================================================================

create extension if not exists btree_gist;  -- für den GiST-Exclusion-Constraint

-- Gemeinsamer updated_at-Trigger (scoped Name, kollidiert nicht mit App-Funktionen)
create or replace function public.booking_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── Mitarbeiter (Buchungs-Sicht; verweist auf employees, dupliziert nicht) ──
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  display_name text not null,
  active boolean not null default true,
  google_calendar_id text,           -- gilt als belegt & wird beschrieben
  hero_employee_ref text,            -- Referenz auf Hero-Mitarbeiter/Ressource
  home_base_lat double precision,    -- Ausgangspunkt für Fahrzeit (nullable)
  home_base_lng double precision,
  skills text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger staff_touch before update on public.staff
  for each row execute function public.booking_touch_updated_at();

-- ── Arbeitszeiten (Wochenraster) + Ausnahmen (Urlaub/Sondertag) ─────────────
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),   -- 0 = Sonntag
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index working_hours_staff_idx on public.working_hours (staff_id, weekday);

create table public.working_hours_exception (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  date date not null,
  is_available boolean not null,          -- false = frei, true = zusätzlich verfügbar
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  check (start_time is null or end_time is null or end_time > start_time)
);
create index working_hours_exception_staff_idx on public.working_hours_exception (staff_id, date);

-- ── Terminkategorien + Relevanz-Schalter (§7: beides) ──────────────────────
create table public.appointment_category (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  source text not null check (source in ('google','hero','internal')),
  blocks_availability boolean not null default true,   -- zählt als belegt?
  is_bookable boolean not null default false,          -- darf das Tool ihn erzeugen?
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger appointment_category_touch before update on public.appointment_category
  for each row execute function public.booking_touch_updated_at();

-- ── Regelset = Terminart ───────────────────────────────────────────────────
create table public.rule_set (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  active boolean not null default true,
  category_id uuid references public.appointment_category(id),
  duration_minutes int not null check (duration_minutes > 0),
  duration_options int[],
  buffer_before_min int not null default 0 check (buffer_before_min >= 0),
  buffer_after_min int not null default 0 check (buffer_after_min >= 0),
  travel_buffer boolean not null default true,
  min_notice_min int not null default 120 check (min_notice_min >= 0),
  booking_window_days int not null default 60 check (booking_window_days > 0),
  slot_granularity_min int not null default 30 check (slot_granularity_min > 0),
  max_per_day_global int check (max_per_day_global is null or max_per_day_global >= 0),
  max_per_day_per_staff int check (max_per_day_per_staff is null or max_per_day_per_staff >= 0),
  assignment_mode text not null default 'round_robin'
     check (assignment_mode in ('fixed','round_robin','collective','by_skill')),
  required_skills text[] not null default '{}',
  requires_approval boolean not null default false,
  auto_confirm boolean not null default true,
  form_fields jsonb not null default '[]',
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger rule_set_touch before update on public.rule_set
  for each row execute function public.booking_touch_updated_at();

-- welche Mitarbeiter ein Regelset bedienen (falls nicht rein über skills)
create table public.rule_set_staff (
  rule_set_id uuid not null references public.rule_set(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  primary key (rule_set_id, staff_id)
);

-- ── gespiegelte Belegung aus allen Quellen (einzige Quelle für die Engine) ──
create table public.busy_block (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null check (source in ('google','hero','booking')),
  source_ref text,                        -- externe Event-ID (Idempotenz)
  category_key text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index busy_block_lookup_idx on public.busy_block (staff_id, starts_at, ends_at);
create unique index busy_block_source_ref_uidx on public.busy_block (source, source_ref) where source_ref is not null;

-- ── Buchungen ──────────────────────────────────────────────────────────────
create table public.booking (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.rule_set(id),
  staff_id uuid not null references public.staff(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed'
     check (status in ('pending','confirmed','cancelled','rescheduled')),
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  address text,
  address_lat double precision,
  address_lng double precision,
  answers jsonb not null default '{}',
  google_event_id text,
  hero_event_ref text,
  reschedule_token text unique,
  cancel_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index booking_active_idx on public.booking (staff_id, starts_at, ends_at)
  where status in ('pending','confirmed');
create trigger booking_touch before update on public.booking
  for each row execute function public.booking_touch_updated_at();

-- Nebenläufigkeits-Schutz gegen Doppelbuchung (§12): letzte Wahrheit in der DB.
-- Kein zwei aktive Termine für denselben MA dürfen sich überlappen.
alter table public.booking add constraint booking_no_overlap
  exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('pending','confirmed'));

-- ── Ausgehende Benachrichtigungen (Outbox-Pattern, idempotent) ─────────────
create table public.notification (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.booking(id) on delete cascade,
  kind text not null check (kind in ('confirmation','reminder','reschedule','cancellation','internal_new')),
  channel text not null default 'email',
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
create index notification_due_idx on public.notification (send_after) where sent_at is null;

-- ============================================================================
-- RLS (§12): Vollzugriff nur für authentifizierte Mitarbeiter (is_staff()).
-- Kein anon-Zugriff. Öffentliche Buchung läuft über Edge Functions
-- (service_role, umgeht RLS) — analog zu customer-data/admin-manage.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'staff','working_hours','working_hours_exception','appointment_category',
    'rule_set','rule_set_staff','busy_block','booking','notification'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format($p$create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff());$p$,
                   t || '_staff_all', t);
  end loop;
end $$;

-- ============================================================================
-- Seeds (§6): zwei Kategorien + zwei Regelsets. Werte justierbar.
-- ============================================================================
insert into public.appointment_category (key, label, source, blocks_availability, is_bookable) values
  ('montage',       'Montage vor Ort',      'internal', true, true),
  ('kundentermin',  'Kundentermin vor Ort', 'internal', true, true)
on conflict (key) do nothing;

insert into public.rule_set (
  key, label, category_id, duration_minutes, duration_options,
  buffer_after_min, travel_buffer, assignment_mode, required_skills,
  requires_approval, auto_confirm, min_notice_min, booking_window_days,
  slot_granularity_min, form_fields
) values
  (
    'montage_vor_ort', 'Montage vor Ort',
    (select id from public.appointment_category where key = 'montage'),
    480, array[240, 480],
    30, true, 'by_skill', array['montage'],
    true, false, 1440, 60,
    30,
    '[{"key":"address","label":"Adresse","type":"address","required":true},
      {"key":"auftragsart","label":"Auftragsart","type":"text","required":true}]'::jsonb
  ),
  (
    'kundentermin_vor_ort', 'Kundentermin vor Ort',
    (select id from public.appointment_category where key = 'kundentermin'),
    60, null,
    15, true, 'round_robin', '{}',
    false, true, 180, 60,
    30,
    '[{"key":"address","label":"Adresse","type":"address","required":true},
      {"key":"anliegen","label":"Anliegen","type":"textarea","required":false}]'::jsonb
  )
on conflict (key) do nothing;
