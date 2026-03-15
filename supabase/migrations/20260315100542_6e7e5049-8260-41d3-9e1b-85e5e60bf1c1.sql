
ALTER TABLE public.customer_location_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detail_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Add permissive policies for anon access (since app uses edge functions with service_role)
CREATE POLICY "Anon full access" ON public.customer_location_permissions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON public.customer_project_assignments FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON public.detail_images FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON public.location_images FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON public.location_pdfs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON public.locations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access" ON public.projects FOR ALL TO anon USING (true) WITH CHECK (true);
