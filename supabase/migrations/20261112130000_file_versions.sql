-- Spec D1: Dateiversionen (Druckdateien je Standort, Fahrzeuglayouts je Projekt), Freigabe-Nachweis, Freigabe-Reset.
--
-- Aktuelle Version = alle Zeilen mit superseded_at IS NULL (bei Standorten koennen das mehrere PDFs sein).
-- Neue Versionen und das Loeschen der aktuellen Version laufen NUR ueber add_file_version / delete_current_version
-- (eine Transaktion: nie ein halber Stand). Welche Datei freigegeben wurde, setzt ausschliesslich der Trigger.

-- ------------------------------------------------------------------ Versionen
alter table public.location_pdfs
  add column if not exists version int not null default 1,
  add column if not exists superseded_at timestamptz,
  add column if not exists uploaded_by text,
  add column if not exists version_note text;

alter table public.vehicle_layouts
  add column if not exists version int not null default 1,
  add column if not exists superseded_at timestamptz,
  add column if not exists uploaded_by text,
  add column if not exists version_note text;

create index if not exists location_pdfs_current_idx on public.location_pdfs(location_id) where superseded_at is null;
create index if not exists vehicle_layouts_current_idx on public.vehicle_layouts(project_id) where superseded_at is null;

-- Altbestand: bei mehreren Zeilen pro Standort/Projekt gilt die neueste als aktuell.
update public.location_pdfs p set superseded_at = p.uploaded_at
where p.superseded_at is null
  and exists (select 1 from public.location_pdfs q where q.location_id = p.location_id and q.uploaded_at > p.uploaded_at);
update public.vehicle_layouts p set superseded_at = p.uploaded_at
where p.superseded_at is null
  and exists (select 1 from public.vehicle_layouts q where q.project_id = p.project_id and q.uploaded_at > p.uploaded_at);

-- ------------------------------------------------------------------ Freigabe-Nachweis
alter table public.location_approvals
  add column if not exists approved_version int,
  add column if not exists approved_paths text[],
  add column if not exists approved_by_name text;
alter table public.vehicle_layout_approval
  add column if not exists approved_version int,
  add column if not exists approved_paths text[],
  add column if not exists approved_by_name text;

create table if not exists public.approval_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('location','vehicle')),
  project_id uuid not null references public.projects(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  assignment_id uuid,
  action text not null check (action in ('approve','revoke','reset_new_version')),
  version int,
  storage_paths text[],
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists approval_events_project_idx on public.approval_events(project_id, created_at desc);
create index if not exists approval_events_location_idx on public.approval_events(location_id, created_at desc);
alter table public.approval_events enable row level security;
revoke all on public.approval_events from anon, authenticated;
grant select on public.approval_events to authenticated;
grant select, insert, update, delete on public.approval_events to service_role;
drop policy if exists "Mitarbeiter liest Freigabe-Historie" on public.approval_events;
create policy "Mitarbeiter liest Freigabe-Historie" on public.approval_events for select to authenticated using (public.is_staff());
drop policy if exists "Kunde liest eigene Freigabe-Historie" on public.approval_events;
create policy "Kunde liest eigene Freigabe-Historie" on public.approval_events for select to authenticated using (public.has_customer_project(project_id));

-- Aktuelle Version eines Standorts / eines Fahrzeugprojekts: (Nummer, Pfade).
create or replace function public.current_file_version(p_kind text, p_owner uuid, out version int, out paths text[])
language sql stable security definer set search_path = public as $$
  select max(x.version), coalesce(array_agg(x.storage_path order by x.uploaded_at), '{}')
  from (
    select version, storage_path, uploaded_at from public.location_pdfs where p_kind = 'location' and location_id = p_owner and superseded_at is null
    union all
    select version, storage_path, uploaded_at from public.vehicle_layouts where p_kind = 'vehicle' and project_id = p_owner and superseded_at is null
  ) x;
$$;
revoke all on function public.current_file_version(text, uuid) from public, anon, authenticated;

-- BEFORE: Version, Pfade und Name setzt der Server – was der Client mitschickt, wird ueberschrieben.
create or replace function public.approval_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := case when tg_table_name = 'location_approvals' then 'location' else 'vehicle' end;
  v_owner uuid;
  v record;
begin
  if tg_op = 'UPDATE' and new.approved is not distinct from old.approved then
    new.approved_version := old.approved_version;
    new.approved_paths := old.approved_paths;
    new.approved_by_name := old.approved_by_name;
    return new;
  end if;
  if coalesce(new.approved, false) then
    -- getrennt, weil plpgsql ein fehlendes Feld (location_id an Fahrzeugfreigaben) schon beim Planen ablehnt
    if v_kind = 'location' then v_owner := new.location_id; else v_owner := new.project_id; end if;
    select * into v from public.current_file_version(v_kind, v_owner);
    new.approved_version := v.version;
    new.approved_paths := v.paths;
    new.approved_by_name := (select c.name from public.customer_project_assignments a join public.customers c on c.id = a.customer_id where a.id = new.assignment_id);
  elsif tg_op = 'INSERT' then
    new.approved_version := null;
    new.approved_paths := null;
    new.approved_by_name := null;
  else
    -- Zuruecknehmen: Nachweis der letzten Freigabe bleibt in approval_events; die Zeile behaelt ihn nicht.
    new.approved_version := old.approved_version;
    new.approved_paths := old.approved_paths;
    new.approved_by_name := old.approved_by_name;
  end if;
  return new;
end;
$$;

-- AFTER: Ereignis schreiben (approve / revoke). Beim Reset durch eine neue Version schreibt add_file_version selbst.
create or replace function public.approval_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := case when tg_table_name = 'location_approvals' then 'location' else 'vehicle' end;
  v_project uuid;
  v_location uuid;
  v_action text;
  v_name text;
begin
  if coalesce(current_setting('app.approval_reset', true), '') = '1' then return null; end if;
  if tg_op = 'INSERT' then
    if not coalesce(new.approved, false) then return null; end if;
    v_action := 'approve';
  elsif new.approved is distinct from old.approved then
    v_action := case when coalesce(new.approved, false) then 'approve' else 'revoke' end;
  else
    return null;
  end if;
  if v_kind = 'location' then
    v_location := new.location_id;
    select project_id into v_project from public.locations where id = new.location_id;
  else
    v_project := new.project_id;
  end if;
  if v_project is null then return null; end if;
  v_name := (select c.name from public.customer_project_assignments a join public.customers c on c.id = a.customer_id where a.id = new.assignment_id);
  insert into public.approval_events(kind, project_id, location_id, assignment_id, action, version, storage_paths, actor_name)
  values (v_kind, v_project, v_location, new.assignment_id, v_action,
          case when v_action = 'approve' then new.approved_version end,
          case when v_action = 'approve' then new.approved_paths end,
          v_name);
  return null;
end;
$$;

drop trigger if exists location_approvals_stamp on public.location_approvals;
create trigger location_approvals_stamp before insert or update on public.location_approvals
  for each row execute function public.approval_stamp();
drop trigger if exists location_approvals_log on public.location_approvals;
create trigger location_approvals_log after insert or update on public.location_approvals
  for each row execute function public.approval_log();
drop trigger if exists vehicle_layout_approval_stamp on public.vehicle_layout_approval;
create trigger vehicle_layout_approval_stamp before insert or update on public.vehicle_layout_approval
  for each row execute function public.approval_stamp();
drop trigger if exists vehicle_layout_approval_log on public.vehicle_layout_approval;
create trigger vehicle_layout_approval_log after insert or update on public.vehicle_layout_approval
  for each row execute function public.approval_log();

-- Bestehende Freigaben: Version/Pfade einmalig nachtragen (Altbestand gilt als Freigabe der heute aktuellen Datei).
-- Direktes UPDATE der Spalten: der BEFORE-Trigger laesst sie bei unveraendertem approved stehen (old-Werte) –
-- deshalb kurz ohne Trigger.
alter table public.location_approvals disable trigger location_approvals_stamp;
update public.location_approvals a set
  approved_version = (select v.version from public.current_file_version('location', a.location_id) v),
  approved_paths = (select v.paths from public.current_file_version('location', a.location_id) v),
  approved_by_name = (select c.name from public.customer_project_assignments x join public.customers c on c.id = x.customer_id where x.id = a.assignment_id)
where a.approved and a.approved_version is null;
alter table public.location_approvals enable trigger location_approvals_stamp;
alter table public.vehicle_layout_approval disable trigger vehicle_layout_approval_stamp;
update public.vehicle_layout_approval a set
  approved_version = (select v.version from public.current_file_version('vehicle', a.project_id) v),
  approved_paths = (select v.paths from public.current_file_version('vehicle', a.project_id) v),
  approved_by_name = (select c.name from public.customer_project_assignments x join public.customers c on c.id = x.customer_id where x.id = a.assignment_id)
where a.approved and a.approved_version is null;
alter table public.vehicle_layout_approval enable trigger vehicle_layout_approval_stamp;

-- ------------------------------------------------------------------ Neue Version / aktuelle Version loeschen
-- p_files: [{ "storage_path": "...", "file_name": "..." }]. Gibt { version, reset, assignments, previous_version } zurueck.
create or replace function public.add_file_version(
  p_kind text, p_owner uuid, p_files jsonb, p_reset boolean, p_note text, p_actor text, p_resolve_open boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_next int;
  v_prev int;
  v_prev_paths text[];
  v_project uuid;
  v_reset int := 0;
  v_now timestamptz := now();
  v_note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
  v_actor text := nullif(left(trim(coalesce(p_actor, '')), 120), '');
  f jsonb;
begin
  if not public.is_staff() then raise exception 'Keine Berechtigung.' using errcode = '42501'; end if;
  if p_kind not in ('location', 'vehicle') then raise exception 'Unbekannte Art.'; end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then raise exception 'Keine Datei.'; end if;

  if p_kind = 'location' then
    select project_id into v_project from public.locations where id = p_owner;
    if v_project is null then raise exception 'Standort nicht gefunden.'; end if;
    perform 1 from public.locations where id = p_owner for update;
    select coalesce(max(version), 0) into v_next from public.location_pdfs where location_id = p_owner;
  else
    v_project := p_owner;
    perform 1 from public.projects where id = p_owner for update;
    if not found then raise exception 'Projekt nicht gefunden.'; end if;
    select coalesce(max(version), 0) into v_next from public.vehicle_layouts where project_id = p_owner;
  end if;
  select version, paths into v_prev, v_prev_paths from public.current_file_version(p_kind, p_owner);
  v_next := v_next + 1;

  if p_kind = 'location' then
    update public.location_pdfs set superseded_at = v_now where location_id = p_owner and superseded_at is null;
  else
    update public.vehicle_layouts set superseded_at = v_now where project_id = p_owner and superseded_at is null;
  end if;

  for f in select * from jsonb_array_elements(p_files) loop
    if coalesce(f->>'storage_path', '') = '' then raise exception 'Dateipfad fehlt.'; end if;
    if p_kind = 'location' then
      insert into public.location_pdfs(location_id, storage_path, file_name, uploaded_at, version, uploaded_by, version_note)
      values (p_owner, f->>'storage_path', coalesce(nullif(f->>'file_name', ''), 'Druckdatei'), v_now, v_next, v_actor, v_note);
    else
      insert into public.vehicle_layouts(project_id, storage_path, file_name, uploaded_at, version, uploaded_by, version_note)
      values (p_owner, f->>'storage_path', coalesce(nullif(f->>'file_name', ''), 'Layout'), v_now, v_next, v_actor, v_note);
    end if;
  end loop;

  if p_reset then
    perform set_config('app.approval_reset', '1', true);
    if p_kind = 'location' then
      update public.location_approvals set approved = false, approved_at = null where location_id = p_owner and approved;
    else
      update public.vehicle_layout_approval set approved = false, approved_at = null where project_id = p_owner and approved;
    end if;
    get diagnostics v_reset = row_count;
    perform set_config('app.approval_reset', '', true);
    if v_reset > 0 then
      insert into public.approval_events(kind, project_id, location_id, action, version, storage_paths, actor_name)
      values (p_kind, v_project, case when p_kind = 'location' then p_owner end, 'reset_new_version', v_next,
              (select array_agg(e->>'storage_path') from jsonb_array_elements(p_files) e), v_actor);
    end if;
  end if;

  -- Offene Markierungen der Vorversion als umgesetzt markieren (nur Top-Level mit Bezug auf eine Datei der Vorversion).
  if p_resolve_open and coalesce(array_length(v_prev_paths, 1), 0) > 0 then
    if p_kind = 'location' then
      update public.location_feedback set status = 'done', resolved_at = v_now
      where location_id = p_owner and parent_id is null and status = 'open' and media_ref->>'storagePath' = any(v_prev_paths);
    else
      update public.vehicle_layout_feedback set status = 'done', resolved_at = v_now
      where project_id = p_owner and parent_id is null and status = 'open' and media_ref->>'storagePath' = any(v_prev_paths);
    end if;
  end if;

  return jsonb_build_object(
    'version', v_next, 'previous_version', v_prev, 'reset', v_reset,
    'assignments', coalesce((select jsonb_agg(id) from public.customer_project_assignments where project_id = v_project), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.add_file_version(text, uuid, jsonb, boolean, text, text, boolean) from public, anon;
grant execute on function public.add_file_version(text, uuid, jsonb, boolean, text, text, boolean) to authenticated;

-- Loescht NUR die aktuelle Version (Zeilen); die naechstniedrigere wird wieder aktuell.
-- Gibt { deleted_version, restored_version, paths } zurueck – die Storage-Dateien entfernt der Client.
create or replace function public.delete_current_version(p_kind text, p_owner uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cur int;
  v_paths text[];
  v_restore int;
begin
  if not public.is_staff() then raise exception 'Keine Berechtigung.' using errcode = '42501'; end if;
  if p_kind = 'location' then
    perform 1 from public.locations where id = p_owner for update;
    select max(version), array_agg(storage_path) into v_cur, v_paths from public.location_pdfs where location_id = p_owner and superseded_at is null;
    if v_cur is null then return jsonb_build_object('deleted_version', null, 'restored_version', null, 'paths', '[]'::jsonb); end if;
    delete from public.location_pdfs where location_id = p_owner and superseded_at is null;
    select max(version) into v_restore from public.location_pdfs where location_id = p_owner;
    if v_restore is not null then
      update public.location_pdfs set superseded_at = null where location_id = p_owner and version = v_restore;
    end if;
  elsif p_kind = 'vehicle' then
    perform 1 from public.projects where id = p_owner for update;
    select max(version), array_agg(storage_path) into v_cur, v_paths from public.vehicle_layouts where project_id = p_owner and superseded_at is null;
    if v_cur is null then return jsonb_build_object('deleted_version', null, 'restored_version', null, 'paths', '[]'::jsonb); end if;
    delete from public.vehicle_layouts where project_id = p_owner and superseded_at is null;
    select max(version) into v_restore from public.vehicle_layouts where project_id = p_owner;
    if v_restore is not null then
      update public.vehicle_layouts set superseded_at = null where project_id = p_owner and version = v_restore;
    end if;
  else
    raise exception 'Unbekannte Art.';
  end if;
  return jsonb_build_object('deleted_version', v_cur, 'restored_version', v_restore, 'paths', to_jsonb(coalesce(v_paths, '{}')));
end;
$$;
revoke all on function public.delete_current_version(text, uuid) from public, anon;
grant execute on function public.delete_current_version(text, uuid) to authenticated;
