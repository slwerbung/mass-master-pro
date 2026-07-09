-- Standalone-Protokolle: die Diktier-/Protokollfunktion als eigenständige App
-- (Direktlink /protokoll). Solche Notizen hängen an KEINEM Projekt (z.B.
-- Gremiensitzungen) und tragen ein Briefing (Kontext + Anweisung), das der KI
-- vorab mitgegeben wird. Bestehende projektgebundene Notizen bleiben unverändert.
ALTER TABLE public.meeting_notes ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.meeting_notes ADD COLUMN IF NOT EXISTS title   text;
ALTER TABLE public.meeting_notes ADD COLUMN IF NOT EXISTS context text;
ALTER TABLE public.meeting_notes ADD COLUMN IF NOT EXISTS kind    text NOT NULL DEFAULT 'project';

-- Schneller Zugriff auf die projektlosen (Standalone-)Protokolle.
CREATE INDEX IF NOT EXISTS meeting_notes_standalone_idx
  ON public.meeting_notes(created_at DESC) WHERE project_id IS NULL;
