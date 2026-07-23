-- Auto-archive was based on projects.updated_at, but a BEFORE UPDATE trigger
-- bumps updated_at to now() on every write — including the background sync that
-- re-writes project rows. So no project ever aged to 90 days and the daily cron
-- always updated 0 rows. Base inactivity on IMMUTABLE activity timestamps
-- instead (locations / feedback / approvals created — aufmass + vehicle), which
-- the sync cannot pollute.

create or replace function public.project_last_activity(p_id uuid, p_created timestamptz)
returns timestamptz
language sql
stable
as $fn$
  select greatest(
    p_created,
    coalesce((select max(l.created_at) from public.locations l where l.project_id = p_id), p_created),
    coalesce((select max(lf.created_at) from public.location_feedback lf
              join public.locations l2 on l2.id = lf.location_id
              where l2.project_id = p_id), p_created),
    coalesce((select max(la.approved_at) from public.location_approvals la
              join public.locations l3 on l3.id = la.location_id
              where l3.project_id = p_id and la.approved_at is not null), p_created),
    coalesce((select max(vf.created_at) from public.vehicle_layout_feedback vf
              where vf.project_id = p_id), p_created),
    coalesce((select max(va.approved_at) from public.vehicle_layout_approval va
              where va.project_id = p_id and va.approved_at is not null), p_created)
  );
$fn$;

-- Reschedule the daily cron with the corrected condition (unschedule guarded so
-- the migration stays re-runnable).
do $$
begin
  perform cron.unschedule('auto_archive_old_projects');
exception when others then null;
end $$;

select cron.schedule(
  'auto_archive_old_projects',
  '0 3 * * *',
  $cron$
    update public.projects p
    set archived_at = now()
    where p.archived_at is null
      and public.project_last_activity(p.id, p.created_at) < now() - interval '90 days';
  $cron$
);

-- One-time backfill so projects that are already 90+ days inactive get archived
-- immediately instead of waiting for the next nightly run.
update public.projects p
set archived_at = now()
where p.archived_at is null
  and public.project_last_activity(p.id, p.created_at) < now() - interval '90 days';
