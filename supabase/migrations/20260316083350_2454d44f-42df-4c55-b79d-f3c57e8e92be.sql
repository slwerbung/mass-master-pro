
-- 1. app_config: Remove anon read access (sensitive data like passwords)
DROP POLICY IF EXISTS "Anon can read config" ON public.app_config;
DROP POLICY IF EXISTS "Auth can manage config" ON public.app_config;
-- No anon access at all - all access via edge functions with service_role
CREATE POLICY "No direct access" ON public.app_config FOR ALL TO anon USING (false) WITH CHECK (false);

-- 2. projects: Replace full anon access with restricted access
DROP POLICY IF EXISTS "Anon full access" ON public.projects;
-- Allow read and write (for sync) but NOT delete, and hide guest_password via edge functions
CREATE POLICY "Anon read projects" ON public.projects FOR SELECT TO anon USING (true);
CREATE POLICY "Anon insert projects" ON public.projects FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon update projects" ON public.projects FOR UPDATE TO anon USING (true) WITH CHECK (true);
-- No DELETE policy = anon cannot delete projects

-- 3. customer_project_assignments: Remove all anon access (managed via edge functions only)
DROP POLICY IF EXISTS "Anon full access" ON public.customer_project_assignments;
CREATE POLICY "No direct access" ON public.customer_project_assignments FOR ALL TO anon USING (false) WITH CHECK (false);

-- 4. location_field_config: Allow anon full access (needed by Admin.tsx which uses anon key)
DROP POLICY IF EXISTS "Anon can read field config" ON public.location_field_config;
DROP POLICY IF EXISTS "Auth can manage field config" ON public.location_field_config;
CREATE POLICY "Anon full access" ON public.location_field_config FOR ALL TO anon USING (true) WITH CHECK (true);
