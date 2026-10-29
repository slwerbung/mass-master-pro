-- Mail-Assistent: Themen statt einzelner Mails.
--
-- Ein Thema = ein Gespraechsverlauf (email_threads). Jede eingehende Mail (ausser den in email_config.topics
-- ausgeschlossenen Kategorien, Standard: Werbung/Spam und Newsletter) wird EINMAL zur Entscheidung vorgelegt
-- (`email_messages.decided_at`). Danach laeuft das Thema weiter, liegt auf Wiedervorlage oder ist abgeschlossen
-- (`email_threads.topic_state`). Laufende Themen ueberwacht die Mail-App (`_shared/email/topics.ts`): unbeantwortet
-- oder ohne Bewegung -> wieder „Zu entscheiden“. Eine neue Mail in einem abgeschlossenen Thema legt es wieder vor.
--
-- Als entschieden gilt eine Mail automatisch, wenn
--  1. im Thema eine Antwort rausgeht (aus dem Gesendet-Ordner synchronisiert ODER aus der Mail-App gesendet),
--  2. sie aus der Mail-App weitergeleitet wird,
--  3. ein Vorschlag zu ihr erfolgreich ausgefuehrt wurde (Ergebnis gespeichert, nicht schon beim Beanspruchen).
-- Alles andere entscheidet der Mensch in der Mail-App (email-api `topic_decide`, Anweisung in email-action).

alter table public.email_threads
  add column if not exists topic_state text not null default 'aktiv',
  add column if not exists snoozed_until timestamptz,
  add column if not exists topic_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists closed_at timestamptz;

do $$ begin
  alter table public.email_threads add constraint email_threads_topic_state_check
    check (topic_state in ('aktiv', 'wiedervorlage', 'erledigt'));
exception when duplicate_object then null; end $$;

alter table public.email_messages
  add column if not exists decided_at timestamptz,
  add column if not exists decision text;

create index if not exists email_messages_undecided_idx on public.email_messages (thread_id)
  where direction = 'in' and decided_at is null;
create index if not exists email_threads_topic_idx on public.email_threads (topic_state, snoozed_until);

-- Antwort im Thema: alles, was bis dahin eingegangen ist, gilt als entschieden.
create or replace function public.email_topic_mark_answered(p_thread uuid, p_until timestamptz, p_decision text)
returns void language sql set search_path = public as $$
  update public.email_messages set decided_at = now(), decision = p_decision
   where thread_id = p_thread and direction = 'in' and decided_at is null and coalesce(sent_at, created_at) <= p_until;
  update public.email_threads set reviewed_at = now() where id = p_thread;
$$;

create or replace function public.email_topic_from_message()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.direction = 'out' and new.thread_id is not null then
    perform public.email_topic_mark_answered(new.thread_id, coalesce(new.sent_at, new.created_at, now()), 'beantwortet');
  end if;
  return new;
end $$;

drop trigger if exists email_messages_topic on public.email_messages;
create trigger email_messages_topic
  after insert on public.email_messages
  for each row execute function public.email_topic_from_message();

create or replace function public.email_topic_from_sent()
returns trigger language plpgsql set search_path = public as $$
declare t uuid;
begin
  if new.reply_to is not null then
    select thread_id into t from public.email_messages where id = new.reply_to;
    if t is not null then
      perform public.email_topic_mark_answered(t, new.sent_at, 'beantwortet');
    else
      update public.email_messages set decided_at = coalesce(decided_at, now()), decision = coalesce(decision, 'beantwortet') where id = new.reply_to;
    end if;
  end if;
  if new.forward_of is not null then
    update public.email_messages set decided_at = now(), decision = 'weitergeleitet' where id = new.forward_of and decided_at is null;
  end if;
  return new;
end $$;

drop trigger if exists email_sent_topic on public.email_sent;
create trigger email_sent_topic
  after insert on public.email_sent
  for each row execute function public.email_topic_from_sent();

-- Vorschlag ausgefuehrt: erst wenn das Ergebnis da ist (beim Beanspruchen bleibt `result` unveraendert).
create or replace function public.email_topic_from_suggestion()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'angenommen' and new.result is not null and new.result is distinct from old.result then
    update public.email_messages set decided_at = now(), decision = 'vorschlag' where id = new.message_id and decided_at is null;
    update public.email_threads set reviewed_at = now()
     where id = (select thread_id from public.email_messages where id = new.message_id);
  end if;
  return new;
end $$;

drop trigger if exists email_suggestions_topic on public.email_suggestions;
create trigger email_suggestions_topic
  after update on public.email_suggestions
  for each row execute function public.email_topic_from_suggestion();

revoke all on function public.email_topic_mark_answered(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.email_topic_from_message() from public, anon, authenticated;
revoke all on function public.email_topic_from_sent() from public, anon, authenticated;
revoke all on function public.email_topic_from_suggestion() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bestand: nicht alles auf einmal vorlegen.
--  * beantwortet / per Vorschlag erledigt -> entschieden
--  * aelter als 3 Tage -> entschieden („altbestand“); Themen ohne Kundenkategorie gelten als abgeschlossen,
--    Kundenthemen laufen weiter (unbeantwortete legt die Ueberwachung sofort vor, beantwortete erst nach der Frist)
--  * die letzten 3 Tage bleiben offen und erscheinen unter „Zu entscheiden“
-- ---------------------------------------------------------------------------
update public.email_messages i set decided_at = now(), decision = 'beantwortet'
 where i.direction = 'in' and i.decided_at is null and exists (
   select 1 from public.email_messages o
    where o.thread_id = i.thread_id and o.direction = 'out'
      and coalesce(o.sent_at, o.created_at) >= coalesce(i.sent_at, i.created_at));

update public.email_messages m set decided_at = now(), decision = 'vorschlag'
 where m.direction = 'in' and m.decided_at is null
   and exists (select 1 from public.email_suggestions s where s.message_id = m.id and s.status = 'angenommen');

update public.email_messages set decided_at = now(), decision = 'altbestand'
 where direction = 'in' and decided_at is null and coalesce(sent_at, created_at) < now() - interval '3 days';

update public.email_threads t set topic_state = 'erledigt', closed_at = now(), reviewed_at = now()
 where not exists (
   select 1 from public.email_messages m
    where m.thread_id = t.id and m.direction = 'in' and m.trashed_at is null
      and (m.category in ('anfrage_neu', 'projekt_kommunikation', 'layout_freigabe', 'auftrag', 'reklamation')
           or coalesce(m.sent_at, m.created_at) >= now() - interval '3 days'));

-- Beantwortete Kundenthemen: Ueberwachung zaehlt ab jetzt (sonst kaemen alle alten auf einmal als „nachfassen“).
update public.email_threads t set reviewed_at = now()
 where t.topic_state = 'aktiv'
   and (select max(coalesce(o.sent_at, o.created_at)) from public.email_messages o where o.thread_id = t.id and o.direction = 'out')
    >= (select max(coalesce(i.sent_at, i.created_at)) from public.email_messages i where i.thread_id = t.id and i.direction = 'in');
