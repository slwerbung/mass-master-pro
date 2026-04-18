-- Seed standard built-in project fields.
-- These two are protected in the admin-manage edge function:
-- they cannot be edited (except toggling is_active) or deleted.
--
-- projectNumber is a combined field holding "<number> <n>" – the primary
-- field asked for when creating a project. customerName is the customer pick.

-- Ensure the unique constraint on field_key exists before ON CONFLICT.
-- Older DBs may have the table without the inline UNIQUE (e.g. when the
-- table was created by "create table if not exists" while a stub version
-- without the constraint existed). Idempotent: does nothing if constraint
-- is already there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'project_field_config'
      AND c.contype = 'u'
      AND c.conkey = (
        SELECT array_agg(attnum)
        FROM pg_attribute
        WHERE attrelid = t.oid AND attname = 'field_key'
      )
  ) THEN
    -- Also drop any duplicates first, keeping the oldest row per key, so the
    -- constraint can be added without errors.
    DELETE FROM public.project_field_config a
    USING public.project_field_config b
    WHERE a.field_key = b.field_key
      AND a.created_at > b.created_at;

    ALTER TABLE public.project_field_config
      ADD CONSTRAINT project_field_config_field_key_key UNIQUE (field_key);
  END IF;
END
$$;

insert into public.project_field_config
  (field_key, field_label, field_type, sort_order, is_active, applies_to, is_required)
values
  ('projectNumber', 'Projektnummer / Projektname', 'text', 0, true, 'all', true)
on conflict (field_key) do update set
  field_label = excluded.field_label,
  field_type  = excluded.field_type,
  sort_order  = excluded.sort_order,
  is_required = excluded.is_required;

-- Make sure customerName exists and is ordered right after projectNumber.
-- Earlier migration (20260331120000) already inserts it, so ON CONFLICT just
-- normalises the sort_order and keeps is_active / is_required untouched for
-- anyone who adjusted them.
insert into public.project_field_config
  (field_key, field_label, field_type, sort_order, is_active, applies_to, is_required)
values
  ('customerName', 'Kunde', 'text', 10, true, 'all', false)
on conflict (field_key) do update set
  sort_order = excluded.sort_order;
