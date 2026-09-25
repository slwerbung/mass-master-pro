-- Standort eines Mitarbeiters als ADRESSE, nicht als Koordinatenpaar.
--
-- Bisher standen im Adminmenue zwei Zahlenfelder "Breite" und "Laenge". Das
-- traegt niemand von Hand ein, und falsch eingetragen wird daraus stillschweigend
-- ein falscher Einsatzradius. Die Adresse ist das, was man weiss; die
-- Koordinaten rechnet der Server daraus (Geocoding) und behaelt sie fuer die
-- Fahrzeit.
alter table public.staff add column if not exists home_base_address text;

comment on column public.staff.home_base_address is
  'Startadresse fuer die Fahrzeit. home_base_lat/lng werden daraus per Geocoding gefuellt und sind nicht zum Eintippen gedacht.';
