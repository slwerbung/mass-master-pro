-- Mail-App ersetzt Thunderbird: Mails verfassen/beantworten/weiterleiten und senden (email-send).

-- HTML-Signatur je Postfach (wird an gesendete Mails gehaengt)
alter table public.email_accounts add column if not exists signature_html text;

-- Protokoll aller aus der App gesendeten Mails (nur service_role)
create table if not exists public.email_sent (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  message_id text not null,
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  bcc_count integer not null default 0,
  subject text not null default '',
  reply_to uuid references public.email_messages(id) on delete set null,
  forward_of uuid references public.email_messages(id) on delete set null,
  attachment_count integer not null default 0,
  sent_by uuid,
  sent_folder_uid bigint,
  warnings text[] not null default '{}',
  sent_at timestamptz not null default now()
);
create index if not exists email_sent_account_idx on public.email_sent (account_id, sent_at desc);
alter table public.email_sent enable row level security;
revoke all on public.email_sent from anon, authenticated;
