-- Add missing unique constraint that the upsert ON CONFLICT depends on
ALTER TABLE public.location_images 
  DROP CONSTRAINT IF EXISTS location_images_location_id_image_type_key;

ALTER TABLE public.location_images 
  ADD CONSTRAINT location_images_location_id_image_type_key 
  UNIQUE (location_id, image_type);
