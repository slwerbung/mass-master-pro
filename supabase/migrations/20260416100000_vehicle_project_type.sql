-- Vehicle images: multiple photos per vehicle project
CREATE TABLE public.vehicle_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  caption TEXT,
  uploaded_by TEXT, -- 'employee' or customer name
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can manage vehicle_images" ON public.vehicle_images
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Vehicle field config: admin-configurable fields for vehicle projects
CREATE TABLE public.vehicle_field_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key TEXT NOT NULL UNIQUE,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'textarea', 'dropdown', 'checkbox')),
  field_options TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_field_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can read vehicle_field_config" ON public.vehicle_field_config
  FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can manage vehicle_field_config" ON public.vehicle_field_config
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Vehicle field values: per-project field values
CREATE TABLE public.vehicle_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  field_key TEXT NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, field_key)
);
ALTER TABLE public.vehicle_field_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can manage vehicle_field_values" ON public.vehicle_field_values
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Vehicle layouts: one layout PDF per project (replaceable)
CREATE TABLE public.vehicle_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can manage vehicle_layouts" ON public.vehicle_layouts
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Vehicle layout feedback: customer feedback on the layout
CREATE TABLE public.vehicle_layout_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  message TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
ALTER TABLE public.vehicle_layout_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can manage vehicle_layout_feedback" ON public.vehicle_layout_feedback
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Vehicle layout approval: customer approval per project+assignment
CREATE TABLE public.vehicle_layout_approval (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  assignment_id UUID NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ,
  UNIQUE (project_id, assignment_id)
);
ALTER TABLE public.vehicle_layout_approval ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can manage vehicle_layout_approval" ON public.vehicle_layout_approval
  FOR ALL TO anon USING (true) WITH CHECK (true);
