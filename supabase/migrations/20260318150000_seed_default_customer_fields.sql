INSERT INTO public.location_field_config (field_key, field_label, field_type, sort_order, is_active, customer_visible)
SELECT 'locationName', 'Standortname', 'text', 5, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.location_field_config WHERE field_key = 'locationName');

INSERT INTO public.location_field_config (field_key, field_label, field_type, sort_order, is_active, customer_visible)
SELECT 'system', 'System', 'text', 10, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.location_field_config WHERE field_key = 'system');

INSERT INTO public.location_field_config (field_key, field_label, field_type, sort_order, is_active, customer_visible)
SELECT 'locationType', 'Standorttyp', 'text', 20, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.location_field_config WHERE field_key = 'locationType');

INSERT INTO public.location_field_config (field_key, field_label, field_type, sort_order, is_active, customer_visible)
SELECT 'label', 'Beschriftung', 'text', 30, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.location_field_config WHERE field_key = 'label');

INSERT INTO public.location_field_config (field_key, field_label, field_type, sort_order, is_active, customer_visible)
SELECT 'comment', 'Kommentar / Informationen', 'textarea', 40, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.location_field_config WHERE field_key = 'comment');
