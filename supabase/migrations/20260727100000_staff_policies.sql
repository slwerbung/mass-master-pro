-- Phase 1c-Vorbereitung: Betriebsdaten auch fuer angemeldete Mitarbeiter oeffnen.
--
-- Hintergrund: Sobald der Mitarbeiter-Login eine echte Supabase-Session setzt,
-- laeuft jeder supabase.from(...)-Aufruf im Browser nicht mehr als `anon`,
-- sondern als `authenticated`. Fast alle bestehenden Policies sind aber
-- ausschliesslich fuer `anon` definiert -- ohne diese Migration waere die App
-- fuer eingeloggte Mitarbeiter komplett tot.
--
-- Diese Migration ist rein additiv: die `anon`-Policies bleiben unangetastet,
-- damit Kunden- und Gastansichten unveraendert weiterlaufen. Entfernt werden
-- sie erst in Phase 2, wenn alle Zugriffswege abgedeckt sind.
--
-- Zugriff bekommt nur, wer ein aktives Profil hat (public.is_staff()) -- ein
-- beliebiger fremder Supabase-Account reicht nicht.

do $$
declare
  t text;
  tables text[] := array[
    'customer_location_permissions',
    'customer_project_assignments',
    'customer_uploads',
    'customers',
    'detail_images',
    'floor_plans',
    'location_field_config',
    'location_images',
    'location_pdfs',
    'locations',
    'project_employee_assignments',
    'project_field_config',
    'projects',
    'vehicle_field_config',
    'vehicle_field_values',
    'vehicle_images',
    'vehicle_layout_approval',
    'vehicle_layout_feedback',
    'vehicle_layouts',
    'vehicle_measured_images'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabelle % existiert nicht, uebersprungen', t;
      continue;
    end if;
    execute format('drop policy if exists "Mitarbeiter Vollzugriff" on public.%I', t);
    execute format(
      'create policy "Mitarbeiter Vollzugriff" on public.%I for all to authenticated '
      || 'using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

-- profiles: Supabase vergibt per Default-Privileges Grants an anon. RLS blockt
-- zwar bereits (keine anon-Policy), aber der Grant selbst gehoert hier nicht hin.
revoke all on public.profiles from anon;
