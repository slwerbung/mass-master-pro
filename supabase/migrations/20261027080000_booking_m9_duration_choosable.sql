-- M9 — Dauer je Termin einstellbar, und Terminarten selbst anlegen.
--
-- Hintergrund: eine „Montage vor Ort" ist mal drei, mal acht Stunden lang. Die
-- Dauer gehoert deshalb nicht allein an die Terminart, sondern an den
-- EINZELNEN Link: wer einlaedt, weiss, wie lange es dauert. Die Terminart
-- behaelt eine Standarddauer (fuer Links ohne Angabe, etwa aus einer
-- HERO-Mailvorlage ohne Dauersegment) und sagt zusaetzlich, ob die Dauer beim
-- Erstellen des Links ueberhaupt geaendert werden darf.
--
-- Die Grenzen sind kein Zierrat: die Dauer steht im Link, und ein Link laesst
-- sich von Hand aendern. Ohne Grenzen koennte jemand aus einer Achtstunden-
-- Montage einen Zehnminuten-Termin machen (oder einen Dreitage-Block). Der
-- Server klemmt deshalb jede Wunschdauer in [min, max] — siehe
-- `_shared/booking/duration.ts`.
--
-- Nicht angefasst: `duration_options`. Die Spalte steht seit M1 ungenutzt in
-- der Tabelle (fuer `montage_vor_ort` sogar mit Werten) und wird von keiner
-- Zeile Code gelesen. Sie bleibt liegen, damit diese Migration nichts
-- loescht, was jemand noch vorhat.

alter table public.rule_set
  add column if not exists duration_choosable boolean not null default false,
  add column if not exists duration_min_minutes int,
  add column if not exists duration_max_minutes int;

comment on column public.rule_set.duration_choosable is
  'Darf die Dauer beim Erstellen des Terminlinks geaendert werden?';
comment on column public.rule_set.duration_min_minutes is
  'Kuerzeste erlaubte Dauer. Leer = Standarddauer ist auch das Minimum.';
comment on column public.rule_set.duration_max_minutes is
  'Laengste erlaubte Dauer. Leer = Standarddauer ist auch das Maximum.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rule_set_duration_min_chk'
  ) then
    alter table public.rule_set add constraint rule_set_duration_min_chk
      check (duration_min_minutes is null or duration_min_minutes > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'rule_set_duration_max_chk'
  ) then
    alter table public.rule_set add constraint rule_set_duration_max_chk
      check (duration_max_minutes is null or duration_max_minutes > 0);
  end if;

  -- Verdrehte Grenzen waeren eine Terminart, die sich nicht buchen laesst.
  if not exists (
    select 1 from pg_constraint where conname = 'rule_set_duration_range_chk'
  ) then
    alter table public.rule_set add constraint rule_set_duration_range_chk
      check (
        duration_min_minutes is null
        or duration_max_minutes is null
        or duration_min_minutes <= duration_max_minutes
      );
  end if;
end $$;

-- „Montage vor Ort" war der Anlass (3 h oder 8 h, je Auftrag). Damit die
-- Funktion sofort an der Stelle greift, um die es ging, wird sie hier einmalig
-- eingeschaltet — von 1 bis 10 Stunden. Im Adminmenue jederzeit aenderbar;
-- jede andere Terminart bleibt unberuehrt.
update public.rule_set
   set duration_choosable = true,
       duration_min_minutes = 60,
       duration_max_minutes = 600,
       updated_at = now()
 where key = 'montage_vor_ort'
   and duration_choosable = false;
