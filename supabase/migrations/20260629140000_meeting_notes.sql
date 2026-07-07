-- Gesprächsnotizen: aus einer (Hintergrund-)Aufnahme transkribierte und zu
-- einem Ergebnisprotokoll + Maßnahmenplan aufbereitete Notiz, optional ins
-- HERO-Logbuch geschrieben. Befüllt ausschließlich über die Edge Function
-- meeting-notes (Service-Role); kein direkter Client-Zugriff.
CREATE TABLE IF NOT EXISTS public.meeting_notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  summary     text,
  action_plan text,
  transcript  text,
  created_by  text,
  hero_logged boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_notes_project_id_idx ON public.meeting_notes(project_id, created_at DESC);

ALTER TABLE public.meeting_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no_direct_access" ON public.meeting_notes;
CREATE POLICY "no_direct_access" ON public.meeting_notes USING (false) WITH CHECK (false);
