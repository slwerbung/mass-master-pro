-- Phase 2, Teil 1: Kunden bekommen eine echte Identitaet.
--
-- Ausgangslage: Die Kundenansicht spricht die Datenbank an 51 Stellen direkt
-- mit dem Anon-Key an. Solange `anon` alles darf, sieht dort faktisch jeder
-- alles -- und der Anon-Key steht im JS-Bundle.
--
-- Der Weg hier ist derselbe wie bei den Mitarbeitern: Der Kunde meldet sich
-- unveraendert mit seinem Namen an, bekommt dabei aber zusaetzlich eine echte
-- Supabase-Session. Damit greifen Policies, die ihn auf die ihm zugewiesenen
-- Projekte begrenzen. Kein einziger Aufruf in CustomerView muss umgebaut
-- werden -- was der Kunde sieht, entscheidet ab jetzt die Datenbank.
--
-- Wieder rein additiv: die anon-Policies bleiben bis zum Abschluss von Phase 2
-- bestehen, damit nichts ausfaellt, solange noch nicht alle Sessions laufen.

-- 1. profiles kann jetzt auch Kunden aufnehmen ------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','mitarbeiter','kunde'));

alter table public.profiles add column if not exists customer_id uuid
  references public.customers(id) on delete cascade;

create unique index if not exists profiles_customer_id_key
  on public.profiles(customer_id) where customer_id is not null;

-- 2. Helfer -----------------------------------------------------------------

-- WICHTIG: is_staff() hat bisher jedes aktive Profil als Mitarbeiter gewertet.
-- Mit Kundenprofilen in derselben Tabelle waere das ein Vollzugriff fuer
-- Kunden. Deshalb jetzt explizit auf die Mitarbeiterrollen eingegrenzt.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('admin','mitarbeiter')
  )
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select customer_id from public.profiles
  where id = auth.uid() and is_active and role = 'kunde'
$$;

revoke all on function public.current_customer_id() from public, anon;
grant execute on function public.current_customer_id() to authenticated, service_role;

-- Ist dieses Projekt dem angemeldeten Kunden zugewiesen?
create or replace function public.has_customer_project(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.customer_project_assignments a
    where a.project_id = p
      and a.customer_id = public.current_customer_id()
  )
$$;

revoke all on function public.has_customer_project(uuid) from public, anon;
grant execute on function public.has_customer_project(uuid) to authenticated, service_role;

-- Gehoert dieser Standort zu einem Projekt des angemeldeten Kunden?
create or replace function public.has_customer_location(l uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations loc
    join public.customer_project_assignments a on a.project_id = loc.project_id
    where loc.id = l
      and a.customer_id = public.current_customer_id()
  )
$$;

revoke all on function public.has_customer_location(uuid) from public, anon;
grant execute on function public.has_customer_location(uuid) to authenticated, service_role;

-- 3. Policies fuer Kunden ---------------------------------------------------
-- Namensschema "Kunde ..." , damit sie sich klar von den anon- und
-- Mitarbeiter-Policies unterscheiden.

-- eigenes Stammdatensatz
drop policy if exists "Kunde liest eigenen Datensatz" on public.customers;
create policy "Kunde liest eigenen Datensatz" on public.customers
  for select to authenticated using (id = public.current_customer_id());

drop policy if exists "Kunde liest eigene Zuweisungen" on public.customer_project_assignments;
create policy "Kunde liest eigene Zuweisungen" on public.customer_project_assignments
  for select to authenticated using (customer_id = public.current_customer_id());

drop policy if exists "Kunde liest eigene Projekte" on public.projects;
create policy "Kunde liest eigene Projekte" on public.projects
  for select to authenticated using (public.has_customer_project(id));

drop policy if exists "Kunde liest eigene Standorte" on public.locations;
create policy "Kunde liest eigene Standorte" on public.locations
  for select to authenticated using (public.has_customer_project(project_id));

drop policy if exists "Kunde liest Standortbilder" on public.location_images;
create policy "Kunde liest Standortbilder" on public.location_images
  for select to authenticated using (public.has_customer_location(location_id));

drop policy if exists "Kunde liest Standort-PDFs" on public.location_pdfs;
create policy "Kunde liest Standort-PDFs" on public.location_pdfs
  for select to authenticated using (public.has_customer_location(location_id));

drop policy if exists "Kunde liest Detailbilder" on public.detail_images;
create policy "Kunde liest Detailbilder" on public.detail_images
  for select to authenticated using (public.has_customer_location(location_id));

drop policy if exists "Kunde liest Grundrisse" on public.floor_plans;
create policy "Kunde liest Grundrisse" on public.floor_plans
  for select to authenticated using (public.has_customer_project(project_id));

drop policy if exists "Kunde liest Sichtbarkeitsrechte" on public.customer_location_permissions;
create policy "Kunde liest Sichtbarkeitsrechte" on public.customer_location_permissions
  for select to authenticated
  using (exists (
    select 1 from public.customer_project_assignments a
    where a.id = assignment_id and a.customer_id = public.current_customer_id()
  ));

-- Freigaben: der Kunde gibt frei, darf sie also anlegen und aendern.
drop policy if exists "Kunde liest Freigaben" on public.location_approvals;
create policy "Kunde liest Freigaben" on public.location_approvals
  for select to authenticated using (public.has_customer_location(location_id));

drop policy if exists "Kunde legt Freigaben an" on public.location_approvals;
create policy "Kunde legt Freigaben an" on public.location_approvals
  for insert to authenticated with check (public.has_customer_location(location_id));

drop policy if exists "Kunde aendert Freigaben" on public.location_approvals;
create policy "Kunde aendert Freigaben" on public.location_approvals
  for update to authenticated
  using (public.has_customer_location(location_id))
  with check (public.has_customer_location(location_id));

-- Korrespondenz: lesen ja, aber nur eigene offene Beitraege aendern/loeschen.
drop policy if exists "Kunde liest Korrespondenz" on public.location_feedback;
create policy "Kunde liest Korrespondenz" on public.location_feedback
  for select to authenticated using (public.has_customer_location(location_id));

drop policy if exists "Kunde schreibt Korrespondenz" on public.location_feedback;
create policy "Kunde schreibt Korrespondenz" on public.location_feedback
  for insert to authenticated
  with check (public.has_customer_location(location_id)
              and author_customer_id = public.current_customer_id());

drop policy if exists "Kunde aendert eigene Korrespondenz" on public.location_feedback;
create policy "Kunde aendert eigene Korrespondenz" on public.location_feedback
  for update to authenticated
  using (author_customer_id = public.current_customer_id() and status = 'open')
  with check (author_customer_id = public.current_customer_id());

drop policy if exists "Kunde loescht eigene Korrespondenz" on public.location_feedback;
create policy "Kunde loescht eigene Korrespondenz" on public.location_feedback
  for delete to authenticated
  using (author_customer_id = public.current_customer_id() and status = 'open');

-- Fahrzeug
drop policy if exists "Kunde liest Fahrzeugbilder" on public.vehicle_images;
create policy "Kunde liest Fahrzeugbilder" on public.vehicle_images
  for select to authenticated using (public.has_customer_project(project_id));

drop policy if exists "Kunde ergaenzt Fahrzeugbilder" on public.vehicle_images;
create policy "Kunde ergaenzt Fahrzeugbilder" on public.vehicle_images
  for insert to authenticated with check (public.has_customer_project(project_id));

drop policy if exists "Kunde liest bemasste Fahrzeugbilder" on public.vehicle_measured_images;
create policy "Kunde liest bemasste Fahrzeugbilder" on public.vehicle_measured_images
  for select to authenticated using (public.has_customer_project(project_id));

drop policy if exists "Kunde liest Fahrzeuglayouts" on public.vehicle_layouts;
create policy "Kunde liest Fahrzeuglayouts" on public.vehicle_layouts
  for select to authenticated using (public.has_customer_project(project_id));

drop policy if exists "Kunde liest Fahrzeugdaten" on public.vehicle_field_values;
create policy "Kunde liest Fahrzeugdaten" on public.vehicle_field_values
  for select to authenticated using (public.has_customer_project(project_id));

drop policy if exists "Kunde traegt Fahrzeugdaten ein" on public.vehicle_field_values;
create policy "Kunde traegt Fahrzeugdaten ein" on public.vehicle_field_values
  for insert to authenticated with check (public.has_customer_project(project_id));

drop policy if exists "Kunde aendert Fahrzeugdaten" on public.vehicle_field_values;
create policy "Kunde aendert Fahrzeugdaten" on public.vehicle_field_values
  for update to authenticated
  using (public.has_customer_project(project_id))
  with check (public.has_customer_project(project_id));

drop policy if exists "Kunde liest Layout-Korrespondenz" on public.vehicle_layout_feedback;
create policy "Kunde liest Layout-Korrespondenz" on public.vehicle_layout_feedback
  for select to authenticated using (public.has_customer_project(project_id));

-- author_customer_id ist hier text (Gaeste schreiben "guest:..."), deshalb der Cast.
drop policy if exists "Kunde schreibt Layout-Korrespondenz" on public.vehicle_layout_feedback;
create policy "Kunde schreibt Layout-Korrespondenz" on public.vehicle_layout_feedback
  for insert to authenticated
  with check (public.has_customer_project(project_id)
              and author_customer_id = public.current_customer_id()::text);

drop policy if exists "Kunde loescht eigene Layout-Korrespondenz" on public.vehicle_layout_feedback;
create policy "Kunde loescht eigene Layout-Korrespondenz" on public.vehicle_layout_feedback
  for delete to authenticated
  using (author_customer_id = public.current_customer_id()::text and status = 'open');

drop policy if exists "Kunde liest Layoutfreigabe" on public.vehicle_layout_approval;
create policy "Kunde liest Layoutfreigabe" on public.vehicle_layout_approval
  for select to authenticated using (public.has_customer_project(project_id));

drop policy if exists "Kunde legt Layoutfreigabe an" on public.vehicle_layout_approval;
create policy "Kunde legt Layoutfreigabe an" on public.vehicle_layout_approval
  for insert to authenticated with check (public.has_customer_project(project_id));

drop policy if exists "Kunde aendert Layoutfreigabe" on public.vehicle_layout_approval;
create policy "Kunde aendert Layoutfreigabe" on public.vehicle_layout_approval
  for update to authenticated
  using (public.has_customer_project(project_id))
  with check (public.has_customer_project(project_id));

-- Eigene Dateien
drop policy if exists "Kunde liest eigene Uploads" on public.customer_uploads;
create policy "Kunde liest eigene Uploads" on public.customer_uploads
  for select to authenticated using (public.has_customer_project(project_id));

drop policy if exists "Kunde legt Uploads an" on public.customer_uploads;
create policy "Kunde legt Uploads an" on public.customer_uploads
  for insert to authenticated
  with check (public.has_customer_project(project_id)
              and customer_id = public.current_customer_id());

drop policy if exists "Kunde loescht eigene Uploads" on public.customer_uploads;
create policy "Kunde loescht eigene Uploads" on public.customer_uploads
  for delete to authenticated
  using (customer_id = public.current_customer_id());

-- Feldkonfiguration ist reine Darstellung (Labels, Reihenfolge) und enthaelt
-- keine Kundendaten. Lesen fuer alle Angemeldeten.
drop policy if exists "Angemeldete lesen Standort-Feldkonfiguration" on public.location_field_config;
create policy "Angemeldete lesen Standort-Feldkonfiguration" on public.location_field_config
  for select to authenticated using (true);

drop policy if exists "Angemeldete lesen Projekt-Feldkonfiguration" on public.project_field_config;
create policy "Angemeldete lesen Projekt-Feldkonfiguration" on public.project_field_config
  for select to authenticated using (true);

drop policy if exists "Angemeldete lesen Fahrzeug-Feldkonfiguration" on public.vehicle_field_config;
create policy "Angemeldete lesen Fahrzeug-Feldkonfiguration" on public.vehicle_field_config
  for select to authenticated using (true);

-- 4. Storage ----------------------------------------------------------------
-- Kunden laden Dateien hoch (customer_uploads, Fahrzeugbilder) und lesen
-- Bilder/PDFs. Feiner geschnitten wird das in Phase 3 ueber Signed URLs; hier
-- geht es nur darum, dass der Wechsel von anon auf authenticated nichts
-- kaputt macht.
drop policy if exists "Kunde liest project-files" on storage.objects;
create policy "Kunde liest project-files" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-files' and public.current_customer_id() is not null);

drop policy if exists "Kunde laedt in project-files hoch" on storage.objects;
create policy "Kunde laedt in project-files hoch" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-files' and public.current_customer_id() is not null);

drop policy if exists "Kunde loescht in project-files" on storage.objects;
create policy "Kunde loescht in project-files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-files' and public.current_customer_id() is not null);
