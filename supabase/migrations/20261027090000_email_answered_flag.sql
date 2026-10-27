-- Mail-Assistent: „beantwortet“ / „weitergeleitet“ pro Mail (wie im Mailprogramm).
--
-- Gesetzt automatisch ueber zwei Wege, ohne dass eine Edge Function davon wissen muss:
--  1. Eine ausgehende Mail (aus dem Gesendet-Ordner synchronisiert, also auch aus Thunderbird/Handy) traegt
--     In-Reply-To = Message-ID einer eingegangenen Mail -> diese ist beantwortet.
--  2. Aus der Mail-App gesendet (email_sent.reply_to / forward_of) -> sofort, ohne auf den Sync zu warten.
--
-- `user_forwarded_at` ist bewusst NICHT `forwarded_at`: das gehoert der Beleg-Weiterleitung an Lexware
-- (forward.ts) – gesetzt heisst dort „schon weitergeleitet, nie wieder“.

alter table public.email_messages
  add column if not exists answered_at timestamptz,
  add column if not exists user_forwarded_at timestamptz;

create or replace function public.email_mark_answered_from_message()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.direction = 'out' and new.in_reply_to is not null then
    update public.email_messages
       set answered_at = coalesce(answered_at, new.sent_at, now())
     where message_id = new.in_reply_to and direction = 'in' and answered_at is null;
  end if;
  return new;
end $$;

drop trigger if exists email_messages_mark_answered on public.email_messages;
create trigger email_messages_mark_answered
  after insert on public.email_messages
  for each row execute function public.email_mark_answered_from_message();

create or replace function public.email_mark_answered_from_sent()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.reply_to is not null then
    update public.email_messages set answered_at = coalesce(answered_at, new.sent_at, now()) where id = new.reply_to;
  end if;
  if new.forward_of is not null then
    update public.email_messages set user_forwarded_at = coalesce(user_forwarded_at, new.sent_at, now()) where id = new.forward_of;
  end if;
  return new;
end $$;

drop trigger if exists email_sent_mark_answered on public.email_sent;
create trigger email_sent_mark_answered
  after insert on public.email_sent
  for each row execute function public.email_mark_answered_from_sent();

revoke all on function public.email_mark_answered_from_message() from public, anon, authenticated;
revoke all on function public.email_mark_answered_from_sent() from public, anon, authenticated;

-- Bestand nachtragen
update public.email_messages i
   set answered_at = o.first_reply
  from (select in_reply_to, min(coalesce(sent_at, created_at)) as first_reply
          from public.email_messages where direction = 'out' and in_reply_to is not null group by in_reply_to) o
 where i.message_id = o.in_reply_to and i.direction = 'in' and i.answered_at is null;

update public.email_messages m set answered_at = coalesce(m.answered_at, s.sent_at)
  from public.email_sent s where s.reply_to = m.id;
update public.email_messages m set user_forwarded_at = coalesce(m.user_forwarded_at, s.sent_at)
  from public.email_sent s where s.forward_of = m.id;
