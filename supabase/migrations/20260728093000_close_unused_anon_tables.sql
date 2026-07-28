-- Zwei Tabellen, die ausschliesslich von Edge Functions (service_role)
-- beschrieben werden und im Frontend gar nicht vorkommen -- der offene Zugriff
-- war reine Altlast:
--
--   project_layouts          geschrieben von submit-layout
--   vehicle_design_briefings geschrieben von submit-design-briefing
--
-- Bei project_layouts standen bisher zwei Policies nebeneinander:
-- "no_direct_access" (false) und "Anon manage project_layouts" (true).
-- Permissive Policies werden mit ODER verknuepft -- die Tabelle war also offen,
-- obwohl die erste Policy das Gegenteil suggerierte.

drop policy if exists "Anon manage project_layouts" on public.project_layouts;

drop policy if exists "Anon manage design briefings" on public.vehicle_design_briefings;

-- Ohne verbleibende Policy sperrt RLS vollstaendig; service_role umgeht RLS
-- ohnehin, die Edge Functions arbeiten also unveraendert weiter.
