
-- Enable RLS on all tables that don't have it enabled
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_field_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_location_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- Drop the anon_read_employees policy that exposes password_hash
DROP POLICY IF EXISTS "anon_read_employees" ON public.employees;

-- Drop the anon_read_customers policy (customer auth will go through edge function)
DROP POLICY IF EXISTS "anon_read_customers" ON public.customers;

-- Add a restrictive policy for customer_notifications (only service role)
CREATE POLICY "No direct access" ON public.customer_notifications
  FOR ALL TO anon USING (false) WITH CHECK (false);
