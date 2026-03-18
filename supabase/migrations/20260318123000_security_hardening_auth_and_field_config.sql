-- Restrict direct public write access to field config while keeping public reads for the app.
DROP POLICY IF EXISTS "Anon full access" ON public.location_field_config;
DROP POLICY IF EXISTS "Auth can manage field config" ON public.location_field_config;
DROP POLICY IF EXISTS "Anon can read field config" ON public.location_field_config;

CREATE POLICY "Anon can read field config"
ON public.location_field_config
FOR SELECT
TO anon
USING (true);

-- Legacy plaintext employee password is no longer needed once migrated to hash.
DELETE FROM public.app_config WHERE key = 'employee_password';
