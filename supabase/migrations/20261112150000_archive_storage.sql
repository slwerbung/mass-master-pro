-- Spec E: Archiv & Speicher. Einstellbares Archivieren, Komprimieren archivierter Projekte (Function archive-compact),
-- Kundenzugriff auf archivierte Projekte, Protokoll. Es wird NIE automatisch ein ganzes Projekt geloescht.

alter table public.projects
  add column if not exists archive_pinned boolean not null default false,   -- „nie automatisch archivieren“
  add column if not exists compacted_at timestamptz,
  add column if not exists print_files_purged_at timestamptz,
  add column if not exists archived_by text;                                -- 'auto' | 'hero' | Name

create table if not exists public.storage_compaction_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  storage_path text not null,
  action text not null check (action in ('resize','delete_original','delete_version','delete_audio','delete_print','delete_orphan','error')),
  bytes_before bigint,
  bytes_after bigint,
  dry_run boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists storage_compaction_log_project_idx on public.storage_compaction_log(project_id);
create index if not exists storage_compaction_log_created_idx on public.storage_compaction_log(created_at desc);
alter table public.storage_compaction_log enable row level security;
revoke all on public.storage_compaction_log from anon, authenticated;
grant select, insert, update, delete on public.storage_compaction_log to service_role;
-- keine Policy, kein Grant fuer anon/authenticated: nur ueber admin-manage lesbar

-- Einstellungen (app_config.archive_settings, JSON-Text) mit Standardwerten.
create or replace function public.archive_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'autoArchiveDays', 90, 'archiveWhenHeroDone', false, 'warnDaysBefore', 7, 'customerAccessArchived', 'readonly',
    'compactAfterDays', 180, 'imageMaxPx', 2000, 'imageQuality', 75, 'keepOriginalPhotos', true,
    'purgeSupersededVersions', true, 'deleteMeetingAudio', true, 'deletePrintFilesAfterDays', 0
  ) || coalesce((
    select case when value ~ '^\s*\{' then value::jsonb else '{}'::jsonb end from public.app_config where key = 'archive_settings'
  ), '{}'::jsonb);
$$;
revoke all on function public.archive_settings() from public, anon;
grant execute on function public.archive_settings() to authenticated;

-- Aktivitaet: zusaetzlich Dateiversionen und Freigabe-Ereignisse (D1). locations.updated_at NICHT (beruehrt der Sync).
create or replace function public.project_last_activity(p_id uuid, p_created timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select greatest(
    p_created,
    coalesce((select max(l.created_at) from public.locations l where l.project_id = p_id), p_created),
    coalesce((select max(lf.created_at) from public.location_feedback lf join public.locations l2 on l2.id = lf.location_id where l2.project_id = p_id), p_created),
    coalesce((select max(la.approved_at) from public.location_approvals la join public.locations l3 on l3.id = la.location_id where l3.project_id = p_id and la.approved_at is not null), p_created),
    coalesce((select max(vf.created_at) from public.vehicle_layout_feedback vf where vf.project_id = p_id), p_created),
    coalesce((select max(va.approved_at) from public.vehicle_layout_approval va where va.project_id = p_id and va.approved_at is not null), p_created),
    coalesce((select max(lp.uploaded_at) from public.location_pdfs lp join public.locations l4 on l4.id = lp.location_id where l4.project_id = p_id), p_created),
    coalesce((select max(vl.uploaded_at) from public.vehicle_layouts vl where vl.project_id = p_id), p_created),
    coalesce((select max(ae.created_at) from public.approval_events ae where ae.project_id = p_id), p_created)
  );
$$;

-- Fuer die Projektliste (Warnung „wird in n Tagen archiviert“): security invoker, RLS greift.
create or replace function public.projects_with_activity()
returns table(id uuid, last_activity_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select p.id, public.project_last_activity(p.id, p.created_at) from public.projects p where p.archived_at is null;
$$;
grant execute on function public.projects_with_activity() to authenticated;

-- Automatisch archivieren (Cron 03:00 UTC). Gibt die Anzahl zurueck.
create or replace function public.run_auto_archive() returns integer
language plpgsql security definer set search_path = public as $$
declare
  s jsonb := public.archive_settings();
  days int := coalesce((s->>'autoArchiveDays')::int, 90);
  n int := 0;
  m int := 0;
  open_ids text[];
  cache_ok boolean;
begin
  if days > 0 then
    update public.projects p set archived_at = now(), archived_by = 'auto'
    where p.archived_at is null and not p.archive_pinned
      and public.project_last_activity(p.id, p.created_at) < now() - make_interval(days => days);
    get diagnostics n = row_count;
  end if;
  -- HERO-Projekt abgeschlossen: verknuepft, nicht mehr unter den offenen HERO-Projekten (hero_open_cache), 14 Tage inaktiv.
  if coalesce((s->>'archiveWhenHeroDone')::boolean, false) then
    select array_agg(e->>'id'), bool_or(true) and max(c.updated_at) > now() - interval '1 day'
      into open_ids, cache_ok
    from public.hero_open_cache c, jsonb_array_elements(case when jsonb_typeof(c.data) = 'array' then c.data else '[]'::jsonb end) e;
    if coalesce(cache_ok, false) and coalesce(array_length(open_ids, 1), 0) > 0 then
      update public.projects p set archived_at = now(), archived_by = 'hero'
      where p.archived_at is null and not p.archive_pinned
        and coalesce(p.custom_fields->>'__hero_project_id', '') ~ '^[0-9]+$'
        and not ((p.custom_fields->>'__hero_project_id') = any(open_ids))
        and public.project_last_activity(p.id, p.created_at) < now() - interval '14 days';
      get diagnostics m = row_count;
    end if;
  end if;
  return n + m;
end;
$$;
revoke all on function public.run_auto_archive() from public, anon, authenticated;

-- Kundenzugriff auf archivierte Projekte: true = Kunde darf nichts mehr aendern (readonly/none).
create or replace function public.project_is_archived(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects where id = p and archived_at is not null)
    and coalesce(public.archive_settings()->>'customerAccessArchived', 'readonly') <> 'full';
$$;
create or replace function public.location_is_archived(l uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.project_is_archived((select project_id from public.locations where id = l));
$$;
grant execute on function public.project_is_archived(uuid) to authenticated;
grant execute on function public.location_is_archived(uuid) to authenticated;

-- Kunden-Schreibrechte: bei abgeschlossenem Projekt gesperrt.
drop policy if exists "Kunde aendert Freigaben" on public.location_approvals;
create policy "Kunde aendert Freigaben" on public.location_approvals for update to authenticated
  using (has_customer_location(location_id) and not location_is_archived(location_id))
  with check (has_customer_location(location_id) and not location_is_archived(location_id));
drop policy if exists "Kunde legt Freigaben an" on public.location_approvals;
create policy "Kunde legt Freigaben an" on public.location_approvals for insert to authenticated
  with check (has_customer_location(location_id) and not location_is_archived(location_id));

drop policy if exists "Kunde aendert eigene Korrespondenz" on public.location_feedback;
create policy "Kunde aendert eigene Korrespondenz" on public.location_feedback for update to authenticated
  using (author_customer_id = current_customer_id() and status = 'open' and not location_is_archived(location_id))
  with check (author_customer_id = current_customer_id() and not location_is_archived(location_id));
drop policy if exists "Kunde loescht eigene Korrespondenz" on public.location_feedback;
create policy "Kunde loescht eigene Korrespondenz" on public.location_feedback for delete to authenticated
  using (author_customer_id = current_customer_id() and status = 'open' and not location_is_archived(location_id));
drop policy if exists "Kunde schreibt Korrespondenz" on public.location_feedback;
create policy "Kunde schreibt Korrespondenz" on public.location_feedback for insert to authenticated
  with check (has_customer_location(location_id) and author_customer_id = current_customer_id() and not location_is_archived(location_id));

drop policy if exists "Kunde aendert Layoutfreigabe" on public.vehicle_layout_approval;
create policy "Kunde aendert Layoutfreigabe" on public.vehicle_layout_approval for update to authenticated
  using (has_customer_project(project_id) and not project_is_archived(project_id))
  with check (has_customer_project(project_id) and not project_is_archived(project_id));
drop policy if exists "Kunde legt Layoutfreigabe an" on public.vehicle_layout_approval;
create policy "Kunde legt Layoutfreigabe an" on public.vehicle_layout_approval for insert to authenticated
  with check (has_customer_project(project_id) and not project_is_archived(project_id));

drop policy if exists "Kunde aendert eigene Layout-Korrespondenz" on public.vehicle_layout_feedback;
create policy "Kunde aendert eigene Layout-Korrespondenz" on public.vehicle_layout_feedback for update to authenticated
  using (author_customer_id = current_customer_id()::text and status = 'open' and not project_is_archived(project_id))
  with check (author_customer_id = current_customer_id()::text and not project_is_archived(project_id));
drop policy if exists "Kunde loescht eigene Layout-Korrespondenz" on public.vehicle_layout_feedback;
create policy "Kunde loescht eigene Layout-Korrespondenz" on public.vehicle_layout_feedback for delete to authenticated
  using (author_customer_id = current_customer_id()::text and status = 'open' and not project_is_archived(project_id));
drop policy if exists "Kunde schreibt Layout-Korrespondenz" on public.vehicle_layout_feedback;
create policy "Kunde schreibt Layout-Korrespondenz" on public.vehicle_layout_feedback for insert to authenticated
  with check (has_customer_project(project_id) and author_customer_id = current_customer_id()::text and not project_is_archived(project_id));

drop policy if exists "Kunde aendert Fahrzeugdaten" on public.vehicle_field_values;
create policy "Kunde aendert Fahrzeugdaten" on public.vehicle_field_values for update to authenticated
  using (has_customer_project(project_id) and not project_is_archived(project_id))
  with check (has_customer_project(project_id) and not project_is_archived(project_id));
drop policy if exists "Kunde traegt Fahrzeugdaten ein" on public.vehicle_field_values;
create policy "Kunde traegt Fahrzeugdaten ein" on public.vehicle_field_values for insert to authenticated
  with check (has_customer_project(project_id) and not project_is_archived(project_id));
drop policy if exists "Kunde ergaenzt Fahrzeugbilder" on public.vehicle_images;
create policy "Kunde ergaenzt Fahrzeugbilder" on public.vehicle_images for insert to authenticated
  with check (has_customer_project(project_id) and not project_is_archived(project_id));
drop policy if exists "Kunde legt Uploads an" on public.customer_uploads;
create policy "Kunde legt Uploads an" on public.customer_uploads for insert to authenticated
  with check (has_customer_project(project_id) and customer_id = current_customer_id() and not project_is_archived(project_id));

-- Secret fuer den Cron-Aufruf von archive-compact.
insert into public.app_config(key, value)
select 'archive_poll_secret', encode(extensions.gen_random_bytes(24), 'hex')
where not exists (select 1 from public.app_config where key = 'archive_poll_secret');

-- Cron: Archivieren liest jetzt die Einstellungen; Komprimieren 03:30 UTC.
do $$
begin
  perform cron.unschedule('auto_archive_old_projects');
exception when others then null;
end $$;
select cron.schedule('auto_archive_old_projects', '0 3 * * *', $$select public.run_auto_archive();$$);
do $$
begin
  perform cron.unschedule('archive_compact');
exception when others then null;
end $$;
select cron.schedule('archive_compact', '30 3 * * *', $cron$
  select net.http_post(
    url := 'https://tocukaqhclkskpvvxmrr.supabase.co/functions/v1/archive-compact',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-poll-secret', (select value from public.app_config where key = 'archive_poll_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
