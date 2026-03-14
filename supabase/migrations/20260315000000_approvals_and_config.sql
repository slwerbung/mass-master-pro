-- Location approvals (customer can approve each location)
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

-- App config table (for employee password and other settings)
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can read config" ON public.app_config FOR SELECT TO anon USING (true);
CREATE POLICY "Auth can manage config" ON public.app_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Custom location fields configuration
CREATE TABLE IF NOT EXISTS public.location_field_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key TEXT NOT NULL UNIQUE,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'textarea', 'dropdown', 'checkbox')),
  field_options TEXT, -- JSON array for dropdown options
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.location_field_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can read field config" ON public.location_field_config FOR SELECT TO anon USING (true);
CREATE POLICY "Auth can manage field config" ON public.location_field_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Custom field values per location (stored as JSON in locations table via new column)
-- We add a jsonb column to locations for custom fields
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';

-- Insert default fields matching current app fields
INSERT INTO public.location_field_config (field_key, field_label, field_type, sort_order) VALUES
  ('system', 'System', 'text', 1),
  ('label', 'Beschriftung', 'textarea', 2),
  ('locationType', 'Art', 'dropdown', 3),
  ('comment', 'Kommentar', 'textarea', 4)
ON CONFLICT (field_key) DO NOTHING;

-- Insert dropdown options for locationType
UPDATE public.location_field_config 
SET field_options = '["Wand","Deckenhänger","Aufsteller Mobil","Aufsteller Fest","Folienbeschriftung"]'
WHERE field_key = 'locationType';
