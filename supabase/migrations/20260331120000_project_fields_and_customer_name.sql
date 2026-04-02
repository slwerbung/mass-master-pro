alter table public.projects add column if not exists customer_name text;
alter table public.projects add column if not exists custom_fields jsonb;

create table if not exists public.project_field_config (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  field_label text not null,
  field_type text not null check (field_type in ('text','textarea','dropdown','checkbox')),
  field_options text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  applies_to text not null default 'all',
  is_required boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.project_field_config enable row level security;

drop policy if exists "Anon read project field config" on public.project_field_config;
drop policy if exists "Anon write project field config" on public.project_field_config;
drop policy if exists "Anon update project field config" on public.project_field_config;
drop policy if exists "Anon delete project field config" on public.project_field_config;

create policy "Anon read project field config" on public.project_field_config for select to anon using (true);
create policy "Anon write project field config" on public.project_field_config for insert to anon with check (true);
create policy "Anon update project field config" on public.project_field_config for update to anon using (true) with check (true);
create policy "Anon delete project field config" on public.project_field_config for delete to anon using (true);

insert into public.project_field_config (field_key, field_label, field_type, sort_order, is_active, applies_to, is_required)
values ('customerName', 'Kunde', 'text', 10, true, 'all', false)
on conflict (field_key) do update set
  field_label = excluded.field_label,
  field_type = excluded.field_type,
  sort_order = excluded.sort_order;
