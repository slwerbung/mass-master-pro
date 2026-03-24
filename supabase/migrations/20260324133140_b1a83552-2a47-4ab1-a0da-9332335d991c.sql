-- Seed default location fields if none exist
INSERT INTO public.location_field_config (field_key, field_label, field_type, sort_order, is_active, customer_visible)
SELECT * FROM (VALUES
  ('locationName', 'Standortbezeichnung', 'text', 5, true, true),
  ('system', 'System', 'text', 10, true, true),
  ('locationType', 'Standorttyp', 'text', 20, true, true),
  ('label', 'Beschriftung', 'text', 30, true, true),
  ('comment', 'Kommentar / Informationen', 'textarea', 40, true, true)
) AS defaults(field_key, field_label, field_type, sort_order, is_active, customer_visible)
WHERE NOT EXISTS (
  SELECT 1 FROM public.location_field_config WHERE field_key IN ('locationName', 'system', 'locationType', 'label', 'comment')
);