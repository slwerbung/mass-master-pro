
CREATE TABLE IF NOT EXISTS public.location_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  assignment_id UUID REFERENCES public.customer_project_assignments(id) ON DELETE CASCADE NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ,
  UNIQUE(location_id, assignment_id)
);

ALTER TABLE public.location_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can manage approvals" ON public.location_approvals FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Auth can manage approvals" ON public.location_approvals FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read config" ON public.app_config FOR SELECT TO anon USING (true);
CREATE POLICY "Auth can manage config" ON public.app_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.location_field_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key TEXT NOT NULL UNIQUE,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL,
  field_options TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.location_field_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read field config" ON public.location_field_config FOR SELECT TO anon USING (true);
CREATE POLICY "Auth can manage field config" ON public.location_field_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
