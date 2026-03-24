
ALTER TABLE public.location_field_config 
  ADD COLUMN IF NOT EXISTS applies_to text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS is_required boolean NOT NULL DEFAULT false;

-- Normalize sort_order values sequentially
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, created_at) - 1 AS new_order
  FROM public.location_field_config
)
UPDATE public.location_field_config f
SET sort_order = n.new_order
FROM numbered n
WHERE f.id = n.id;
