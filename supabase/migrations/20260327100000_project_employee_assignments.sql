create table if not exists public.project_employee_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, employee_id)
);

alter table public.project_employee_assignments enable row level security;

drop policy if exists "Anon can read project employee assignments" on public.project_employee_assignments;
drop policy if exists "Anon can insert project employee assignments" on public.project_employee_assignments;
drop policy if exists "Anon can delete project employee assignments" on public.project_employee_assignments;

create policy "Anon can read project employee assignments"
on public.project_employee_assignments
for select
to anon
using (true);

create policy "Anon can insert project employee assignments"
on public.project_employee_assignments
for insert
to anon
with check (true);

create policy "Anon can delete project employee assignments"
on public.project_employee_assignments
for delete
to anon
using (true);
