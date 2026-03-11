
-- Re-enable RLS on all tables but with no policies for anon - only service_role bypasses RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detail_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_location_permissions ENABLE ROW LEVEL SECURITY;

-- Allow anon to read employees (for login name selection)
CREATE POLICY "anon_read_employees" ON public.employees FOR SELECT TO anon USING (true);

-- Allow anon to read customers (for login name selection)
CREATE POLICY "anon_read_customers" ON public.customers FOR SELECT TO anon USING (true);
