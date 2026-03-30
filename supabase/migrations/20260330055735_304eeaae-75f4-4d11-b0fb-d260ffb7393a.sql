CREATE OR REPLACE VIEW public.employees_public AS
  SELECT id, name, created_at
  FROM public.employees;