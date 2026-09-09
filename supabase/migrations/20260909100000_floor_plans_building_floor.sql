-- Gebaeude und Geschoss am Grundriss
--
-- Ein Grundriss zeigt immer genau ein Geschoss eines Gebaeudes. Bisher musste
-- beides an JEDEM Standort erfasst werden – bei einem Leitsystem mit 300
-- Schildern also 300-mal dasselbe.
--
-- Ab jetzt wird es einmal am Plan gepflegt; Standorte, die auf diesem Plan
-- gesetzt werden, erben die Werte in ihre Standortfelder. Die Werte landen
-- weiterhin AM STANDORT (`locations.custom_fields`), damit Filter, Stueckliste,
-- Export und die Positionsnummer unveraendert damit arbeiten – der Plan liefert
-- nur die Vorgabe.
--
-- Rein additiv: beide Spalten sind optional, bestehende Grundrisse bleiben
-- unveraendert und ohne Wert.

alter table public.floor_plans
  add column if not exists building text,
  add column if not exists floor text;

comment on column public.floor_plans.building is
  'Gebaeude, das dieser Grundriss zeigt. Wird an neu gesetzte Standorte vererbt.';
comment on column public.floor_plans.floor is
  'Geschoss, das dieser Grundriss zeigt. Wird an neu gesetzte Standorte vererbt und liefert das Kuerzel der Standortnummer.';
