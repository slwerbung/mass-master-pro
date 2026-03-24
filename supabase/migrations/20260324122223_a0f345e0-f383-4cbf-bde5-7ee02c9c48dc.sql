CREATE POLICY "Anon can read customers"
  ON public.customers
  FOR SELECT
  TO anon
  USING (true);