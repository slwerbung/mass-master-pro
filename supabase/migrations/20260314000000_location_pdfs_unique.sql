-- Ensure location_pdfs has unique constraint on location_id for upsert support
ALTER TABLE public.location_pdfs DROP CONSTRAINT IF EXISTS location_pdfs_location_id_key;
ALTER TABLE public.location_pdfs ADD CONSTRAINT location_pdfs_location_id_key UNIQUE (location_id);

-- Ensure project-files storage bucket is public (run this in Supabase dashboard if not already done)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('project-files', 'project-files', true)
-- ON CONFLICT (id) DO UPDATE SET public = true;
