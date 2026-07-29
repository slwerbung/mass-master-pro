-- Phase 3: Der Bucket `project-files` ist nicht mehr oeffentlich.
--
-- Bisher war jede Datei ohne jede Anmeldung abrufbar, sobald jemand den Pfad
-- kannte -- und die Pfade sind vorhersagbar aufgebaut
-- (`vehicle-images/<projectId>/<uuid>`, `pdfs/<locationId>/…`). Fotos,
-- Druckdaten und Layouts lagen damit faktisch offen.
--
-- Ab jetzt gibt es Dateien nur noch ueber signierte, zeitlich begrenzte Links
-- (`createSignedUrl`, siehe src/lib/storageUrl.ts). Wer die Zeile nicht sehen
-- darf, bekommt auch keinen Link: die Storage-Policies aus Phase 1/2 gelten.
--
-- Serverseitig (Edge Functions mit service_role) wird direkt heruntergeladen,
-- ohne Umweg ueber eine URL -- siehe _shared/aufmassPdf.ts.
--
-- Zusaetzlich ein Limit gegen versehentliche Riesen-Uploads. 100 MB liegt weit
-- ueber allem, was Fotos oder Druckdaten in der Praxis brauchen.

update storage.buckets
set public = false,
    file_size_limit = 104857600
where id = 'project-files';

-- Nachzug: "Allow authenticated upload" galt fuer jeden angemeldeten
-- Supabase-Benutzer, nicht nur fuer Mitarbeiter und Kunden. Lesen oder
-- Schreiben in der Datenbank konnte damit zwar niemand, aber Dateien ablegen
-- schon. Ersetzt durch eine Policy fuer Mitarbeiter; Kunden haben ihre eigene.
drop policy if exists "Allow authenticated upload" on storage.objects;

drop policy if exists "Mitarbeiter laedt in project-files hoch" on storage.objects;
create policy "Mitarbeiter laedt in project-files hoch" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-files' and public.is_staff());
