-- Restrict vehicle_field_config write access.
--
-- Previously the table had a permissive "Anon can manage" policy that let
-- anyone with the anon key INSERT/UPDATE/DELETE vehicle field config. Admin.tsx
-- used the anon key directly, meaning the protection was only client-side.
--
-- Fix: anon may only SELECT. All writes go through the admin-manage Edge
-- Function (which verifies the admin session token with service_role).

DROP POLICY IF EXISTS "Anon can manage vehicle_field_config" ON public.vehicle_field_config;
DROP POLICY IF EXISTS "Anon can read vehicle_field_config" ON public.vehicle_field_config;

-- Read is public (needed by VehicleDetail and guest forms to render field labels).
CREATE POLICY "Anon can read vehicle_field_config"
  ON public.vehicle_field_config
  FOR SELECT TO anon
  USING (true);

-- Writes only via service_role (admin-manage Edge Function).
-- service_role bypasses RLS entirely, so no explicit policy needed for it.
