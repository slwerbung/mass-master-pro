-- Terminbuchung, Schritt 7: Dauerlink pro Mitarbeiter, keine Qualifikationen.
--
-- Zwei Entscheidungen aus dem Betrieb:
--
-- 1. Die Einladung geht von einem MITARBEITER aus, nicht von einem Pool. Wer
--    die Einladung verschickt, bekommt den Termin. Dafuer braucht jeder
--    Mitarbeiter einen eigenen, dauerhaften Link — `booking_slug` ist das
--    sprechende Stueck in der URL (/termin/m/<slug>). Eine UUID in der URL
--    waere zwar auch eindeutig, aber niemand erkennt darin den Kollegen.
--
-- 2. Qualifikationen gibt es nicht. Im Adminmenue waren sie nie einstellbar
--    (es gibt keine Liste, aus der man waehlt), und eine Terminart, die eine
--    Qualifikation verlangt, die niemand hat, liefert dauerhaft null freie
--    Zeiten — genau so war "Montage vor Ort" unbuchbar. Die Engine kann
--    Qualifikationen weiterhin, sie bekommt nur keine mehr vorgesetzt.

alter table public.staff add column if not exists booking_slug text;

comment on column public.staff.booking_slug is
  'Sprechendes Stueck im Dauerlink /termin/m/<slug>. Ein Termin ueber diesen Link gehoert diesem Mitarbeiter.';

-- Slug aus dem Anzeigenamen: Umlaute aufloesen, alles andere zu Bindestrichen.
-- Bei Namensgleichheit haengt eine Nummer dran, damit der Index haelt.
with kandidat as (
  select
    id,
    nullif(
      trim(both '-' from lower(regexp_replace(
        translate(display_name, 'äöüÄÖÜßéèêàâ', 'aouAOUseeeaa'),
        '[^a-zA-Z0-9]+', '-', 'g'
      ))),
      ''
    ) as basis,
    row_number() over (
      partition by nullif(
        trim(both '-' from lower(regexp_replace(
          translate(display_name, 'äöüÄÖÜßéèêàâ', 'aouAOUseeeaa'),
          '[^a-zA-Z0-9]+', '-', 'g'
        ))),
        ''
      )
      order by id
    ) as nr
  from public.staff
)
update public.staff s
set booking_slug = case
  when k.basis is null then 'mitarbeiter-' || left(s.id::text, 8)
  when k.nr = 1 then k.basis
  else k.basis || '-' || k.nr
end
from kandidat k
where k.id = s.id
  and s.booking_slug is null;

-- Teilindex: null bleibt erlaubt (ein neuer Datensatz bekommt den Slug erst
-- beim Einladen), doppelte Slugs nicht.
create unique index if not exists staff_booking_slug_key
  on public.staff (booking_slug)
  where booking_slug is not null;

-- Qualifikationen raus. Die Spalten bleiben (die Engine kann es, und alte
-- Daten sollen nicht verschwinden), aber nichts verlangt mehr eine.
update public.rule_set
set required_skills = '{}', updated_at = now()
where required_skills is not null and required_skills <> '{}';

comment on column public.rule_set.required_skills is
  'Bewusst leer: Qualifikationen werden im Adminmenue nicht gepflegt. Gefuellt heisst "niemand kann diese Terminart" und damit dauerhaft null freie Zeiten.';
