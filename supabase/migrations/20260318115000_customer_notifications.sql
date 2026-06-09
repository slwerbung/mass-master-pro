-- Customer notification tracking per assignment.
-- Used by send-notification edge function to throttle and deduplicate
-- notification mails for three event types.
-- One row per assignment. Upserted by send-notification after each send.

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