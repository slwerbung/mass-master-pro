-- Drop anon SELECT policy on employees table (password_hash exposed)
DROP POLICY IF EXISTS "Anon can read employees" ON public.employees;

-- Ensure employees_public view is accessible for frontend needs
-- (view already exists and excludes password_hash)