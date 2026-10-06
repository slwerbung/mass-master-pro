-- KI-Mail-Assistent, Phase 3: Entwuerfe und Anhaenge.

alter table public.email_messages
  -- Der Entwurf wird IMMER hier gespeichert (auch im Schattenmodus, wo er nicht ins Postfach geschrieben wird),
  -- damit die Mail-App ihn zeigen und bearbeiten kann.
  add column if not exists draft_text text,
  add column if not exists draft_subject text,
  add column if not exists draft_written_at timestamptz,
  add column if not exists draft_uid bigint;

alter table public.email_attachments
  add column if not exists hero_uploaded_at timestamptz;
