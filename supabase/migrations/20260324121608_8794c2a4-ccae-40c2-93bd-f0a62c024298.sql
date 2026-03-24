CREATE POLICY "Anon can read employees"
  ON public.employees
  FOR SELECT
  TO anon
  USING (true);