
-- Remove all overly permissive anonymous RLS policies
DROP POLICY IF EXISTS "Anon can view projects" ON public.projects;
DROP POLICY IF EXISTS "Anon can view locations" ON public.locations;
DROP POLICY IF EXISTS "Anon can update guest_info" ON public.locations;
DROP POLICY IF EXISTS "Anon can view location_images" ON public.location_images;
DROP POLICY IF EXISTS "Anon can view location_pdfs" ON public.location_pdfs;
DROP POLICY IF EXISTS "Anon can view detail_images" ON public.detail_images;
