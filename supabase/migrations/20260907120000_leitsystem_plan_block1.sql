-- Leitsystem / "Aufmass mit Plan" – Block 1 (Prototyp)
--
-- Ausgangslage: der Projekttyp `aufmass_mit_plan` kennt heute nur Standorte
-- als Unikate. Fuer ein Gebaeudeleitsystem mit 100-300 Beschilderungspunkten
-- und einer ueberschaubaren Zahl wiederkehrender Schildtypen laesst sich
-- daraus weder Stueckliste noch Bestellung noch LV erzeugen.
--
-- Diese Migration ist rein ADDITIV. Sie fasst keine bestehende Tabelle an:
--   * `floor_plans.markers` (jsonb) bleibt unveraendert stehen und wird vom
--     neuen Modul weder gelesen noch geschrieben. Marker leben ab jetzt in
--     `sign_plan_markers`.
--   * die Zuordnung Grundriss -> Geschoss liegt in der eigenen Tabelle
--     `sign_floor_plan_links` statt als neue Spalte auf `floor_plans`,
--     damit der bestehende Grundriss-Sync unangetastet bleibt.
--   * `locations` bekommt keine Fremdschluessel. Eine Position KANN auf einen
--     Standort zeigen (`sign_positions.location_id`), muss aber nicht.
--
-- RLS folgt dem bestehenden Muster: `is_staff()` = Vollzugriff auf
-- Betriebsdaten, `has_customer_project()` = der Kunde sieht lesend nur seine
-- zugewiesenen Projekte. Alle Tabellen bekommen explizite Grants, weil die
-- Data-API-Umstellung zum 30.10.2026 sich nicht mehr auf Default-Privileges
-- verlassen darf. `anon` bekommt nirgends etwas.

-- ─── 1. Gebaeude und Geschosse ──────────────────────────────────────────────

create table if not exists public.sign_buildings (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists sign_buildings_project_idx on public.sign_buildings(project_id);

create table if not exists public.sign_floors (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  building_id  uuid references public.sign_buildings(id) on delete cascade,
  name         text not null,
  -- Kuerzel fuer die Positionsnummer, z.B. "EG", "1OG", "UG".
  code         text not null default '',
  -- Sortierung von unten nach oben (UG = -1, EG = 0, 1.OG = 1 ...).
  level        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sign_floors_project_idx  on public.sign_floors(project_id);
create index if not exists sign_floors_building_idx on public.sign_floors(building_id);

-- Grundriss <-> Geschoss. Eigene Tabelle statt Spalte auf floor_plans, damit
-- der bestehende Grundriss-Sync nicht angefasst werden muss.
create table if not exists public.sign_floor_plan_links (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  floor_plan_id uuid not null,
  floor_id      uuid not null references public.sign_floors(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (floor_plan_id)
);
create index if not exists sign_floor_plan_links_project_idx on public.sign_floor_plan_links(project_id);

-- ─── 2. Schildtypen ─────────────────────────────────────────────────────────
--
-- Hersteller, Artikelnummer und der fabrikatsneutrale Beschreibungstext
-- liegen bewusst DIREKT am Typ. Ein spaeterer Herstellerkatalog fuellt genau
-- diese Felder, ohne dass hier umgebaut werden muss.

create table if not exists public.sign_types (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  code                text not null,
  name                text not null default '',
  width_mm            integer,
  height_mm           integer,
  material            text,
  mounting            text,
  unit_price          numeric(12,2),
  description_neutral text,
  manufacturer        text,
  article_number      text,
  -- Markerfarbe im Plan (#rrggbb). Legende und Marker ziehen sie hier heraus.
  color               text not null default '#2563eb',
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists sign_types_project_idx on public.sign_types(project_id);
create unique index if not exists sign_types_project_code_key
  on public.sign_types(project_id, code);

-- ─── 3. Positionen ──────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'sign_position_status') then
    create type public.sign_position_status as enum (
      'geplant', 'freigegeben', 'bestellt', 'produziert', 'montiert', 'abgenommen', 'entfallen'
    );
  end if;
end $$;

create table if not exists public.sign_positions (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  floor_id        uuid references public.sign_floors(id) on delete set null,
  -- Die ID, auf die sich Plan, Liste, Produktion, Monteur und Kunde beziehen.
  position_number text not null,
  title           text,
  status          public.sign_position_status not null default 'geplant',
  -- Nachtraege sind in der Stueckliste separat ausweisbar.
  is_addition     boolean not null default false,
  note            text,
  -- Optionale Bruecke in die bestehende Standorterfassung (Foto/Kommentar).
  location_id     uuid references public.locations(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists sign_positions_project_idx  on public.sign_positions(project_id);
create index if not exists sign_positions_floor_idx    on public.sign_positions(floor_id);
create index if not exists sign_positions_location_idx on public.sign_positions(location_id);

-- Eindeutig je Projekt. DEFERRABLE, weil das Neunummerieren ganze Bloecke in
-- einem Rutsch schreibt und dabei zwischenzeitlich zwei Positionen dieselbe
-- Nummer tragen koennen – geprueft wird erst am Transaktionsende.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sign_positions_project_number_key'
  ) then
    alter table public.sign_positions
      add constraint sign_positions_project_number_key
      unique (project_id, position_number) deferrable initially deferred;
  end if;
end $$;

-- n:m zwischen Position und Typ MIT Menge. Bewusst kein Fremdschluessel auf
-- der Position: an einem Standort haengen regelmaessig zwei Schilder.
create table if not exists public.sign_position_types (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  position_id  uuid not null references public.sign_positions(id) on delete cascade,
  sign_type_id uuid not null references public.sign_types(id) on delete cascade,
  quantity     integer not null default 1 check (quantity > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (position_id, sign_type_id)
);
create index if not exists sign_position_types_project_idx  on public.sign_position_types(project_id);
create index if not exists sign_position_types_position_idx on public.sign_position_types(position_id);
create index if not exists sign_position_types_type_idx     on public.sign_position_types(sign_type_id);

-- ─── 4. Planmarker ──────────────────────────────────────────────────────────
--
-- Koordinaten relativ (0..1), damit Zoomstufe und Planformat egal sind.

create table if not exists public.sign_plan_markers (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  floor_plan_id uuid not null,
  position_id   uuid not null references public.sign_positions(id) on delete cascade,
  x             numeric(8,6) not null check (x >= 0 and x <= 1),
  y             numeric(8,6) not null check (y >= 0 and y <= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sign_plan_markers_project_idx  on public.sign_plan_markers(project_id);
create index if not exists sign_plan_markers_plan_idx     on public.sign_plan_markers(floor_plan_id);
create index if not exists sign_plan_markers_position_idx on public.sign_plan_markers(position_id);

-- ─── 5. Zielverzeichnis und Beschriftungszeilen ─────────────────────────────
--
-- Jede Raumbezeichnung existiert projektweit einmal. Umbenennen wirkt auf
-- allen Schildern, die darauf verweisen – deshalb der Verweis per ID und
-- nicht per Text. `text_override` ist die dokumentierte Ausnahme.

create table if not exists public.sign_destinations (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  name           text not null,
  name_secondary text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sign_destinations_project_idx on public.sign_destinations(project_id);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'sign_arrow_direction') then
    create type public.sign_arrow_direction as enum (
      'none', 'up', 'down', 'left', 'right', 'up_left', 'up_right', 'down_left', 'down_right'
    );
  end if;
end $$;

create table if not exists public.sign_label_lines (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  -- Die Beschriftung haengt am Schild, nicht an der Position: an einer
  -- Position koennen zwei Typen mit unterschiedlichem Inhalt sitzen.
  position_type_id uuid not null references public.sign_position_types(id) on delete cascade,
  sort_order       integer not null default 0,
  destination_id   uuid references public.sign_destinations(id) on delete set null,
  text_override    text,
  text_secondary   text,
  arrow            public.sign_arrow_direction not null default 'none',
  pictogram        text,
  is_tactile       boolean not null default false,
  is_braille       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists sign_label_lines_project_idx     on public.sign_label_lines(project_id);
create index if not exists sign_label_lines_positiontype_idx on public.sign_label_lines(position_type_id);
create index if not exists sign_label_lines_destination_idx  on public.sign_label_lines(destination_id);

-- ─── 6. QR-Token ────────────────────────────────────────────────────────────
--
-- Wird im Prototyp nur angelegt, nicht aufgeloest. Der spaetere Wartungs-
-- Zugriff haengt sich an diesen Token, ohne dass Positionen umgebaut werden.

create table if not exists public.sign_qr_tokens (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  position_id uuid not null references public.sign_positions(id) on delete cascade,
  token       text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists sign_qr_tokens_project_idx on public.sign_qr_tokens(project_id);
create unique index if not exists sign_qr_tokens_position_key on public.sign_qr_tokens(position_id);

-- ─── 7. RLS + Grants ────────────────────────────────────────────────────────
--
-- Mitarbeiter: Vollzugriff ueber is_staff(). Kunde: nur lesend und nur auf
-- seine zugewiesenen Projekte. anon: nichts.

do $$
declare
  t text;
  tables text[] := array[
    'sign_buildings',
    'sign_floors',
    'sign_floor_plan_links',
    'sign_types',
    'sign_positions',
    'sign_position_types',
    'sign_plan_markers',
    'sign_destinations',
    'sign_label_lines',
    'sign_qr_tokens'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Mitarbeiter Vollzugriff" on public.%I', t);
    execute format(
      'create policy "Mitarbeiter Vollzugriff" on public.%I for all to authenticated '
      || 'using (public.is_staff()) with check (public.is_staff())', t);

    execute format('drop policy if exists "Kunde liest Projektdaten" on public.%I', t);
    execute format(
      'create policy "Kunde liest Projektdaten" on public.%I for select to authenticated '
      || 'using (public.has_customer_project(project_id))', t);

    -- Explizite Grants: nach der Data-API-Umstellung zum 30.10.2026 traegt
    -- kein Default-Privilege mehr. anon bekommt bewusst nichts.
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ─── 8. Auswertungs-Views ───────────────────────────────────────────────────
--
-- security_invoker: die Views rechnen mit den Rechten des Aufrufers, damit
-- die RLS der Basistabellen greift und ein Kunde nicht ueber die View
-- fremde Projekte sieht.

drop view if exists public.sign_bill_of_quantities;
create view public.sign_bill_of_quantities
with (security_invoker = true) as
select
  p.project_id,
  t.id                                        as sign_type_id,
  t.code,
  t.name,
  t.width_mm,
  t.height_mm,
  t.material,
  t.mounting,
  t.manufacturer,
  t.article_number,
  t.unit_price,
  p.is_addition,
  sum(pt.quantity)::integer                   as quantity,
  -- Flaeche in m2 je Zeile: Breite * Hoehe * Menge.
  round(sum(pt.quantity * coalesce(t.width_mm, 0)::numeric
                        * coalesce(t.height_mm, 0)::numeric) / 1000000.0, 3) as area_sqm,
  round(sum(pt.quantity) * coalesce(t.unit_price, 0), 2)                     as total_price
from public.sign_position_types pt
join public.sign_positions p on p.id = pt.position_id
join public.sign_types     t on t.id = pt.sign_type_id
where p.status <> 'entfallen'
group by p.project_id, t.id, t.code, t.name, t.width_mm, t.height_mm, t.material,
         t.mounting, t.manufacturer, t.article_number, t.unit_price, p.is_addition;

drop view if exists public.sign_position_overview;
create view public.sign_position_overview
with (security_invoker = true) as
select
  p.id            as position_id,
  p.project_id,
  p.position_number,
  p.title,
  p.status,
  p.is_addition,
  p.location_id,
  b.name          as building_name,
  f.name          as floor_name,
  f.code          as floor_code,
  f.level         as floor_level,
  coalesce(sum(pt.quantity), 0)::integer as sign_count,
  string_agg(distinct t.code, ', ' order by t.code) as type_codes
from public.sign_positions p
left join public.sign_floors        f  on f.id = p.floor_id
left join public.sign_buildings     b  on b.id = f.building_id
left join public.sign_position_types pt on pt.position_id = p.id
left join public.sign_types          t  on t.id = pt.sign_type_id
group by p.id, p.project_id, p.position_number, p.title, p.status, p.is_addition,
         p.location_id, b.name, f.name, f.code, f.level;

revoke all on public.sign_bill_of_quantities from anon;
revoke all on public.sign_position_overview  from anon;
grant select on public.sign_bill_of_quantities to authenticated, service_role;
grant select on public.sign_position_overview  to authenticated, service_role;
