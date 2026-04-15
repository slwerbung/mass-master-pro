-- Fix location_images: allow anon to INSERT and UPDATE (app uses anon key, not Supabase Auth)
DROP POLICY IF EXISTS "Users can manage location_images" ON public.location_images;
DROP POLICY IF EXISTS "Anon can view location_images" ON public.location_images;

CREATE POLICY "Anon can manage location_images" ON public.location_images
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Fix detail_images: allow anon to INSERT and UPDATE
DROP POLICY IF EXISTS "Users can manage detail_images" ON public.detail_images;
DROP POLICY IF EXISTS "Anon can view detail_images" ON public.detail_images;

CREATE POLICY "Anon can manage detail_images" ON public.detail_images
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Fix location_pdfs: allow anon to INSERT and UPDATE
DROP POLICY IF EXISTS "Users can manage location_pdfs" ON public.location_pdfs;
DROP POLICY IF EXISTS "Anon can view location_pdfs" ON public.location_pdfs;

CREATE POLICY "Anon can manage location_pdfs" ON public.location_pdfs
  FOR ALL TO anon USING (true) WITH CHECK (true);
