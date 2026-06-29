-- Dedup marker for the "project fully approved → upload Aufmaß-PDF to HERO"
-- automation. Set when the automation has fired for an assignment's
-- completion; cleared if the project later becomes incomplete again so a
-- fresh completion re-fires. Independent of completion_sent_at (which gates
-- the e-mail notification) so the HERO upload no longer depends on whether
-- the completion e-mail is enabled.
ALTER TABLE public.customer_notifications
  ADD COLUMN IF NOT EXISTS hero_pdf_sent_at timestamptz;
