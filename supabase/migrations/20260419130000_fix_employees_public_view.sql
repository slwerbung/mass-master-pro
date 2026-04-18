-- Fix: previous migration (20260418120000_drop_anon_read_employees_policy)
-- recreated employees_public WITH (security_invoker = on) while also
-- dropping the anon_read_employees policy on public.employees.
-- Combined effect: the anon role could no longer read anything through
-- the view because it ran with the caller's (anon) privileges against
-- a table that anon can't select from. Mitarbeiter-Login returned [].
--
-- Fix by recreating the view WITHOUT security_invoker. It will then run
-- with the view owner's privileges, which can read employees, but still
-- only exposes id/name/created_at to the caller — password_hash stays
-- protected because it's not in the view's SELECT list.

DROP VIEW IF EXISTS public.employees_public;

CREATE VIEW public.employees_public AS
  SELECT id, name, created_at FROM public.employees;

GRANT SELECT ON public.employees_public TO anon;
GRANT SELECT ON public.employees_public TO authenticated;
