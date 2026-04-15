-- The app uses a custom auth system and the Supabase anon key exclusively.
-- Supabase Auth is not used, so the client role is always 'anon'.
-- The original storage policies only allowed 'authenticated' role → uploads silently failed.
-- This migration replaces them with anon-compatible policies.

DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete" ON storage.objects;
DROP POLICY IF EXISTS "Public read access" ON storage.objects;

-- Allow anon to read all objects in project-files (needed for signed URL generation + fetching)
CREATE POLICY "Anon can read project files" ON storage.objects
  FOR SELECT TO anon USING (bucket_id = 'project-files');

-- Allow anon to upload to project-files
CREATE POLICY "Anon can upload project files" ON storage.objects
  FOR INSERT TO anon WITH CHECK (bucket_id = 'project-files');

-- Allow anon to update (upsert) objects in project-files
CREATE POLICY "Anon can update project files" ON storage.objects
  FOR UPDATE TO anon USING (bucket_id = 'project-files');

-- Allow anon to delete objects in project-files
CREATE POLICY "Anon can delete project files" ON storage.objects
  FOR DELETE TO anon USING (bucket_id = 'project-files');
