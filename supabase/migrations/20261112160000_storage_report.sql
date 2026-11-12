-- Spec E: Speicherübersicht und verwaiste Dateien (nur service_role, Aufruf aus admin-manage / archive-compact).

-- Alle Objekte im Bucket project-files mit Größe und – wo ableitbar – Projekt.
create or replace function public.storage_objects_report()
returns table(name text, size bigint, created_at timestamptz, project_id uuid)
language sql stable security definer set search_path = public, storage as $$
  with o as (
    select so.name, coalesce((so.metadata->>'size')::bigint, 0) as size, so.created_at,
           split_part(so.name, '/', 1) as top, split_part(so.name, '/', 2) as seg2
    from storage.objects so where so.bucket_id = 'project-files'
  )
  select o.name, o.size, o.created_at,
    coalesce(
      -- Projekt-Ordner: <ordner>/<projectId>/...
      case when o.top in ('vehicle-images','vehicle-measured','vehicle-measured-images','vehicle-layouts','floor-plans','meeting-audio','layouts','customer-uploads','design-briefings')
             and o.seg2 ~ '^[0-9a-f-]{36}$' then (select p.id from public.projects p where p.id = o.seg2::uuid) end,
      -- Standort-Ordner: <ordner>/<locationId>/...
      case when o.top in ('images','pdfs','detail-images') and o.seg2 ~ '^[0-9a-f-]{36}$'
           then (select l.project_id from public.locations l where l.id = o.seg2::uuid) end
    ) as project_id
  from o;
$$;
revoke all on function public.storage_objects_report() from public, anon, authenticated;
grant execute on function public.storage_objects_report() to service_role;

-- Verwaiste Dateien: in keiner Pfad-Spalte referenziert und älter als 7 Tage.
-- Ausnahmen (nie verwaist): images/<Standort>/annotated|original, solange der Standort existiert – die App lädt diese
-- über den festen Pfad (supabaseSync getLocationImagePath), nicht über location_images; meeting-audio (behandelt das
-- Komprimieren nach Transkript).
create or replace function public.storage_orphans()
returns table(name text, size bigint, created_at timestamptz, folder text)
language sql stable security definer set search_path = public, storage as $$
  with refs as (
    select storage_path p from public.location_images
    union select annotated_path from public.detail_images union select original_path from public.detail_images
    union select storage_path from public.vehicle_images
    union select storage_path from public.vehicle_measured_images union select original_storage_path from public.vehicle_measured_images
    union select storage_path from public.location_pdfs
    union select storage_path from public.vehicle_layouts
    union select storage_path from public.project_layouts
    union select storage_path from public.floor_plans
    union select storage_path from public.customer_uploads
    union select jsonb_array_elements_text(case when jsonb_typeof(inspiration_paths::jsonb) = 'array' then inspiration_paths::jsonb else '[]'::jsonb end)
      from public.vehicle_design_briefings
  )
  select so.name, coalesce((so.metadata->>'size')::bigint, 0), so.created_at, split_part(so.name, '/', 1)
  from storage.objects so
  where so.bucket_id = 'project-files'
    and so.created_at < now() - interval '7 days'
    and split_part(so.name, '/', 1) <> 'meeting-audio'
    and not exists (select 1 from refs where refs.p = so.name)
    and not (
      so.name ~ '^images/[0-9a-f-]{36}/(annotated|original)$'
      and exists (select 1 from public.locations l where l.id = split_part(so.name, '/', 2)::uuid)
    );
$$;
revoke all on function public.storage_orphans() from public, anon, authenticated;
grant execute on function public.storage_orphans() to service_role;
