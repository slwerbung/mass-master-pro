-- Zwei Altlasten, die die neue Kunden-Abgrenzung ausgehebelt haetten:
--
--   location_feedback  "Auth full access"        -> alle Angemeldeten, ALL
--   location_approvals "Auth can manage approvals" -> alle Angemeldeten, ALL
--
-- Bisher fiel das nicht auf, weil sich niemand per Supabase Auth anmeldete.
-- Mit Kundensessions haette jeder Kunde saemtliche Korrespondenz und
-- Freigaben aller Projekte gesehen -- geprueft und bestaetigt: mit diesen
-- Policies sah ein Testkunde 6 fremde Feedback-Eintraege, obwohl sein Projekt
-- keinen einzigen Standort hat.
--
-- Sie werden ersetzt durch denselben Mitarbeiter-Zugriff wie bei den anderen
-- Betriebsdaten. Die Kunden-Policies aus 20260728090000 greifen daneben.

drop policy if exists "Auth full access" on public.location_feedback;
drop policy if exists "Auth can manage approvals" on public.location_approvals;

drop policy if exists "Mitarbeiter Vollzugriff" on public.location_feedback;
create policy "Mitarbeiter Vollzugriff" on public.location_feedback
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "Mitarbeiter Vollzugriff" on public.location_approvals;
create policy "Mitarbeiter Vollzugriff" on public.location_approvals
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
