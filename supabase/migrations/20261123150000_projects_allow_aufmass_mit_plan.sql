-- "Aufmaß mit Plan" (project_type = 'aufmass_mit_plan') gibt es in der App,
-- die Datenbank liess aber nur 'aufmass' und 'fahrzeugbeschriftung' zu. Jeder
-- Upload eines solchen Projekts scheiterte am CHECK (400), danach alle
-- Standorte, Detailbilder und Plaene am Fremdschluessel (409) – die Daten
-- lagen nur auf dem Handy (WER-978, 23.11.2026). Live bereits angewendet.
alter table public.projects drop constraint if exists projects_project_type_check;
alter table public.projects add constraint projects_project_type_check
  check (project_type = any (array['aufmass'::text, 'aufmass_mit_plan'::text, 'fahrzeugbeschriftung'::text]));
