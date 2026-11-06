-- Mail-App: ein Thema (email_threads = Gespraechsverlauf) ausdruecklich einem Mitarbeiter zuordnen. Danach sehen es
-- unter „Zu entscheiden“, „Laufend“, „Wiedervorlage“ und „Abgeschlossen“ nur noch er (Admins finden die Mails weiter
-- in der Mail-Liste, mit Hinweis „zugeordnet an …“). Andere Mitarbeiter sehen die Mails dieses Themas nirgends mehr.
-- Neue Mails im Thema erben die Zuordnung.
alter table public.email_threads
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references auth.users(id) on delete set null;

-- Kopie an jeder Mail, damit Listen und Zaehler ohne Join filtern koennen (Pflege nur per Trigger).
alter table public.email_messages add column if not exists assigned_user_id uuid;
create index if not exists email_messages_assigned_idx on public.email_messages (assigned_user_id) where assigned_user_id is not null;

create or replace function public.email_messages_inherit_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.assigned_user_id := (select t.assigned_user_id from public.email_threads t where t.id = new.thread_id);
  return new;
end $$;

drop trigger if exists email_messages_assignment on public.email_messages;
create trigger email_messages_assignment before insert or update of thread_id on public.email_messages
  for each row execute function public.email_messages_inherit_assignment();

create or replace function public.email_threads_push_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.email_messages set assigned_user_id = new.assigned_user_id
   where thread_id = new.id and assigned_user_id is distinct from new.assigned_user_id;
  return null;
end $$;

drop trigger if exists email_threads_assignment on public.email_threads;
create trigger email_threads_assignment after update of assigned_user_id on public.email_threads
  for each row when (old.assigned_user_id is distinct from new.assigned_user_id)
  execute function public.email_threads_push_assignment();

revoke all on function public.email_messages_inherit_assignment() from public, anon, authenticated;
revoke all on function public.email_threads_push_assignment() from public, anon, authenticated;
