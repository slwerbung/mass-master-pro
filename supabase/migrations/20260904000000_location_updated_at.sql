-- Konflikt-Sync: Zeitstempel pro Standort
--
-- Bisher entschied der Sync ausschliesslich auf PROJEKT-Ebene, wer gewinnt
-- (last-write-wins ueber projects.updated_at). Bearbeiteten zwei Leute
-- gleichzeitig VERSCHIEDENE Standorte desselben Projekts, ging eine Seite
-- komplett verloren: entweder wurden die lokalen Aenderungen beim Hydrate
-- verworfen, oder der lokale Upload ueberschrieb die fremden.
--
-- Mit einem Zeitstempel pro Standort kann der Client pro Standort
-- entscheiden, welche Fassung neuer ist, statt das ganze Projekt zu
-- verwerfen.

alter table public.locations
  add column if not exists updated_at timestamptz;

-- Bestandsdaten: created_at als Startwert, damit vorhandene Standorte nicht
-- faelschlich als "gerade eben bearbeitet" gelten.
update public.locations
   set updated_at = created_at
 where updated_at is null;

alter table public.locations
  alter column updated_at set default now();

alter table public.locations
  alter column updated_at set not null;

-- Der Sync liest die Stempel projektweise; ein Index auf (project_id,
-- updated_at) haelt diese Abfrage guenstig.
create index if not exists locations_project_updated_at_idx
  on public.locations (project_id, updated_at);
