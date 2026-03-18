ALTER TABLE public.location_field_config
ADD COLUMN IF NOT EXISTS customer_visible BOOLEAN NOT NULL DEFAULT true;

UPDATE public.location_field_config
SET customer_visible = true
WHERE customer_visible IS NULL;

CREATE TABLE IF NOT EXISTS public.location_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.location_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon full access" ON public.location_feedback;
DROP POLICY IF EXISTS "Auth full access" ON public.location_feedback;
CREATE POLICY "Anon full access" ON public.location_feedback FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Auth full access" ON public.location_feedback FOR ALL TO authenticated USING (true) WITH CHECK (true);
