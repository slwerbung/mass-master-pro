-- Vehicle measured images: employee-only photos with drawings/measurements.
-- Shown separately from regular vehicle_images under a "Bemaßt" heading.
-- Two storage paths per image: the edited (bemaßt) version and the raw
-- original, mirrored from how Aufmaß location images work.
CREATE TABLE public.vehicle_measured_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  -- The image-with-drawings, the one employees reference during layout
  storage_path TEXT NOT NULL,
  -- The untouched camera capture; optional fallback to storage_path when
  -- the source image didn't expose an original (re-edits of older photos)
  original_storage_path TEXT,
  caption TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_measured_images ENABLE ROW LEVEL SECURITY;
-- Same permissive RLS as vehicle_images - the "employee only" visibility
-- is enforced at the UI level. Customers never reach this query path.
CREATE POLICY "Anon can manage vehicle_measured_images" ON public.vehicle_measured_images
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE INDEX idx_vehicle_measured_images_project ON public.vehicle_measured_images (project_id);
