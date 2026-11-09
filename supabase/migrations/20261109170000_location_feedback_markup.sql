-- Spec C: Kundenkorrektur mit Markierungen. Kommentare an Standorten (location_feedback) und Fahrzeuglayouts
-- (vehicle_layout_feedback) bekommen Antworten (eine Ebene, parent_id) und optional eine Markierung (markup) auf
-- genau einer Datei/Seite (media_ref). Bestehende Nachrichten bleiben unveraendert = allgemeine Kommentare.
-- Format und Feinpruefung: supabase/functions/_shared/markup.ts (Kopie src/lib/markup.ts).

alter table public.location_feedback
  add column if not exists parent_id uuid references public.location_feedback(id) on delete cascade,
  add column if not exists markup jsonb,
  add column if not exists media_ref jsonb;
create index if not exists location_feedback_parent_idx on public.location_feedback(parent_id);

alter table public.vehicle_layout_feedback
  add column if not exists parent_id uuid references public.vehicle_layout_feedback(id) on delete cascade,
  add column if not exists markup jsonb,
  add column if not exists media_ref jsonb;
create index if not exists vehicle_layout_feedback_parent_idx on public.vehicle_layout_feedback(parent_id);

-- Sicherheitsnetz fuer direkte Writes (Fahrzeuglayouts laufen per RLS direkt aus dem Client): Grobpruefung in der DB.
create or replace function public.markup_is_valid(m jsonb, r jsonb) returns boolean
language sql immutable set search_path = public as $$
  select m is null or (
    jsonb_typeof(m) = 'object'
    and (m->>'v') = '1'
    and jsonb_typeof(m->'shapes') = 'array'
    and jsonb_array_length(m->'shapes') between 1 and 30
    and pg_column_size(m) <= 30720
    and r is not null
    and (r->>'kind') in ('pdf','image')
    and coalesce(r->>'storagePath','') <> ''
  )
$$;
grant execute on function public.markup_is_valid(jsonb, jsonb) to anon, authenticated, service_role;

alter table public.location_feedback drop constraint if exists location_feedback_markup_valid;
alter table public.location_feedback
  add constraint location_feedback_markup_valid check (public.markup_is_valid(markup, media_ref));
alter table public.vehicle_layout_feedback drop constraint if exists vehicle_layout_feedback_markup_valid;
alter table public.vehicle_layout_feedback
  add constraint vehicle_layout_feedback_markup_valid check (public.markup_is_valid(markup, media_ref));

-- Antworten nur eine Ebene tief und ohne eigene Markierung (Trigger, weil CHECK keine Unterabfragen kann).
create or replace function public.feedback_single_level() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'Antwort auf sich selbst ist nicht erlaubt';
    end if;
    if exists (select 1 from public.location_feedback where id = new.parent_id and parent_id is not null)
       or exists (select 1 from public.vehicle_layout_feedback where id = new.parent_id and parent_id is not null) then
      raise exception 'Antwort auf eine Antwort ist nicht erlaubt';
    end if;
    new.markup := null;
    new.media_ref := null;
  end if;
  return new;
end $$;

drop trigger if exists location_feedback_single_level on public.location_feedback;
create trigger location_feedback_single_level before insert or update on public.location_feedback
  for each row execute function public.feedback_single_level();
drop trigger if exists vehicle_layout_feedback_single_level on public.vehicle_layout_feedback;
create trigger vehicle_layout_feedback_single_level before insert or update on public.vehicle_layout_feedback
  for each row execute function public.feedback_single_level();

-- Kunde darf eigene offene Layout-Korrespondenz aendern (Markierung/Text) – analog location_feedback.
drop policy if exists "Kunde aendert eigene Layout-Korrespondenz" on public.vehicle_layout_feedback;
create policy "Kunde aendert eigene Layout-Korrespondenz" on public.vehicle_layout_feedback
  for update to authenticated
  using (author_customer_id = (public.current_customer_id())::text and status = 'open')
  with check (author_customer_id = (public.current_customer_id())::text);
