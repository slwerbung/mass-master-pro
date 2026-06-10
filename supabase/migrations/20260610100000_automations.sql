-- Automations: data-driven "when X, do Y" rules.
--
-- No automation logic is hardcoded. Triggers and actions are described by a
-- registry in code (src/lib/automationRegistry.ts for the UI, ACTION_HANDLERS
-- in _shared/automations.ts for execution). Each rule is one row here with
-- its trigger/action config as JSONB. Adding a new case = a new row + (if a
-- new action type) a new handler — no schema change.
--
-- tenant_id is reserved for the future multi-tenant split (NULL = the current
-- single tenant). When multi-tenant lands, scope queries by tenant_id.
--
-- Access model: everything goes through Edge Functions with the service role
-- (admin-manage for CRUD, run-automations for execution). RLS is enabled with
-- NO anon/authenticated policies, so the anon key is denied by default;
-- service_role bypasses RLS. Therefore no Data-API GRANTs are needed.

create table if not exists public.automations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid,
  name          text not null,
  enabled       boolean not null default true,
  trigger_type  text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  action_type   text not null,
  action_config jsonb not null default '{}'::jsonb,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists automations_trigger_idx
  on public.automations (trigger_type) where enabled;

create table if not exists public.automation_runs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid,
  automation_id   uuid references public.automations(id) on delete set null,
  automation_name text,
  trigger_type    text,
  action_type     text,
  status          text not null,        -- 'success' | 'error' | 'skipped'
  message         text,
  context         jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists automation_runs_created_idx
  on public.automation_runs (created_at desc);

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;

comment on table public.automations is
  'Data-driven automation rules (trigger -> action). Managed via admin-manage, executed via run-automations. Service-role only.';
comment on table public.automation_runs is
  'Execution log for automations (success/error/skipped) for transparency in the Admin UI.';
