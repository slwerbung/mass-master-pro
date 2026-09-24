-- ============================================================================
-- Terminbuchung — Ausbau: Projektbezug, Fahrzeit-Cache, Feiertage, Einstellungen
-- ============================================================================
-- Ergaenzt M1 um die Entscheidungen aus der Abstimmung:
--   * Buchungen haengen an EINEM Projekt (projektbezogener Buchungslink,
--     HERO-Termin am project_match). Ohne Projektbezug gibt es keine Buchung.
--   * Echtes Routing statt Schaetzung -> Fahrzeiten werden gecacht, weil eine
--     einzige Slot-Berechnung dasselbe Punktpaar sehr oft abfragt.
--   * Feiertage kommen aus einer oeffentlichen Quelle pro Bundesland und Jahr
--     und sind danach normal bearbeitbar.
-- ============================================================================

-- ── Buchung haengt am Projekt ───────────────────────────────────────────────
alter table public.booking
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  -- HERO-Projekt (project_match_id) getrennt gespeichert: die Buchung soll auch
  -- lesbar bleiben, wenn das lokale Projekt spaeter geloescht wird.
  add column if not exists hero_project_id bigint,
  -- Woher kam die Adresse? Fuer die interne Mail und zum Nachvollziehen.
  add column if not exists address_source text
    check (address_source is null or address_source in ('project','customer','manual')),
  -- Freitext des Kunden zu Korrekturen an Kontaktdaten. Bewusst NUR hier und
  -- nicht in HERO: eine Buchung darf Stammdaten nicht still ueberschreiben.
  add column if not exists contact_overrides jsonb not null default '{}';

create index if not exists booking_project_idx on public.booking (project_id);

-- ── Fahrzeit-Cache ──────────────────────────────────────────────────────────
-- Schluessel ist "lat,lng>lat,lng" auf 4 Dezimalstellen (~11 m). Richtungs-
-- abhaengig, weil Einbahnstrassen und Auffahrten das real auch sind.
create table if not exists public.travel_time_cache (
  cache_key text primary key,
  minutes int not null check (minutes >= 0),
  provider text not null default 'ors',
  created_at timestamptz not null default now()
);
-- Fahrzeiten aendern sich (Baustellen, neue Umgehung). Eintraege aelter als
-- 90 Tage werden vom Aufrufer ignoriert, statt hier automatisch zu loeschen.
create index if not exists travel_time_cache_age_idx on public.travel_time_cache (created_at);

-- ── Feiertage ───────────────────────────────────────────────────────────────
-- Gilt betriebsweit, nicht pro Mitarbeiter: ein Feiertag ist kein Urlaub.
-- Die Engine liest sie zusaetzlich zu working_hours_exception.
create table if not exists public.public_holiday (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  name text not null,
  state_code text not null,                -- z.B. 'BW'
  -- importiert = aus der oeffentlichen Quelle, manual = selbst eingetragen.
  -- Ein Reimport darf manuelle Eintraege nicht anfassen.
  origin text not null default 'imported' check (origin in ('imported','manual')),
  -- Betriebsurlaub o.ae. laesst sich hier abschalten, ohne die Zeile zu loeschen:
  -- ein Reimport wuerde sie sonst wieder anlegen.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (date, state_code)
);
create index if not exists public_holiday_date_idx on public.public_holiday (date) where active;

-- ── Einstellungen ───────────────────────────────────────────────────────────
-- Bewusst in app_config (bestehendes Muster), nicht in einer neuen Tabelle.
-- Der Routing-Schluessel gehoert NICHT hierher, sondern in die Supabase
-- Secrets (ORS_API_KEY) — app_config ist fuer Admins lesbar.
insert into public.app_config (key, value) values
  ('booking_travel_mode',      'heuristic'),
  ('booking_travel_avg_kmh',   '50'),
  ('booking_travel_detour',    '1.4'),
  ('booking_travel_overhead',  '5'),
  ('booking_travel_max_min',   '45'),
  ('booking_holiday_state',    'BW'),
  ('booking_notify_internal',  'info@slwerbung.de'),
  ('booking_reminder_hours',   '24'),
  ('booking_hero_write',       'true'),
  ('booking_hero_read',        'true'),
  ('booking_hero_category_id', '')
on conflict (key) do nothing;

-- ── RLS fuer die neuen Tabellen ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['travel_time_cache','public_holiday'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_staff_all') then
      execute format($p$create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff());$p$,
                     t || '_staff_all', t);
    end if;
  end loop;
end $$;

-- ── Terminart "Aufmass vor Ort" ─────────────────────────────────────────────
-- Die eigentliche Art, um die es hier geht; die M1-Seeds waren Platzhalter.
insert into public.appointment_category (key, label, source, blocks_availability, is_bookable)
values ('aufmass', 'Aufmass vor Ort', 'internal', true, true)
on conflict (key) do nothing;

insert into public.rule_set (
  key, label, category_id, duration_minutes,
  buffer_before_min, buffer_after_min, travel_buffer,
  assignment_mode, required_skills,
  requires_approval, auto_confirm,
  min_notice_min, booking_window_days, slot_granularity_min,
  max_per_day_per_staff, form_fields
) values (
  'aufmass_vor_ort', 'Aufmass vor Ort',
  (select id from public.appointment_category where key = 'aufmass'),
  90,
  15, 30, true,
  'by_skill', array['aufmass'],
  -- Ohne Freigabe: der Termin steht sofort, die Kontrolle sitzt in der
  -- internen Mail (umbuchen / absagen).
  false, true,
  1440, 60, 15,
  3,
  '[{"key":"hinweis","label":"Hinweis für uns","type":"textarea","required":false}]'::jsonb
)
on conflict (key) do nothing;
