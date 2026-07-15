-- Kunden alphabetisch in Unterordnern (A, B, C …) ablegen. Optional pro
-- Instanz. Default aus (generisch); wird pro Tenant im Admin gesetzt.
INSERT INTO public.app_config (key, value)
VALUES ('dropbox_customer_alpha_buckets', 'false')
ON CONFLICT (key) DO NOTHING;
