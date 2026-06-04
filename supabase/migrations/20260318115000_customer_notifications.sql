-- Customer notification tracking per assignment.
-- Used by send-notification edge function to throttle and deduplicate
-- notification mails for three event types:
--   first_action  - customer first became active (now a no-op, kept for compat)
--   comment       - new comment added (throttled to once per 4 hours)
--   completion    - all locations approved (once per completion transition)
--
-- One row per assignment. Upserted by send-notification after each send.
-- Columns are nullable: NULL = never sent for this assignment yet.

CREATE TABLE IF NOT EXISTS public.customer_notifications (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id         UUID        NOT NULL UNIQUE
                                    REFERENCES public.customer_project_assignments(id)
                                    ON DELETE CASCADE,
  -- Legacy columns - no longer written by current code, kept for
  -- backwards compatibility until a future cleanup migration.
  last_sent_at          TIMESTAMPTZ NULL,
  pending               BOOLEAN     NOT NULL DEFAULT false,
  -- Per-event timestamps (added later via ALTER, defined here for new installs)
  first_action_sent_at  TIMESTAMPTZ NULL,
  last_comment_sent_at  TIMESTAMPTZ NULL,
  completion_sent_at    TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;

-- Only service_role (Edge Functions) may read or write this table.
-- The anon key never touches it directly.
-- No anon policy = anon is blocked by default (RLS enabled, no matching policy).

COMMENT ON TABLE public.customer_notifications IS
  'Throttle/dedup state for outgoing notification mails per customer assignment. '
  'Written exclusively by the send-notification Edge Function via service_role.';

COMMENT ON COLUMN public.customer_notifications.last_comment_sent_at IS
  'Timestamp of the most recent comment notification. Used for 4h throttle.';
COMMENT ON COLUMN public.customer_notifications.completion_sent_at IS
  'Timestamp of the most recent completion notification. '
  'Reset to NULL externally when an assignment transitions back to incomplete.';
