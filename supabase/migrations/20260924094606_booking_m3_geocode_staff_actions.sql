-- Terminbuchung, Schritt 3: Geocoding-Cache und die beiden internen Aktionen
-- aus der Benachrichtigungsmail ("passt doch nicht" / "loeschen").
--
-- Diese Migration wurde am 24.09.2026 direkt auf der Produktions-Datenbank
-- angewandt; die Datei haelt den Stand fest, damit das Repo die Wahrheit bleibt.
-- Sie ist bewusst idempotent geschrieben.

-- ── Geocoding-Cache ──
-- Adresstext -> Koordinaten. Ein Miss wird mitgespeichert (lat/lng NULL), sonst
-- fragen wir bei jeder Kalenderansicht erneut vergeblich beim Anbieter nach.
create table if not exists public.geocode_cache (
  query      text primary key,
  lat        double precision,
  lng        double precision,
  provider   text not null default 'ors',
  created_at timestamptz not null default now()
);

alter table public.geocode_cache enable row level security;

drop policy if exists geocode_cache_staff_all on public.geocode_cache;
create policy geocode_cache_staff_all on public.geocode_cache
  for all using (is_staff()) with check (is_staff());

-- ── Interne Aktionen am Termin ──
-- Der Termin gilt sofort. Wir bekommen eine Mail und koennen daraus umbuchen
-- oder absagen — dafuer ein eigenes, unerratbares Token pro Buchung. Es haengt
-- nur am Termin, nicht am Konto (so abgestimmt), und ist deshalb unique.
alter table public.booking add column if not exists staff_token text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking'::regclass and conname = 'booking_staff_token_key'
  ) then
    alter table public.booking add constraint booking_staff_token_key unique (staff_token);
  end if;
end $$;

-- Warum wurde abgesagt: vom Kunden selbst, von uns endgueltig, oder von uns
-- mit der Bitte um einen neuen Termin. Der Kunde bekommt je nachdem eine
-- andere Mail, deshalb steht der Grund am Datensatz.
alter table public.booking add column if not exists cancel_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking'::regclass and conname = 'booking_cancel_reason_check'
  ) then
    alter table public.booking add constraint booking_cancel_reason_check
      check (cancel_reason is null
             or cancel_reason in ('customer', 'staff_cancel', 'staff_reschedule'));
  end if;
end $$;
