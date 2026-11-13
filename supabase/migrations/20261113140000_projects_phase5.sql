-- Projekte Phase 5 (Verzahnung): WIP-Limit je Status (Fluss-Ansicht) und die Regel "Kundenmail unbeantwortet".
alter table public.project_step_settings add column if not exists wip_limit integer check (wip_limit is null or wip_limit >= 0);

-- Kundenmail zum Projekt seit mehr als `threshold_days` (2) unbeantwortet -> Karte der Kategorie "kunde" (Vorschlag: Antworten).
insert into public.project_rules (key, label, category, threshold_days, suggestion, channel, followup_days, followup_reason, autopilot, sort, active)
values ('kunde_mail_offen', 'Kundenmail unbeantwortet', 'kunde', 2, 'Antworten', 'api', 2, 'Antwort nachfassen', 'off', 8, true)
on conflict (key) do nothing;
