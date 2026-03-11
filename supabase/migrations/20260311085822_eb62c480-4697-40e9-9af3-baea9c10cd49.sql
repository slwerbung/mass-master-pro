
-- Create employees table
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create customers table
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create customer_project_assignments table
CREATE TABLE public.customer_project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, project_id)
);

-- Create customer_location_permissions table
CREATE TABLE public.customer_location_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.customer_project_assignments(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  can_edit_guest_info boolean NOT NULL DEFAULT true,
  UNIQUE (assignment_id, location_id)
);

-- Add employee_id to projects (nullable for now since existing projects have user_id)
ALTER TABLE public.projects ADD COLUMN employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;

-- Drop all existing RLS policies on projects
DROP POLICY IF EXISTS "Users can create projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can view own projects" ON public.projects;

-- Drop all existing RLS policies on locations
DROP POLICY IF EXISTS "Users can manage locations" ON public.locations;

-- Drop all existing RLS policies on location_images
DROP POLICY IF EXISTS "Users can manage location_images" ON public.location_images;

-- Drop all existing RLS policies on location_pdfs
DROP POLICY IF EXISTS "Users can manage location_pdfs" ON public.location_pdfs;

-- Drop all existing RLS policies on detail_images
DROP POLICY IF EXISTS "Users can manage detail_images" ON public.detail_images;

-- Disable RLS on all tables (access control via Edge Functions with service_role)
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_images DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_pdfs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.detail_images DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_project_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_location_permissions DISABLE ROW LEVEL SECURITY;
