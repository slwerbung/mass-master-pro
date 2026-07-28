-- Nachlese aus dem Supabase-Security-Advisor nach dem Schliessen des
-- Anon-Zugriffs. Drei Kleinigkeiten, die nichts mit der App zu tun haben,
-- aber ueber /rest/v1/rpc erreichbar waren:
--
--   rls_auto_enable()  Event-Trigger-Helfer, SECURITY DEFINER, war fuer anon
--                      aufrufbar. Gehoert nicht in die oeffentliche API.
--   owns_project()     alter Helfer aus der Zeit vor dem Token-System; von
--                      keiner Policy benutzt (geprueft), aber fuer anon
--                      aufrufbar -- er verraet, ob eine Projekt-ID existiert.
--   project_last_activity()  ohne festes search_path.

revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.owns_project(uuid, uuid) from public, anon, authenticated;

alter function public.project_last_activity(uuid, timestamptz) set search_path = public;
