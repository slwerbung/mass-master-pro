-- Gesprächsnotiz: To-dos getrennt für uns und für den Kunden.
-- Das Ergebnisprotokoll (summary) bleibt; action_plan wird für Projekt-Notizen
-- weiter als kombinierte Ansicht befüllt. Beide Spalten nullable (Alt-Notizen
-- und Standalone-Protokolle haben sie nicht).
alter table public.meeting_notes add column if not exists todos_internal text;
alter table public.meeting_notes add column if not exists todos_customer text;
