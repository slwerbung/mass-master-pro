-- Allow anon/service role to insert projects (needed for employee upsert via client)
-- Projects table already has RLS disabled, but ensure service role can do upserts
-- Also ensure the user_id column accepts non-UUID values (employee id)
ALTER TABLE public.projects ALTER COLUMN user_id TYPE TEXT;
