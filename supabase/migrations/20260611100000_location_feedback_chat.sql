-- Turn location_feedback into a two-way chat thread per location.
-- author_type distinguishes who wrote a message so the UI can render it as a
-- chat (employee on one side, customer/guest on the other). Existing rows
-- default to 'customer'.

ALTER TABLE public.location_feedback
  ADD COLUMN IF NOT EXISTS author_type TEXT NOT NULL DEFAULT 'customer';

-- Constrain to the known author types (drop first so re-runs are safe).
ALTER TABLE public.location_feedback DROP CONSTRAINT IF EXISTS location_feedback_author_type_chk;
ALTER TABLE public.location_feedback
  ADD CONSTRAINT location_feedback_author_type_chk
  CHECK (author_type IN ('customer', 'guest', 'employee'));

-- Employees write directly with the anon key (RLS already allows anon).
-- Add explicit GRANTs ahead of the Supabase Data API change (30.10.2026)
-- so anon access keeps working once implicit grants are removed.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_feedback TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_feedback TO authenticated, service_role;
