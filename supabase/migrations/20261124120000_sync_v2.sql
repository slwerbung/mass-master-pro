-- Sync v2 (Nov. 2026): Feldgenaues Zusammenfuehren auf dem Server,
-- Bilder mit Versionspfaden, Live-Aktualisierung zwischen Geraeten.
--
-- Warum: Der alte Sync schickte bei JEDER Aenderung das ganze Projekt
-- (alle Standorte, alle Felder) per upsert hoch. Ein zweites Geraet, das das
-- Projekt nur geoeffnet hatte, ueberschrieb damit Aenderungen anderer mit
-- seinem alten Stand – auch Bilder, weil die an festen Pfaden lagen
-- (images/<Standort>/annotated) und neue Fotos auf anderen Geraeten nie
-- ankamen (lokales Bild wurde nur geschrieben, wenn keines da war).
--
-- Neu:
--  * Jede Zeile traegt eine Revision (Trigger zaehlt hoch, auch bei
--    Aenderungen aus Edge Functions / Kundenansicht).
--  * Der Client schickt nur GEAENDERTE Felder, jeweils mit dem Wert, auf dem
--    seine Aenderung beruht (base). sync_push() uebernimmt ein Feld nur, wenn
--    es auf dem Server seitdem niemand anders geaendert hat; sonst meldet es
--    einen Konflikt (der Mitarbeiter entscheidet in der App).
--  * Bilder: jede neue Fassung bekommt einen NEUEN Pfad. sync_set_image()
--    setzt ihn nur, wenn der Server noch die Fassung hat, auf der die
--    Aenderung beruht. Keine Cache-Probleme, kein stilles Ueberschreiben.
--  * Realtime fuer projects/locations/floor_plans, damit offene Geraete
--    Aenderungen sofort sehen.

-- ── Revisionen ────────────────────────────────────────────────────────────
alter table public.projects        add column if not exists revision bigint not null default 1;
alter table public.locations       add column if not exists revision bigint not null default 1;
alter table public.location_images add column if not exists revision bigint not null default 1;
alter table public.detail_images   add column if not exists revision bigint not null default 1;
alter table public.floor_plans     add column if not exists revision bigint not null default 1;

create or replace function public.sync_bump_revision() returns trigger
language plpgsql as $$
begin
  new.revision := coalesce(old.revision, 0) + 1;
  return new;
end $$;

-- Standorte: updated_at ist ab jetzt Serverzeit (Handy-Uhren gehen falsch).
create or replace function public.sync_bump_location() returns trigger
language plpgsql as $$
begin
  new.revision := coalesce(old.revision, 0) + 1;
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['projects','location_images','detail_images','floor_plans'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_sync_revision', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.sync_bump_revision()', t || '_sync_revision', t);
  end loop;
end $$;
drop trigger if exists locations_sync_revision on public.locations;
create trigger locations_sync_revision before update on public.locations
  for each row execute function public.sync_bump_location();

-- ── Fehlende location_images-Zeilen nachtragen ────────────────────────────
-- Der alte Sync hat Bilder teils nur in den Speicher gelegt (feste Pfade),
-- ohne Zeile. Kundenansicht, PDF und Export lesen aber die Zeile.
insert into public.location_images (location_id, image_type, storage_path)
select l.id, m[2], o.name
  from storage.objects o
  cross join lateral regexp_match(o.name, '^images/([0-9a-f-]{36})/(annotated|original)$') m
  join public.locations l on l.id = m[1]::uuid
 where o.bucket_id = 'project-files'
   and m is not null
on conflict (location_id, image_type) do nothing;

-- ── Hilfsfunktionen ───────────────────────────────────────────────────────
-- Leere Werte gelten als gleich: null, JSON-null und "".
create or replace function public.sync_norm(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null or j = 'null'::jsonb or j = '""'::jsonb then null else j end
$$;

-- Grundriss-Markierungen: nie Konflikt. Was diese Seite seit base hinzugefuegt
-- bzw. entfernt hat, wird auf den aktuellen Serverstand angewendet (nach id).
create or replace function public.sync_merge_markers(p_base jsonb, p_mine jsonb, p_cur jsonb) returns jsonb
language plpgsql immutable as $$
declare
  base_ids text[] := coalesce((select array_agg(e->>'id') from jsonb_array_elements(coalesce(p_base,'[]')) e), '{}');
  mine_ids text[] := coalesce((select array_agg(e->>'id') from jsonb_array_elements(coalesce(p_mine,'[]')) e), '{}');
  removed  text[];
  result   jsonb;
begin
  removed := (select coalesce(array_agg(x), '{}') from unnest(base_ids) x where not x = any(mine_ids));
  -- aktueller Stand ohne die hier entfernten und ohne die hier geaenderten
  select coalesce(jsonb_agg(e), '[]') into result
    from jsonb_array_elements(coalesce(p_cur,'[]')) e
   where not (e->>'id') = any(removed)
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_mine,'[]')) m
        where m->>'id' = e->>'id'
          and not exists (select 1 from jsonb_array_elements(coalesce(p_base,'[]')) b where b->>'id' = m->>'id' and b = m)
     );
  -- hier neu hinzugefuegte bzw. geaenderte Markierungen anhaengen
  select result || coalesce(jsonb_agg(m), '[]') into result
    from jsonb_array_elements(coalesce(p_mine,'[]')) m
   where not exists (select 1 from jsonb_array_elements(coalesce(p_base,'[]')) b where b->>'id' = m->>'id' and b = m);
  return result;
end $$;

-- Wird ein Pfad noch gebraucht? (Freigabe-Nachweis, Kundenmarkierung, andere Zeile)
create or replace function public.sync_path_in_use(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_path is null
      or exists (select 1 from public.location_images where storage_path = p_path)
      or exists (select 1 from public.detail_images where annotated_path = p_path or original_path = p_path)
      or exists (select 1 from public.floor_plans where storage_path = p_path)
      or exists (select 1 from public.approval_events where p_path = any(storage_paths))
      or exists (select 1 from public.location_approvals where p_path = any(approved_paths))
      or exists (select 1 from public.location_feedback where media_ref->>'storagePath' = p_path)
$$;

-- ── sync_push ─────────────────────────────────────────────────────────────
-- p_kind:    project | location | detail | floor_plan
-- p_changes: { "<feld>": { "base": <wert>, "value": <wert> }, ... }
--            Feld = Spaltenname oder "cf.<schluessel>" fuer custom_fields.
-- p_create:  Spaltenwerte zum Anlegen, falls die Zeile fehlt (sonst null).
-- p_force:   Felder, die ohne Pruefung uebernommen werden (Konflikt wurde in
--            der App zugunsten der eigenen Fassung entschieden).
-- Ergebnis:  { status: ok|conflict|gone, row: {...}, conflicts: [{field, theirs}] }
--            Nicht widerspruechliche Felder werden auch bei "conflict" gespeichert.
create or replace function public.sync_push(
  p_kind text, p_id uuid, p_changes jsonb default '{}'::jsonb,
  p_create jsonb default null, p_force text[] default '{}'
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  tbl text;
  allowed text[];
  create_allowed text[];
  v_row jsonb;
  v_key text;
  v_change jsonb;
  v_col text;
  v_cf text;
  v_cur jsonb;
  v_base jsonb;
  v_val jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_cols text[] := '{}';
  v_parent uuid;
  v_ins_cols text[];
begin
  if not public.is_staff() then
    raise exception 'sync_push: nur fuer Mitarbeiter' using errcode = '42501';
  end if;

  case p_kind
    when 'project' then
      tbl := 'projects';
      allowed := array['project_number','project_type','customer_name','custom_fields'];
      create_allowed := allowed || array['id','user_id','employee_id','created_at'];
    when 'location' then
      tbl := 'locations';
      allowed := array['location_number','location_name','comment','system','label','location_type','guest_info','custom_fields'];
      create_allowed := allowed || array['id','project_id','created_at'];
    when 'detail' then
      tbl := 'detail_images';
      allowed := array['caption'];
      create_allowed := allowed || array['id','location_id','annotated_path','original_path','created_at'];
    when 'floor_plan' then
      tbl := 'floor_plans';
      allowed := array['name','page_index','markers'];
      create_allowed := allowed || array['id','project_id','storage_path','created_at'];
    else
      raise exception 'sync_push: unbekannte Art %', p_kind;
  end case;

  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', tbl) into v_row using p_id;

  if v_row is null then
    if p_create is null then
      return jsonb_build_object('status', 'gone');
    end if;
    p_create := p_create || jsonb_build_object('id', p_id);
    select array_agg(k) into v_ins_cols
      from jsonb_object_keys(p_create) k where k = any(create_allowed);
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (id) do nothing',
      tbl,
      (select string_agg(quote_ident(c), ',') from unnest(v_ins_cols) c),
      (select string_agg(quote_ident(c), ',') from unnest(v_ins_cols) c),
      tbl
    ) using p_create;
    execute format('select to_jsonb(t) from public.%I t where id = $1 for update', tbl) into v_row using p_id;
    if v_row is null then
      raise exception 'sync_push: Anlegen fehlgeschlagen (%: %)', tbl, p_id;
    end if;
  end if;

  for v_key, v_change in select * from jsonb_each(coalesce(p_changes, '{}'::jsonb)) loop
    if v_key like 'cf.%' then
      v_col := 'custom_fields';
      v_cf := substr(v_key, 4);
      v_cur := v_row->'custom_fields'->v_cf;
    else
      v_col := v_key;
      v_cf := null;
      v_cur := v_row->v_key;
    end if;
    if not (v_col = any(allowed)) then
      continue;
    end if;
    v_base := public.sync_norm(v_change->'base');
    v_val  := public.sync_norm(v_change->'value');
    v_cur  := public.sync_norm(v_cur);

    if v_key = 'markers' and not (v_key = any(p_force)) and v_cur is distinct from v_base then
      v_val := public.sync_merge_markers(v_base, v_val, v_cur);
    elsif not (v_key = any(p_force))
       and v_cur is distinct from v_base
       and v_cur is distinct from v_val then
      v_conflicts := v_conflicts || jsonb_build_object('field', v_key, 'theirs', v_cur);
      continue;
    end if;

    if v_cur is not distinct from v_val then
      continue;
    end if;

    if v_cf is not null then
      if v_val is null then
        v_row := jsonb_set(v_row, '{custom_fields}', coalesce(nullif(v_row->'custom_fields', 'null'::jsonb), '{}'::jsonb) - v_cf);
      else
        v_row := jsonb_set(v_row, '{custom_fields}', coalesce(nullif(v_row->'custom_fields', 'null'::jsonb), '{}'::jsonb) || jsonb_build_object(v_cf, v_val));
      end if;
    else
      v_row := jsonb_set(v_row, array[v_col], coalesce(v_val, 'null'::jsonb));
    end if;
    if not (v_col = any(v_cols)) then
      v_cols := v_cols || v_col;
    end if;
  end loop;

  if array_length(v_cols, 1) > 0 then
    execute format(
      'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where id = $2 returning to_jsonb(t)',
      tbl,
      (select string_agg(quote_ident(c), ',') from unnest(v_cols) c),
      (select string_agg(quote_ident(c), ',') from unnest(v_cols) c),
      tbl
    ) into v_row using v_row, p_id;
  end if;

  -- Detailbilder haengen am Standort: andere Geraete erfahren ueber dessen
  -- Revision (Realtime auf locations) von neuen/geaenderten Detailbildern.
  if p_kind = 'detail' then
    v_parent := (v_row->>'location_id')::uuid;
    update public.locations set updated_at = now() where id = v_parent;
  end if;

  return jsonb_build_object(
    'status', case when jsonb_array_length(v_conflicts) > 0 then 'conflict' else 'ok' end,
    'row', v_row,
    'conflicts', v_conflicts
  );
end $$;

-- ── sync_set_image ────────────────────────────────────────────────────────
-- p_kind: location (p_slot annotated|original) | detail (annotated|original)
-- Setzt den neuen Bildpfad nur, wenn der Server noch p_base hat (oder nichts).
-- Ergebnis: { status: ok|conflict|gone, theirs, old_path, old_deletable }
create or replace function public.sync_set_image(
  p_kind text, p_id uuid, p_slot text, p_path text, p_base text, p_force boolean default false
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_cur text;
  v_exists boolean;
  v_location uuid;
begin
  if not public.is_staff() then
    raise exception 'sync_set_image: nur fuer Mitarbeiter' using errcode = '42501';
  end if;
  if p_slot not in ('annotated', 'original') then
    raise exception 'sync_set_image: unbekannter Slot %', p_slot;
  end if;

  if p_kind = 'location' then
    perform 1 from public.locations where id = p_id for update;
    if not found then return jsonb_build_object('status', 'gone'); end if;
    select storage_path into v_cur from public.location_images where location_id = p_id and image_type = p_slot;
    v_location := p_id;
  elsif p_kind = 'detail' then
    select case when p_slot = 'annotated' then annotated_path else original_path end, location_id
      into v_cur, v_location
      from public.detail_images where id = p_id for update;
    if not found then return jsonb_build_object('status', 'gone'); end if;
  else
    raise exception 'sync_set_image: unbekannte Art %', p_kind;
  end if;

  if not p_force and v_cur is not null and v_cur is distinct from p_base and v_cur is distinct from p_path then
    return jsonb_build_object('status', 'conflict', 'theirs', v_cur);
  end if;

  if v_cur is distinct from p_path then
    if p_kind = 'location' then
      insert into public.location_images (location_id, image_type, storage_path)
      values (p_id, p_slot, p_path)
      on conflict (location_id, image_type) do update set storage_path = excluded.storage_path;
    elsif p_slot = 'annotated' then
      update public.detail_images set annotated_path = p_path where id = p_id;
    else
      update public.detail_images set original_path = p_path where id = p_id;
    end if;
    update public.locations set updated_at = now() where id = v_location;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'old_path', case when v_cur is distinct from p_path then v_cur end,
    'old_deletable', v_cur is not null and v_cur is distinct from p_path and not public.sync_path_in_use(v_cur)
  );
end $$;

-- ── sync_delete ───────────────────────────────────────────────────────────
-- Loescht einen Standort / ein Detailbild / einen Grundriss samt abhaengiger
-- Zeilen und gibt die Speicherpfade zurueck, die danach frei sind.
create or replace function public.sync_delete(p_kind text, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_paths text[] := '{}';
  v_free text[];
  v_location uuid;
begin
  if not public.is_staff() then
    raise exception 'sync_delete: nur fuer Mitarbeiter' using errcode = '42501';
  end if;

  if p_kind = 'location' then
    select v_paths
         || coalesce((select array_agg(storage_path) from public.location_images where location_id = p_id), '{}')
         || coalesce((select array_agg(p) from public.detail_images d, unnest(array[d.annotated_path, d.original_path]) p where d.location_id = p_id), '{}')
         || coalesce((select array_agg(storage_path) from public.location_pdfs where location_id = p_id), '{}')
         || array['images/' || p_id || '/annotated', 'images/' || p_id || '/original']
      into v_paths;
    delete from public.location_feedback where location_id = p_id;
    delete from public.location_approvals where location_id = p_id;
    delete from public.location_pdfs where location_id = p_id;
    delete from public.detail_images where location_id = p_id;
    delete from public.location_images where location_id = p_id;
    delete from public.locations where id = p_id;
  elsif p_kind = 'detail' then
    select array[annotated_path, original_path], location_id into v_paths, v_location
      from public.detail_images where id = p_id;
    delete from public.detail_images where id = p_id;
    if v_location is not null then
      update public.locations set updated_at = now() where id = v_location;
    end if;
  elsif p_kind = 'floor_plan' then
    select array[storage_path] into v_paths from public.floor_plans where id = p_id;
    delete from public.floor_plans where id = p_id;
  else
    raise exception 'sync_delete: unbekannte Art %', p_kind;
  end if;

  select coalesce(array_agg(distinct p), '{}') into v_free
    from unnest(coalesce(v_paths, '{}')) p
   where p is not null and not public.sync_path_in_use(p);
  return jsonb_build_object('status', 'ok', 'free_paths', to_jsonb(v_free));
end $$;

grant execute on function public.sync_push(text, uuid, jsonb, jsonb, text[]) to authenticated;
grant execute on function public.sync_set_image(text, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.sync_delete(text, uuid) to authenticated;
revoke execute on function public.sync_push(text, uuid, jsonb, jsonb, text[]) from anon;
revoke execute on function public.sync_set_image(text, uuid, text, text, text, boolean) from anon;
revoke execute on function public.sync_delete(text, uuid) from anon;
revoke execute on function public.sync_path_in_use(text) from anon;

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Realtime prueft RLS: Mitarbeiter sehen alles, Kunden nur ihre Projekte.
do $$
declare t text;
begin
  foreach t in array array['projects','locations','floor_plans'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
