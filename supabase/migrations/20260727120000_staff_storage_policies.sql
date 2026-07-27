-- Ergaenzung zu 20260727100000_staff_policies.sql, gleiche Begruendung:
-- Sobald der Mitarbeiter eine echte Supabase-Session hat, spricht der Browser
-- den Storage als `authenticated` an. Dort gab es bisher nur SELECT und INSERT
-- fuer `authenticated` -- Ueberschreiben (upsert) und Loeschen von Bildern und
-- PDFs waeren fehlgeschlagen.
--
-- Auch hier rein additiv: die anon-Policies bleiben bis Phase 3 bestehen.

drop policy if exists "Mitarbeiter kann project-files aktualisieren" on storage.objects;
create policy "Mitarbeiter kann project-files aktualisieren" on storage.objects
  for update to authenticated
  using (bucket_id = 'project-files' and public.is_staff())
  with check (bucket_id = 'project-files' and public.is_staff());

drop policy if exists "Mitarbeiter kann project-files loeschen" on storage.objects;
create policy "Mitarbeiter kann project-files loeschen" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-files' and public.is_staff());
