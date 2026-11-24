-- Tests fuer sync_v2 (lokal: stub_schema + Migration, dann diese Datei).
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond,false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;

-- Projekt + Standort anlegen
select pg_temp.check((public.sync_push('project','11111111-1111-1111-1111-111111111111','{}', '{"project_number":"P1","user_id":"11111111-1111-1111-1111-111111111111","custom_fields":{"a":"1"}}'))->>'status' = 'ok', 'project create');
select pg_temp.check((public.sync_push('location','22222222-2222-2222-2222-222222222222','{"comment":{"base":null,"value":"hallo"}}', '{"project_id":"11111111-1111-1111-1111-111111111111","location_number":"1"}'))->'row'->>'comment' = 'hallo', 'location create + change');

-- Geraet A aendert Kommentar, Geraet B (alter Stand) aendert Name: beides bleibt
select public.sync_push('location','22222222-2222-2222-2222-222222222222','{"comment":{"base":"hallo","value":"A"}}');
select pg_temp.check((public.sync_push('location','22222222-2222-2222-2222-222222222222','{"location_name":{"base":null,"value":"B"}}'))->>'status' = 'ok', 'different fields merge');
select pg_temp.check((select comment = 'A' and location_name = 'B' from locations where id='22222222-2222-2222-2222-222222222222'), 'both changes kept');

-- B aendert Kommentar auf altem Stand -> Konflikt, nichts ueberschrieben
select pg_temp.check((public.sync_push('location','22222222-2222-2222-2222-222222222222','{"comment":{"base":"hallo","value":"B2"}}'))->>'status' = 'conflict', 'same field conflict');
select pg_temp.check((select comment from locations where id='22222222-2222-2222-2222-222222222222') = 'A', 'conflict did not overwrite');
-- B entscheidet sich fuer seine Fassung
select pg_temp.check((public.sync_push('location','22222222-2222-2222-2222-222222222222','{"comment":{"base":"hallo","value":"B2"}}', null, array['comment']))->>'status' = 'ok', 'force');
select pg_temp.check((select comment from locations where id='22222222-2222-2222-2222-222222222222') = 'B2', 'force applied');

-- custom_fields pro Schluessel
select public.sync_push('location','22222222-2222-2222-2222-222222222222','{"cf.x":{"base":null,"value":"1"}}');
select public.sync_push('location','22222222-2222-2222-2222-222222222222','{"cf.y":{"base":null,"value":"2"}}');
select pg_temp.check((select custom_fields = '{"x":"1","y":"2"}' from locations where id='22222222-2222-2222-2222-222222222222'), 'cf keys merged');
select public.sync_push('location','22222222-2222-2222-2222-222222222222','{"cf.x":{"base":"1","value":null}}');
select pg_temp.check((select custom_fields = '{"y":"2"}' from locations where id='22222222-2222-2222-2222-222222222222'), 'cf key removed');
-- "" gleich null
select pg_temp.check((public.sync_push('location','22222222-2222-2222-2222-222222222222','{"label":{"base":"","value":"L"}}'))->>'status' = 'ok', 'empty string equals null');

-- Revision zaehlt, updated_at Serverzeit
select pg_temp.check((select revision > 1 from locations where id='22222222-2222-2222-2222-222222222222'), 'revision bumped');

-- Bilder
select pg_temp.check((public.sync_set_image('location','22222222-2222-2222-2222-222222222222','annotated','images/x/a1',null))->>'status' = 'ok', 'image first');
select pg_temp.check((public.sync_set_image('location','22222222-2222-2222-2222-222222222222','annotated','images/x/a2','images/x/a1'))->>'old_deletable' = 'true', 'image replace frees old');
select pg_temp.check((public.sync_set_image('location','22222222-2222-2222-2222-222222222222','annotated','images/x/b1','images/x/a1'))->>'status' = 'conflict', 'image conflict on stale base');
select pg_temp.check((select storage_path from location_images where location_id='22222222-2222-2222-2222-222222222222') = 'images/x/a2', 'image not overwritten');
insert into approval_events(storage_paths) values (array['images/x/a2']);
select pg_temp.check((public.sync_set_image('location','22222222-2222-2222-2222-222222222222','annotated','images/x/b1','images/x/a1', true))->>'old_deletable' = 'false', 'approved path protected');

-- Detailbild
select pg_temp.check((public.sync_push('detail','33333333-3333-3333-3333-333333333333','{}', '{"location_id":"22222222-2222-2222-2222-222222222222","annotated_path":"d/a","original_path":"d/o","caption":"c"}'))->>'status'='ok', 'detail create');
select pg_temp.check((public.sync_set_image('detail','33333333-3333-3333-3333-333333333333','annotated','d/a2','d/a'))->>'status'='ok', 'detail image');

-- Grundriss-Markierungen: nie Konflikt
select public.sync_push('floor_plan','44444444-4444-4444-4444-444444444444','{}', '{"project_id":"11111111-1111-1111-1111-111111111111","storage_path":"f","markers":[{"id":"m1"}]}');
select public.sync_push('floor_plan','44444444-4444-4444-4444-444444444444','{"markers":{"base":[{"id":"m1"}],"value":[{"id":"m1"},{"id":"m2"}]}}');
select pg_temp.check((public.sync_push('floor_plan','44444444-4444-4444-4444-444444444444','{"markers":{"base":[{"id":"m1"}],"value":[{"id":"m3"}]}}'))->>'status'='ok', 'markers merge no conflict');
select pg_temp.check((select markers @> '[{"id":"m2"},{"id":"m3"}]' and not markers @> '[{"id":"m1"}]' from floor_plans where id='44444444-4444-4444-4444-444444444444'), 'markers: m1 removed, m2 kept, m3 added');

-- gone
select pg_temp.check((public.sync_push('location','55555555-5555-5555-5555-555555555555','{"comment":{"base":null,"value":"x"}}'))->>'status'='gone', 'gone');

-- Loeschen
select pg_temp.check(jsonb_array_length((public.sync_delete('location','22222222-2222-2222-2222-222222222222'))->'free_paths') >= 1, 'delete returns free paths');
select pg_temp.check(not exists(select 1 from locations where id='22222222-2222-2222-2222-222222222222'), 'location deleted');

-- Nicht-Mitarbeiter
set test.staff = 'false';
do $$ begin perform public.sync_push('project','11111111-1111-1111-1111-111111111111','{}'); raise exception 'FAIL: non-staff allowed'; exception when insufficient_privilege then raise notice 'ok: non-staff rejected'; end $$;
