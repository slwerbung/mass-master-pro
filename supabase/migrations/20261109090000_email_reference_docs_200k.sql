-- Referenzwissen: ein Dokument darf bis 200.000 Zeichen haben (vorher 60.000 – die Angebots-Skill-Datei passte nicht).
-- Pro KI-Aufruf liest store.ts › loadReference weiter nur einen Ausschnitt (Angebot/AB 120.000, sonst 8.000).
alter table public.email_reference_docs drop constraint if exists email_reference_docs_content_check;
alter table public.email_reference_docs add constraint email_reference_docs_content_check check (char_length(content) <= 200000);
