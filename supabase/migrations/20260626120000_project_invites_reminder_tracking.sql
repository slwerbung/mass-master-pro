-- Track every invite sent via project-invite so we can send reminders
-- when the customer hasn't responded after N days.
CREATE TABLE IF NOT EXISTS project_invites (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_number  text,
  email           text        NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  reminder_sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS project_invites_project_id_idx ON project_invites(project_id);
CREATE INDEX IF NOT EXISTS project_invites_sent_at_idx ON project_invites(sent_at);

-- Service role (used by edge functions) bypasses RLS.
-- Direct client access is not permitted.
ALTER TABLE project_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no_direct_access" ON project_invites;
CREATE POLICY "no_direct_access" ON project_invites USING (false);
