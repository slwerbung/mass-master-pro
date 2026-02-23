-- Projects table
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number TEXT NOT NULL,
  user_id UUID NOT NULL,
  guest_password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Locations table
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  location_number TEXT NOT NULL,
  location_name TEXT,
  comment TEXT,
  system TEXT,
  label TEXT,
  location_type TEXT,
  guest_info TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

-- Location images
CREATE TABLE public.location_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  image_type TEXT NOT NULL CHECK (image_type IN ('annotated', 'original')),
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.location_images ENABLE ROW LEVEL SECURITY;

-- Detail images
CREATE TABLE public.detail_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  caption TEXT,
  annotated_path TEXT NOT NULL,
  original_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.detail_images ENABLE ROW LEVEL SECURITY;

-- Location PDFs
CREATE TABLE public.location_pdfs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.location_pdfs ENABLE ROW LEVEL SECURITY;

-- Storage bucket for project files
INSERT INTO storage.buckets (id, name, public) VALUES ('project-files', 'project-files', true);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper function to check project ownership
CREATE OR REPLACE FUNCTION public.owns_project(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects WHERE id = _project_id AND user_id = _user_id
  )
$$;

-- RLS Policies for projects
CREATE POLICY "Users can view own projects" ON public.projects
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can create projects" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects" ON public.projects
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects" ON public.projects
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Guests can view projects via anon
CREATE POLICY "Anon can view projects" ON public.projects
  FOR SELECT TO anon USING (true);

-- RLS Policies for locations
CREATE POLICY "Users can manage locations" ON public.locations
  FOR ALL TO authenticated USING (public.owns_project(auth.uid(), project_id));

CREATE POLICY "Anon can view locations" ON public.locations
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can update guest_info" ON public.locations
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- RLS for location_images
CREATE POLICY "Users can manage location_images" ON public.location_images
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.locations l WHERE l.id = location_id AND public.owns_project(auth.uid(), l.project_id))
  );

CREATE POLICY "Anon can view location_images" ON public.location_images
  FOR SELECT TO anon USING (true);

-- RLS for detail_images
CREATE POLICY "Users can manage detail_images" ON public.detail_images
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.locations l WHERE l.id = location_id AND public.owns_project(auth.uid(), l.project_id))
  );

CREATE POLICY "Anon can view detail_images" ON public.detail_images
  FOR SELECT TO anon USING (true);

-- RLS for location_pdfs
CREATE POLICY "Users can manage location_pdfs" ON public.location_pdfs
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.locations l WHERE l.id = location_id AND public.owns_project(auth.uid(), l.project_id))
  );

CREATE POLICY "Anon can view location_pdfs" ON public.location_pdfs
  FOR SELECT TO anon USING (true);

-- Storage policies
CREATE POLICY "Public read access" ON storage.objects
  FOR SELECT USING (bucket_id = 'project-files');

CREATE POLICY "Authenticated users can upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'project-files');

CREATE POLICY "Authenticated users can update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'project-files');

CREATE POLICY "Authenticated users can delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'project-files');