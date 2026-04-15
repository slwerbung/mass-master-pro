-- Revert bucket to public.
-- The app uses anon key exclusively (no Supabase Auth), so createSignedUrl
-- does not work for anon users. getPublicUrl (synchronous, no API call)
-- is the correct approach for this architecture.
UPDATE storage.buckets SET public = true WHERE id = 'project-files';
