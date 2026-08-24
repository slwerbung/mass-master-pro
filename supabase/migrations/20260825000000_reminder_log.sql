-- Lightweight audit log for reminder emails: when and to whom a reminder was
-- sent (or why it was skipped). Written by the send-reminders edge function,
-- read by admin-manage for the Admin panel. Operational data, so no anon
-- policy — only service-role edge functions touch it.
CREATE TABLE IF NOT EXISTS public.reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid,
  project_number text,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'sent', -- 'sent' | 'error'
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_reminder_log_created ON public.reminder_log (created_at DESC);
