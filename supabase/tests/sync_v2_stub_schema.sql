-- Minimal-Schema, um die Migration sync_v2 lokal (Postgres 16) zu pruefen.
-- Nur fuer Tests: bildet die betroffenen Tabellen der Live-DB nach.
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
create schema storage;
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
create publication supabase_realtime;
create or replace function public.is_staff() returns boolean language sql as $$ select coalesce(current_setting('test.staff', true), 'true')::boolean $$;
create table public.projects (id uuid primary key default gen_random_uuid(), project_number text, user_id uuid not null, employee_id uuid, customer_name text, project_type text, custom_fields jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz, compacted_at timestamptz);
create table public.project_employee_assignments (project_id uuid, employee_id uuid);
create table public.locations (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id), location_number text, location_name text, comment text, system text, label text, location_type text, guest_info text, image_data text, custom_fields jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.location_images (id uuid primary key default gen_random_uuid(), location_id uuid references public.locations(id), image_type text, storage_path text not null, created_at timestamptz not null default now(), unique (location_id, image_type));
create table public.detail_images (id uuid primary key default gen_random_uuid(), location_id uuid references public.locations(id), original_path text not null, annotated_path text not null, caption text, created_at timestamptz not null default now());
create table public.floor_plans (id uuid primary key default gen_random_uuid(), project_id uuid, name text, storage_path text not null, page_index int, markers jsonb not null default '[]', created_at timestamptz not null default now());
create table public.location_pdfs (id uuid primary key default gen_random_uuid(), location_id uuid, storage_path text);
create table public.location_feedback (id uuid primary key default gen_random_uuid(), location_id uuid, media_ref jsonb);
create table public.location_approvals (id uuid primary key default gen_random_uuid(), location_id uuid, approved_paths text[]);
create table public.approval_events (id uuid primary key default gen_random_uuid(), storage_paths text[]);
