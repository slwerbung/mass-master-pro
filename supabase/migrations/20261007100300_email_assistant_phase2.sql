-- KI-Mail-Assistent, Phase 2: Zuordnung, Sortieren, Logbuch.

alter table public.email_messages
  -- UID im AKTUELLEN Ordner (nach dem Verschieben aendert sie sich).
  add column if not exists current_uid bigint,
  -- Was der Assistent getan hat bzw. im Schattenmodus tun WUERDE:
  -- [{ action, decision: auto|suggest|shadow|skip, done, detail }]
  add column if not exists plan jsonb not null default '[]'::jsonb,
  -- Ergebnis der Zuordnung: { certain, knownContact, reason, projectNr, projectName, stepId, candidates[] }
  add column if not exists match_info jsonb not null default '{}'::jsonb;

update public.email_messages set current_uid = uid where current_uid is null;

-- Pro Mail und Art hoechstens ein OFFENER Vorschlag: so entstehen bei einem
-- Wiederholungslauf keine Dubletten.
create unique index if not exists email_suggestions_one_open
  on public.email_suggestions (message_id, type) where status = 'offen';

create index if not exists email_messages_matchable_idx
  on public.email_messages (account_id, status) where status in ('klassifiziert', 'zugeordnet', 'ohne_bezug');
