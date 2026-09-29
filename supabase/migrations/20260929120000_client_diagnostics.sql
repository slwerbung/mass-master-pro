-- Diagnose-Protokoll vom Handy.
--
-- Anlass: Nach dem Bestaetigen eines Fotos in der Geraete-Kamera laedt die App
-- auf Android gelegentlich neu (auch bei leeren Projekten, beim zweiten Versuch
-- klappt es). Unklar ist, ob Android die App WAEHREND der Kamera beendet (dann
-- ist das Foto verloren, bevor die App es sieht) oder ob die App NACH der
-- Rueckkehr beim Verarbeiten des Fotos abstuerzt (dann waere es behebbar).
-- src/lib/cameraGuard.ts schreibt dazu, wie weit ein Kamera-Vorgang kam.
--
-- Nur Mitarbeiter duerfen schreiben (Anon-Key bleibt draussen), lesen nur
-- Mitarbeiter. Eintraege sind klein und werden nach 60 Tagen geloescht.

create table if not exists public.client_diagnostics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (char_length(kind) <= 40),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 8192),
  user_agent text check (char_length(user_agent) <= 400),
  user_id uuid default auth.uid()
);

create index if not exists client_diagnostics_created_at_idx
  on public.client_diagnostics (created_at);

alter table public.client_diagnostics enable row level security;

drop policy if exists client_diagnostics_insert_staff on public.client_diagnostics;
create policy client_diagnostics_insert_staff on public.client_diagnostics
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists client_diagnostics_select_staff on public.client_diagnostics;
create policy client_diagnostics_select_staff on public.client_diagnostics
  for select to authenticated
  using (public.is_staff());

revoke all on public.client_diagnostics from anon;
grant select, insert on public.client_diagnostics to authenticated;

do $$
begin
  perform cron.unschedule('client_diagnostics_retention');
exception when others then null;
end $$;

select cron.schedule(
  'client_diagnostics_retention',
  '25 3 * * *',
  $cron$
    delete from public.client_diagnostics
    where created_at < now() - interval '60 days';
  $cron$
);
