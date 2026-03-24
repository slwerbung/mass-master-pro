
CREATE TABLE public.customer_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read customer_uploads" ON public.customer_uploads FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert customer_uploads" ON public.customer_uploads FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can delete customer_uploads" ON public.customer_uploads FOR DELETE TO anon USING (true);
