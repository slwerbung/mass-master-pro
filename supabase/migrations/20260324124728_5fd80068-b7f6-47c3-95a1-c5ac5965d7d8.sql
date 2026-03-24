
-- Fix customer_project_assignments RLS
DROP POLICY IF EXISTS "No direct access" ON public.customer_project_assignments;
CREATE POLICY "Anon can read assignments" ON public.customer_project_assignments FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert assignments" ON public.customer_project_assignments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can delete assignments" ON public.customer_project_assignments FOR DELETE TO anon USING (true);

-- Fix customers: allow INSERT and DELETE
CREATE POLICY "Anon can insert customers" ON public.customers FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can delete customers" ON public.customers FOR DELETE TO anon USING (true);

-- Create employees_public view (hides password_hash)
CREATE OR REPLACE VIEW public.employees_public
WITH (security_invoker = on) AS
SELECT id, name, created_at
FROM public.employees;
