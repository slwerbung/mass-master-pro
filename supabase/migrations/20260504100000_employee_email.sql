-- Notification routing capability:
--   1) Each employee can have an email address. Employees with an email
--      can receive project-specific notifications when the project is
--      assigned to them; employees without an email simply don't.
--   2) The notifications themselves (which events fire, where they go)
--      are configured globally in app_config under the "notification_settings"
--      key as a JSON blob.
--
-- We add the email column nullable so existing employees stay valid.
-- Email format is not enforced at the DB level (trim/validate in app).

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS email TEXT NULL;

COMMENT ON COLUMN employees.email IS
  'Optional email address for receiving project-specific notifications. Employees without an email cannot be the per-project notification target; the global notification email is used as fallback in that case.';
