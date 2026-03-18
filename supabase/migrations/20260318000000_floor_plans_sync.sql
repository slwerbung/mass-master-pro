CREATE TABLE IF NOT EXISTS public.floor_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  markers JSONB NOT NULL DEFAULT '[]'::jsonb,
  page_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.floor_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage floor_plans" ON public.floor_plans;
DROP POLICY IF EXISTS "Anon can view floor_plans" ON public.floor_plans;

CREATE POLICY "Users can manage floor_plans" ON public.floor_plans
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon can view floor_plans" ON public.floor_plans
  FOR SELECT TO anon USING (true);
