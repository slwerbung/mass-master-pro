-- Create project_layouts table and add comment column.
-- The edge function (submit-layout) previously did a best-effort insert
-- guarded by try/catch in case the table was missing. This migration
-- makes the table official and adds the comment field used for the
-- customer comment that also gets mirrored to the HERO logbook.
CREATE TABLE IF NOT EXISTS project_layouts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  storage_path text        NOT NULL,
  file_name    text,
  comment      text,
  uploaded_by  text        NOT NULL DEFAULT 'Kunde',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Safe to run on an existing table that was created without the column.
ALTER TABLE project_layouts ADD COLUMN IF NOT EXISTS comment text;

-- Service role (used by edge functions) bypasses RLS.
-- Direct client access is not permitted.
ALTER TABLE project_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "no_direct_access" ON project_layouts;
CREATE POLICY "no_direct_access" ON project_layouts USING (false);
