-- Safety-net migration: ensure employees_public view stays in the correct
-- state no matter what earlier migrations did to it.
--
-- Background: The view has broken twice now because earlier migrations
-- recreated it with security_invoker = on while also dropping the
-- anon_read_employees policy on public.employees. Combined effect: anon
-- role can't read anything through the view, Mitarbeiter-Login shows
-- empty list.
--
-- This migration has a deliberately late timestamp (99990101) so it
-- runs AFTER every other migration, every time. It's fully idempotent -
-- safe to run multiple times. If the view is already correct, this is
-- a no-op; if it got broken somehow, this fixes it.
--
-- Do NOT delete this migration. It's a permanent guardrail.

DROP VIEW IF EXISTS public.employees_public;

CREATE VIEW public.employees_public AS
  SELECT id, name, created_at FROM public.employees;

GRANT SELECT ON public.employees_public TO anon;
GRANT SELECT ON public.employees_public TO authenticated;

-- Note: we do NOT set security_invoker on this view. Running under the
-- view owner's privileges is what allows anon to read through it while
-- the underlying employees table still enforces RLS for other columns
-- (notably password_hash, which is never exposed via the view).
