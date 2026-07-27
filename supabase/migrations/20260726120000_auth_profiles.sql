-- Phase 1a: Supabase Auth vorbereiten.
--
-- Grundsatz: Der bestehende employees-Datensatz bleibt unangetastet. Alle
-- Fremdschlüssel (projects.employee_id, project_employee_assignments, …) zeigen
-- weiterhin auf employees.id. Die Verbindung zum Auth-Account entsteht
-- ausschliesslich über profiles.employee_id — es wird nichts umgehängt.
--
-- Der Login bleibt für den Nutzer unverändert (Name wählen + Passwort). Die
-- E-Mail ist reine Technik: sie identifiziert den Auth-Account, wird aber nie
-- eingegeben. Deshalb liegt sie in auth.users und nicht im Frontend.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'mitarbeiter' check (role in ('admin','mitarbeiter')),
  employee_id uuid references public.employees(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Ein employees-Datensatz darf höchstens einen Auth-Account haben.
create unique index if not exists profiles_employee_id_key
  on public.profiles(employee_id) where employee_id is not null;

alter table public.profiles enable row level security;

-- security definer, damit Policies die Rolle lesen können, ohne sich selbst
-- rekursiv über die profiles-Policy zu prüfen.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$ select role from public.profiles where id = auth.uid() and is_active $$;

revoke all on function public.current_role() from public, anon;
grant execute on function public.current_role() to authenticated, service_role;

-- Praktischer Helfer für die Policies der Betriebsdaten in Phase 2.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and is_active) $$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

-- Eigenes Profil lesen; Admin sieht alle. Schreiben ausschliesslich über
-- service_role (admin-manage), damit niemand seine eigene Rolle hochsetzen kann.
drop policy if exists "profil lesen" on public.profiles;
create policy "profil lesen" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_role() = 'admin');

grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
-- bewusst kein Grant für anon
