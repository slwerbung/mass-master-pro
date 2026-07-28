-- Phase 2, Abschluss: Der Anon-Key darf keine Betriebsdaten mehr sehen.
--
-- Voraussetzung, die jetzt erfuellt ist: Alle Mitarbeiter und alle Kunden
-- bekommen beim Anmelden eine echte Supabase-Session (Phase 1 + Phase 2).
-- Damit greifen die Policies "Mitarbeiter Vollzugriff" und "Kunde ..." --
-- die offenen anon-Policies sind ab hier nur noch ein Loch.
--
-- Was bewusst offen bleibt:
--   * vehicle_field_config (SELECT): das oeffentliche Formular
--     /fahrzeug-anfrage braucht die Feldliste, bevor sich jemand anmeldet.
--     Inhalt sind Feldnamen und Reihenfolge, keine Kundendaten.
--   * employees_public: eine View mit Definer-Rechten (Namen ohne Hashes) --
--     der Anmeldebildschirm zeigt daraus die Mitarbeiterliste.
--   * mister_x_players: eigenstaendiges Spiel-Feature, unkritisch.
--   * die "false"-Policies (No direct access): sie sperren bereits.
--
-- Alles andere laeuft ueber eine Session oder ueber eine Edge Function mit
-- service_role -- beide sind von dieser Migration nicht betroffen.

-- 1. Mitarbeiter brauchen Lesezugriff auf den Storage, bevor die gemeinsame
--    anon/authenticated-Lesepolicy faellt (Signed URLs pruefen SELECT).
drop policy if exists "Mitarbeiter liest project-files" on storage.objects;
create policy "Mitarbeiter liest project-files" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-files' and public.is_staff());

-- 2. Betriebsdaten: alle rein-anon-Policies entfernen.
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles::text = '{anon}'
      -- "false"-Policies sperren bereits, die bleiben stehen
      and coalesce(qual, with_check, 'true') <> 'false'
      -- Ausnahme: oeffentliches Fahrzeug-Anfrageformular
      and not (tablename = 'vehicle_field_config' and policyname = 'Anon can read vehicle_field_config')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 3. Storage: Schreiben und Loeschen ohne Anmeldung ist damit vorbei.
drop policy if exists "Allow anon upload" on storage.objects;
drop policy if exists "Allow anon update" on storage.objects;
drop policy if exists "Anon can upload project files" on storage.objects;
drop policy if exists "Anon can update project files" on storage.objects;
drop policy if exists "Anon can update project-files" on storage.objects;
drop policy if exists "Anon can delete project files" on storage.objects;
drop policy if exists "Anon can read project files" on storage.objects;
