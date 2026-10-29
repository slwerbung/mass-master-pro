-- Mail-Assistent: neue Mails bekamen keine `current_uid` (nur `uid`). Ohne sie konnte der Assistent sie nicht
-- in die Ordner 2–9 verschieben und keine Schlagwoerter setzen („Kein IMAP-Zugriff / UID unbekannt“).
-- Der Sync setzt sie jetzt selbst; der Trigger faengt aeltere Sync-Versionen ab, der Nachtrag den Bestand
-- (nur Mails, die noch im Ordner liegen, in dem sie eingelesen wurden – dort stimmt die UID).
create or replace function public.email_messages_default_uid()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.current_uid is null and new.current_folder is not distinct from new.folder then
    new.current_uid := new.uid;
  end if;
  return new;
end $$;

drop trigger if exists email_messages_default_uid on public.email_messages;
create trigger email_messages_default_uid
  before insert on public.email_messages
  for each row execute function public.email_messages_default_uid();

revoke all on function public.email_messages_default_uid() from public, anon, authenticated;

update public.email_messages set current_uid = uid where current_uid is null and current_folder = folder;
