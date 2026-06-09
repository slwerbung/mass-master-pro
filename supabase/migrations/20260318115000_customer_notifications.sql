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
  last_sent_at          TIMESTAMPTZ NULL,
  pending               BOOLEAN     NOT NULL DEFAULT false,
  first_action_sent_at  TIMESTAMPTZ NULL,
  last_comment_sent_at  TIMESTAMPTZ NULL,
  completion_sent_at    TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.customer_notifications IS
  'Throttle/dedup state for outgoing notification mails per customer assignment. Written exclusively by the send-notification Edge Function via service_role.';
