-- M10 — Wo findet der Termin statt?
--
-- Bisher war jeder Termin ein Termin BEIM KUNDEN: die Adresse kam aus HERO, die
-- Anfahrt wurde eingerechnet, der Einsatzradius hat gefiltert. Es gibt aber
-- Termine, bei denen wir gar nicht fahren:
--   vor_ort  — beim Kunden (wie bisher, Vorgabe)
--   buero    — bei uns im Buero: Treffpunkt ist UNSERE Adresse aus `legal_info`
--   telefon  — Telefontermin: ohne Adresse, dafuer ist die Rufnummer Pflicht
--   online   — Videotermin: es entsteht ein Jitsi-Meet-Link je Buchung
--
-- Die Anfahrt haengt allein an diesem Feld (siehe `_shared/booking/location.ts`).
-- Praktisch heisst das: fuer alles ausser `vor_ort` rechnet die Engine ohne
-- Adresse — und sie rechnet Fahrzeit und Radius ohnehin nur, wenn sie eine
-- Adresse bekommt. Deshalb braucht die Engine fuer diese Terminarten keine
-- Zeile Sonderfall; sie bekommt einfach keine Adresse.
--
-- `booking.meeting_url` haelt den Videolink der EINZELNEN Buchung. Er gehoert
-- nicht an die Terminart: jeder Termin bekommt seinen eigenen Raum, sonst
-- sitzen zwei Kunden im selben Meeting.

alter table public.rule_set
  add column if not exists location_mode text not null default 'vor_ort';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rule_set_location_mode_chk'
  ) then
    alter table public.rule_set add constraint rule_set_location_mode_chk
      check (location_mode in ('vor_ort', 'buero', 'telefon', 'online'));
  end if;
end $$;

comment on column public.rule_set.location_mode is
  'vor_ort | buero | telefon | online — entscheidet Adresse, Anfahrt und Treffpunkt.';

alter table public.booking
  add column if not exists meeting_url text;

comment on column public.booking.meeting_url is
  'Videolink dieser einen Buchung (Online-Termin). Steht in Bestaetigung, .ics und HERO.';
