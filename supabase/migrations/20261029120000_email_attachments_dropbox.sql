-- Mail-Assistent: Anhaenge per Klick in den Dropbox-Projektordner (email-action `dropbox_save`).
-- Gemerkt wird, wohin eine Datei abgelegt wurde – die Mail-App zeigt es an.
alter table public.email_attachments
  add column if not exists dropbox_path text,
  add column if not exists dropbox_saved_at timestamptz;
