-- Ausfuehrungsprotokoll der Automationen begrenzen.
--
-- Das Adminmenue zeigt nur die letzten 15 Laeufe. Aeltere Eintraege bringen
-- dort nichts mehr, blaehen die Tabelle aber auf (bis Sept. 2026 ~74.000
-- Scheinlaeufe durch einen Poll-Fehler). Nachts alles loeschen, was aelter als
-- 30 Tage ist -- genug Vorlauf, um einen Fehler noch nachzuvollziehen.

create index if not exists automation_runs_created_at_idx
  on public.automation_runs (created_at);

do $$
begin
  perform cron.unschedule('automation_runs_retention');
exception when others then null;
end $$;

select cron.schedule(
  'automation_runs_retention',
  '15 3 * * *',
  $cron$
    delete from public.automation_runs
    where created_at < now() - interval '30 days';
  $cron$
);

-- Einmalig sofort aufraeumen statt auf den naechsten Nachtlauf zu warten.
delete from public.automation_runs
where created_at < now() - interval '30 days';
