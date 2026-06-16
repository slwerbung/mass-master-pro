-- Fix: customer approvals were never persisted, so the "fully approved"
-- completion mail never fired.
--
-- Root cause: the customer approval flow upserts into location_approvals with
-- onConflict (location_id, assignment_id), but no matching UNIQUE constraint
-- existed. Postgres rejects such an upsert (error 42P10) and the frontend
-- swallowed the error, so location_approvals stayed empty.
--
-- Also ensures the per-event timestamp columns on customer_notifications exist
-- (the send-notification function reads/writes completion_sent_at etc.). These
-- were defined in 20260503100000 but had not reached this database.
--
-- This migration is fully idempotent and was already applied to production via
-- the Supabase API; it is committed here so the repo, the second machine, and
-- fresh installs stay in sync.

-- 1) Unique constraint backing the approval upsert.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'location_approvals_location_assignment_key'
  ) then
    alter table public.location_approvals
      add constraint location_approvals_location_assignment_key
      unique (location_id, assignment_id);
  end if;
end $$;

-- 2) Per-event notification timestamp columns (safety net).
alter table public.customer_notifications
  add column if not exists first_action_sent_at timestamptz null,
  add column if not exists last_comment_sent_at timestamptz null,
  add column if not exists completion_sent_at   timestamptz null;

notify pgrst, 'reload schema';
