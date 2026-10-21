-- KI-Mail-Assistent: Mail-Ansicht mit HTML und „Löschen" = in den Papierkorb des Postfachs verschieben.
--
-- body_html: Zwischenspeicher fuer die HTML-Ansicht (wird beim ersten Oeffnen aus dem Postfach geholt,
--   Edge Function `email-mailbox`). Faellt wie body_text nach `retention_days` weg.
-- trashed_at: in den Papierkorb verschoben (IMAP MOVE, nie \Deleted/expunge). Die Liste blendet diese Mails
--   aus; Ansicht „Papierkorb" zeigt sie, „Wiederherstellen" schiebt sie zurueck in den Posteingang.

alter table public.email_messages
  add column if not exists body_html text,
  add column if not exists trashed_at timestamptz;

create index if not exists email_messages_trashed_idx on public.email_messages (trashed_at) where trashed_at is not null;

create or replace function public.email_retention() returns void
language plpgsql security definer set search_path = public, storage as $$
declare
  days integer := coalesce((select (value #>> '{}')::integer from public.email_config where key = 'retention_days'), 180);
  cutoff timestamptz := now() - make_interval(days => days);
begin
  delete from storage.objects
  where bucket_id = 'email-attachments'
    and name in (
      select a.storage_path from public.email_attachments a
      join public.email_messages m on m.id = a.message_id
      where a.storage_path is not null and coalesce(m.sent_at, m.created_at) < cutoff
    );
  update public.email_attachments a
     set storage_path = null
    from public.email_messages m
   where m.id = a.message_id and a.storage_path is not null and coalesce(m.sent_at, m.created_at) < cutoff;
  update public.email_messages
     set body_text = null, body_html = null
   where (body_text is not null or body_html is not null) and coalesce(sent_at, created_at) < cutoff;
  delete from public.email_ai_calls where created_at < now() - interval '400 days';
  delete from public.email_runs where started_at < now() - interval '90 days';
end $$;
revoke all on function public.email_retention() from public, anon, authenticated;
grant execute on function public.email_retention() to service_role;
