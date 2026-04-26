-- Project archiving: hide old/inactive projects from the main view
-- without deleting them. archived_at IS NULL means active.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

-- Index speeds up the most common filter ("show me only active projects")
-- which is every list query in the app. Partial index, since most rows
-- will have archived_at IS NULL anyway.
CREATE INDEX IF NOT EXISTS idx_projects_active
  ON public.projects (created_at DESC)
  WHERE archived_at IS NULL;

-- Auto-archive: any project untouched for 90+ days gets archived. Runs
-- daily at 03:00 UTC. updated_at is the right field here, not created_at,
-- so a long-running project that's still being worked on doesn't suddenly
-- vanish on its 90th day of existence.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- pg_cron jobs are global (not per-schema), so we name carefully and
-- check for existing jobs to avoid double-scheduling on re-run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_archive_old_projects') THEN
    PERFORM cron.schedule(
      'auto_archive_old_projects',
      '0 3 * * *',
      $cron$
        UPDATE public.projects
        SET archived_at = now()
        WHERE archived_at IS NULL
          AND updated_at < now() - INTERVAL '90 days';
      $cron$
    );
  END IF;
END
$$;
