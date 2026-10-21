-- KI-Mail-Assistent: Wissensdatei und Freitext-Korrekturen (docs/mail-assistent/betrieb.md).
--
-- email_knowledge: Saetze, die Mitarbeiter dem Assistenten beibringen. Gilt fuer alle Mails
-- (from_pattern null) oder nur fuer einen Absender (a@b.de) bzw. eine Domain (@b.de). Fliesst in
-- „Verstehen" und die Projektwahl ein (_shared/email/knowledge.ts).
-- email_messages.correction_note: „Was waere richtig?" zu genau dieser Mail; hat beim erneuten
-- Verarbeiten Vorrang (auch vor Absenderregeln).
--
-- Wie alle email_*-Tabellen: RLS an, keine Policy, kein Grant fuer anon/authenticated.

create table if not exists public.email_knowledge (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 3 and 1000),
  from_pattern text,
  source text not null default 'manuell' check (source in ('manuell', 'korrektur')),
  -- Mail, aus deren Korrektur der Eintrag entstand
  message_id uuid references public.email_messages(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_knowledge_active_idx on public.email_knowledge (active, created_at desc);

alter table public.email_knowledge enable row level security;
revoke all on public.email_knowledge from anon, authenticated;
grant all on public.email_knowledge to service_role;

alter table public.email_messages add column if not exists correction_note text;
