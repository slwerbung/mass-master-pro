-- Allow anon to delete projects
CREATE POLICY "Anon can delete projects"
  ON public.projects
  FOR DELETE
  TO anon
  USING (true);

-- Allow anon to delete locations
CREATE POLICY "Anon can delete locations"
  ON public.locations
  FOR DELETE
  TO anon
  USING (true);