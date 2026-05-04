-- Customer notification tracking for three event types:
--   - first_action: customer made any approval or comment for the first
--     time. Sent at most once per assignment.
--   - comment: a new comment was added. Throttled per assignment to one
--     mail per 4 hours so a flurry of comments doesn't spam the team.
--   - completion: all locations of the assignment are approved. Sent
--     once per "completion event" - if a location is later un-approved
--     and then everything re-approved, a new completion notification
--     fires.
--
-- We store a separate timestamp per type rather than a single last_sent_at
-- so each type can be throttled independently. Nullable means "never
-- sent for this assignment yet".

ALTER TABLE customer_notifications
  ADD COLUMN IF NOT EXISTS first_action_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_comment_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS completion_sent_at TIMESTAMPTZ NULL;

-- last_sent_at and pending are kept for backwards compatibility but no
-- longer used by the new logic. We don't drop them so older code paths
-- that might still be running don't crash; they can be removed in a
-- later migration once all callers are updated.

COMMENT ON COLUMN customer_notifications.first_action_sent_at IS
  'Timestamp when the "customer became active" notification was sent. NULL = not sent yet.';
COMMENT ON COLUMN customer_notifications.last_comment_sent_at IS
  'Timestamp of the most recent comment notification. Used for 4h throttle.';
COMMENT ON COLUMN customer_notifications.completion_sent_at IS
  'Timestamp of the most recent completion notification. Reset to NULL when assignment becomes incomplete again.';
