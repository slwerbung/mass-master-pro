-- Allow NULL in app_config.value.
--
-- The original schema required NOT NULL on `value`, but several config
-- entries (privacy_policy_url, notification_global_email, company_logo)
-- need a way to express "unset / cleared". With NOT NULL the only option
-- is to store an empty string, which mixes "explicitly empty" with "not
-- configured". Allowing NULL gives us a clean tri-state and lets upsert
-- with NULL succeed instead of erroring out the edge function.

ALTER TABLE public.app_config
  ALTER COLUMN value DROP NOT NULL;
