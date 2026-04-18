-- Fix: earlier migration tried to drop "Anon can read employees" but the actual
-- policy created in 20260311085834 was named "anon_read_employees" (underscored).
-- The DROP silently no-op'd and left password_hash exposed to anon.
-- This migration drops both possible names to be safe.

DROP POLICY IF EXISTS "anon_read_employees" ON public.employees;
DROP POLICY IF EXISTS "Anon can read employees" ON public.employees;

-- Re-ensure the secure view is in place with security_invoker = on,
-- so that any remaining RLS on employees is respected through the view.
DROP VIEW IF EXISTS public.employees_public;
CREATE VIEW public.employees_public
  WITH (security_invoker = on) AS
  SELECT id, name, created_at
  FROM public.employees;

-- Grant select on the view so the anon role (the client uses the anon key)
-- can still list employees for the login picker — but password_hash stays hidden.
GRANT SELECT ON public.employees_public TO anon;

-- Sanity: make sure RLS is still enabled on employees so no unrelated policy
-- accidentally re-opens read access to all columns.
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
